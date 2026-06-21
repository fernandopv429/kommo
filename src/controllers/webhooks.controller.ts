import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { refreshKommoToken } from '../lib/kommo-auth';
import { addMessageToBuffer } from '../queues/messageQueue';

const prisma = new PrismaClient();

export const kommoWebhook = async (req: Request, res: Response) => {
  try {
    const kommoAccountIdStr = req.body?.account?.id || req.body?.account_id || req.query.account_id;
    console.log(`[Webhook Kommo] Evento recebido! Raw Body: ${JSON.stringify(req.body).substring(0, 500)}`);
    
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

    let leadId = null;
    let statusId = null;

    if (req.body?.leads?.status && req.body.leads.status[0]) {
      leadId = req.body.leads.status[0].id;
      statusId = req.body.leads.status[0].status_id;
    } else if (req.body?.leads?.add && req.body.leads.add[0]) {
      leadId = req.body.leads.add[0].id;
      statusId = req.body.leads.add[0].status_id;
    } else if (req.body?.leads?.update && req.body.leads.update[0]) {
      leadId = req.body.leads.update[0].id;
      statusId = req.body.leads.update[0].status_id;
    } else {
      // Fallback para flat keys caso extended seja false ou venha como json flat
      leadId = req.body['leads[status][0][id]'] || req.body['leads[add][0][id]'] || req.body['leads[update][0][id]'];
      statusId = req.body['leads[status][0][status_id]'] || req.body['leads[add][0][status_id]'] || req.body['leads[update][0][status_id]'];
    }

    const payloadToN8n = {
      lead_id: leadId,
      status_id: statusId,
      subdomain: connection.kommoSubdomain,
      access_token: connection.accessToken
    };

    console.log(`[Webhook Kommo] Payload extraído: lead_id=${leadId}, status_id=${statusId}. URL N8N: ${n8nUrl}`);
    console.log(`[Webhook Kommo] Payload completo para envio N8N:`, JSON.stringify(payloadToN8n, null, 2));

    axios.post(n8nUrl, payloadToN8n).then(response => {
        console.log(`[Webhook Kommo] Encaminhado com sucesso para N8N. Status: ${response.status}`);
    }).catch(err => {
      console.error('[Webhook Kommo] ERRO ao enviar para o N8N:', err.message);
      if (err.response) {
          console.error(`[Webhook Kommo] Resposta de erro do n8n (Status ${err.response.status}):`, err.response.data);
      } else if (err.request) {
          console.error(`[Webhook Kommo] Nenhuma resposta recebida do n8n. Erro de rede ou timeout.`);
      }
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
    console.log(`[Evolution Webhook] Evento recebido no tenant ${tenantId}! Evento: ${body?.event}`);
    // console.log(`[Evolution Webhook] Body Raw: ${JSON.stringify(body).substring(0, 500)}`);

    if (body?.event === 'connection.update') {
      const state = body?.data?.state || body?.state || body?.data?.status || 'unknown';
      console.log(`[Evolution Webhook] Status da conexão alterado para o tenant ${tenantId}. Status: ${state}`);
      
      const webhookSetting = await prisma.systemSetting.findUnique({ where: { key: 'N8N_WEBHOOK_URL' } });
      const n8nUrl = webhookSetting?.value || process.env.N8N_WEBHOOK_URL;
      
      if (n8nUrl) {
         try {
           const response = await axios.post(n8nUrl, {
             event_type: 'evolution_connection_update',
             tenantId: tenantId,
             state: state,
             raw_data: body
           });
           console.log(`[Evolution Webhook] Evento de desconexão/conexão enviado para o n8n. Status: ${response.status}`);
         } catch(e: any) {
           console.error(`[Evolution Webhook] ERRO ao enviar evento de conexão para n8n:`, e.message);
           if (e.response) {
               console.error(`[Evolution Webhook] Resposta erro n8n:`, e.response.data);
           }
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
    console.error('[Evolution Webhook] Detalhes do erro:', error.stack);
    res.status(500).send('Internal Error');
  }
};
