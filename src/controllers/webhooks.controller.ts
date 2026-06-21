import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { refreshKommoToken } from '../lib/kommo-auth';
import { addMessageToBuffer } from '../queues/messageQueue';

const prisma = new PrismaClient();

export const kommoWebhook = async (req: Request, res: Response) => {
  try {
    const kommoAccountIdStr = req.body?.account?.id || req.body?.account_id || req.query.account_id;
    
    if (!kommoAccountIdStr) {
      console.warn('[Webhook Kommo] Evento recebido sem ID de conta (account.id).');
      res.status(400).send('ID da conta não identificado no webhook.');
      return;
    }

    const kommoAccountId = String(kommoAccountIdStr);
    
    const connection = await prisma.kommoConnection.findUnique({
      where: { kommoAccountId: kommoAccountId }
    });

    if (!connection) {
      console.warn(`[Webhook Kommo] Recebido evento para conta ${kommoAccountId} não encontrada no banco de dados.`);
      res.status(404).send('Conexão não encontrada.');
      return;
    }

    if (!connection.isActive) {
      console.log(`[Webhook Kommo] Evento recebido (conta ${kommoAccountId}) mas a conexão está PAUSADA (isActive=false).`);
      res.status(200).send('Pausado');
      return;
    }

    const now = new Date();
    const timeRemainingMs = connection.expiresAt.getTime() - now.getTime();
    if (timeRemainingMs < 900000) {
      console.log(`[Webhook Kommo] Renovando token preventivamente no webhook para conta ${kommoAccountId}`);
      await refreshKommoToken(kommoAccountId);
      
      const updatedConn = await prisma.kommoConnection.findUnique({ where: { kommoAccountId: kommoAccountId }});
      if(updatedConn) connection.accessToken = updatedConn.accessToken;
    }

    const webhookSetting = await prisma.systemSetting.findUnique({ where: { key: 'N8N_WEBHOOK_URL' } });
    const n8nUrl = webhookSetting?.value || process.env.N8N_WEBHOOK_URL;
    
    if (!n8nUrl) {
      console.error('[Webhook Kommo] Webhook centralizador N8N não configurado.');
      res.status(200).send('N8N webhook was missing.');
      return;
    }

    const leadId = req.body['leads[status][0][id]'] || req.body['leads[add][0][id]'];
    const statusId = req.body['leads[status][0][status_id]'] || req.body['leads[add][0][status_id]'];

    const payloadToN8n = {
      lead_id: leadId,
      status_id: statusId,
      subdomain: connection.kommoSubdomain,
      access_token: connection.accessToken
    };

    axios.post(n8nUrl, payloadToN8n).catch(err => {
      console.error('[Webhook Kommo] Falha ao enviar para o N8N:', err.message);
    });

    res.status(200).send('OK');
  } catch (error: any) {
    console.error('[Webhook Kommo] Erro crítico no webhook:', error.message);
    res.status(500).send('Internal Error');
  }
};

export const evolutionWebhook = async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const body = req.body;

    if (body?.event === 'connection.update') {
      const state = body?.data?.state || body?.state || body?.data?.status || 'unknown';
      console.log(`[Evolution Webhook] Status da conexão alterado para o tenant ${tenantId}. Status: ${state}`);
      
      const webhookSetting = await prisma.systemSetting.findUnique({ where: { key: 'N8N_WEBHOOK_URL' } });
      const n8nUrl = webhookSetting?.value || process.env.N8N_WEBHOOK_URL;
      
      if (n8nUrl) {
         try {
           await axios.post(n8nUrl, {
             event_type: 'evolution_connection_update',
             tenantId: tenantId,
             state: state,
             raw_data: body
           });
           console.log(`[Evolution Webhook] Evento de desconexão/conexão enviado para o n8n.`);
         } catch(e: any) {
           console.warn(`[Evolution Webhook] Falha ao enviar evento de conexão para n8n: ${e.message}`);
         }
      }
      
      res.status(200).send('Connection update logged');
      return;
    }

    if (body?.data?.key?.fromMe === true || body?.data?.fromMe === true) {
      res.status(200).send('Ignored self message');
      return;
    }

    const remoteJid = body.data?.key?.remoteJid || '';
    const telefone_whatsapp = remoteJid.replace(/@s\.whatsapp\.net/g, '').replace(/\D/g, '');

    const mensagem_whatsapp = body.data?.message?.conversation || body.data?.message?.extendedTextMessage?.text || '';

    if (!telefone_whatsapp || !mensagem_whatsapp) {
      res.status(400).send('Dados de telefone ou mensagem ausentes ou inválidos.');
      return;
    }

    await addMessageToBuffer(tenantId, telefone_whatsapp, mensagem_whatsapp);

    res.status(200).send('Queued');
  } catch (error: any) {
    console.error('[Evolution Webhook] Erro crítico:', error.message);
    res.status(500).send('Internal Error');
  }
};
