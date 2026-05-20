import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { createServer as createViteServer } from 'vite';
import cron from 'node-cron';
import { refreshKommoToken, ensureValidKommoToken, registerKommoWebhook } from './src/lib/kommo-auth';

const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";
const EVOLUTION_URL = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";

async function createEvolutionInstance(tenantId: string) {
  try {
    console.log(`[Evolution] Tentando criar instância para o tenant ${tenantId}...`);
    await axios.post(`${EVOLUTION_URL}/instance/create`, {
      instanceName: tenantId,
      token: "",
      number: "",
      integration: "WHATSAPP-BAILEYS",
      reject_call: false,
      groups_ignore: true,
      always_online: true,
      read_messages: true,
      read_status: false
    }, {
      headers: {
        "apikey": EVOLUTION_API_KEY,
        "Content-Type": "application/json"
      }
    });
    console.log(`[Evolution] Instância '${tenantId}' criada com sucesso.`);
  } catch (error: any) {
    const errorData = error.response?.data;
    if (error.response?.status === 400 || (typeof errorData?.message === 'string' && errorData.message.includes('A instância já existe') || JSON.stringify(errorData).includes('already exists'))) {
      console.log(`[Evolution] A instância '${tenantId}' já estava criada. Ignorando.`);
    } else {
      console.error(`[Evolution] Erro ao criar instância '${tenantId}':`, errorData || error.message);
    }
  }
}

const app = express();
const PORT = 3000;

// Initialize Prisma
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROTAS DO FLUXO OAUTH KOMMO --- //

/**
 * Rota 1: Iniciar Conexão OAuth
 * GET /auth/kommo/connect?empresa_id=...
 */
app.get('/auth/kommo/connect', (req: Request, res: Response) => {
  try {
    const client_id = process.env.KOMMO_CLIENT_ID;
    const redirect_uri = process.env.KOMMO_REDIRECT_URI || (process.env.APP_URL ? `${process.env.APP_URL}/auth/kommo/callback` : undefined);

    const empresa_id = req.query.empresa_id || req.query.tenantId;

    if (!empresa_id || typeof empresa_id !== 'string') {
      res.status(400).json({ error: 'O parâmetro empresa_id (ou tenantId) é obrigatório e deve ser uma string.' });
      return;
    }

    if (!client_id || !redirect_uri) {
      res.status(500).json({ 
        error: 'Faltam credenciais do Kommo Hub no servidor (.env ou painel do Coolify).',
        details: { hasClientId: !!client_id, hasRedirectUri: !!redirect_uri }
      });
      return;
    }

    const kommoAuthUrl = new URL('https://www.kommo.com/oauth');
    kommoAuthUrl.searchParams.append('client_id', client_id);
    kommoAuthUrl.searchParams.append('state', empresa_id);
    kommoAuthUrl.searchParams.append('mode', 'popup'); 

    console.log(`[Kommo OAuth] Redirecionando empresa ${empresa_id} para fluxo de autorização.`);
    res.redirect(kommoAuthUrl.toString());
  } catch (error) {
    console.error('[Kommo OAuth] Erro na rota /connect:', error);
    res.status(500).json({ error: 'Erro interno ao iniciar fluxo de autorização.' });
  }
});

/**
 * Rota 2: Callback de Autorização da Kommo
 * GET /auth/kommo/callback
 */
app.get('/auth/kommo/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const referer = req.query.referer as string; 
    let subdomain = req.query.subdomain as string;

    const client_id = process.env.KOMMO_CLIENT_ID;
    const client_secret = process.env.KOMMO_CLIENT_SECRET;
    const redirect_uri = process.env.KOMMO_REDIRECT_URI || (process.env.APP_URL ? `${process.env.APP_URL}/auth/kommo/callback` : undefined);

    const tenantId = state;

    if (!client_id || !client_secret || !redirect_uri) {
      res.status(500).send('Faltam credenciais do Kommo Hub no servidor (.env ou painel do Coolify).');
      return;
    }

    if (!code || !tenantId) {
       res.status(400).send('Parâmetros "code" e "state (tenantId)" são obrigatórios.');
       return;
    }

    if (!subdomain && referer) {
      subdomain = referer.split('.')[0];
    } else if (!subdomain) {
      res.status(400).send('Subdomínio não identificado no callback da Kommo (referer ou subdomain faltante).');
      return;
    }

    console.log(`[Kommo OAuth] Callback recebido do tenant ${tenantId} no subdomínio ${subdomain}.`);

    const payload = {
      client_id,
      client_secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri,
    };

    const tokenUrl = `https://${subdomain}.kommo.com/oauth2/access_token`;

    const tokenResponse = await axios.post(tokenUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!access_token || !refresh_token) {
        throw new Error('Retorno da Kommo não contém access_token ou refresh_token.');
    }

    // 2. AJUSTE NA ROTA DE CALLBACK (Obter ID da Conta)
    let kommoAccountId = '';
    let accountName = '';
    
    try {
      const accountInfoRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/account`, {
        headers: {
          'Authorization': `Bearer ${access_token}`
        }
      });
      kommoAccountId = String(accountInfoRes.data.id);
      accountName = String(accountInfoRes.data.name || '');
    } catch (apiError: any) {
      console.error('[Kommo OAuth] Erro ao buscar ID da conta:', apiError?.response?.data || apiError.message);
      throw new Error('Não foi possível obter os detalhes da conta da Kommo usando o token gerado.');
    }

    if (!kommoAccountId) {
       throw new Error('O ID da conta da Kommo não foi retornado pela API.');
    }

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Salvar ou atualizar no Banco de Dados PostgreSQL via Prisma
    await prisma.kommoConnection.upsert({
      where: { kommoAccountId: kommoAccountId },
      update: {
        tenantId: tenantId,
        kommoSubdomain: subdomain,
        accountName: accountName,
        isActive: true, // Garante que volta pra true se reconectar
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expiresAt,
      },
      create: {
        tenantId: tenantId,
        kommoAccountId: kommoAccountId,
        kommoSubdomain: subdomain,
        accountName: accountName,
        isActive: true, // Garante que o registro começa como true
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expiresAt,
      }
    });

    console.log(`[Kommo OAuth] Tokens da conta ${kommoAccountId} (tenant ${tenantId}) salvos com sucesso.`);

    // 2. CHAMADA AUTOMÁTICA NO CALLBACK (Registrar Webhook)
    await registerKommoWebhook(kommoAccountId);

    // 3. CHAMADA AUTOMÁTICA O CALLBACK (Criar Instancia Evolution)
    await createEvolutionInstance(tenantId);

    res.send(`
      <html>
        <head><title>Integração Concluída</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2>Integração com Kommo Finalizada com Sucesso! 🚀</h2>
          <p>Os tokens foram salvos para a empresa <strong>${tenantId}</strong> no subdomínio ${subdomain}.kommo.com.</p>
          <p>Você já pode fechar esta janela.</p>
        </body>
      </html>
    `);

  } catch (error: unknown) {
    const err = error as any;
    console.error('[Kommo OAuth] Erro durante o callback/obtenção do token:', err?.response?.data || err.message);
    res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; color: red; text-align: center; padding: 50px;">
          <h2>Erro na Integração</h2>
          <p>Não foi possível concluir a integração com Kommo.</p>
          <p>Detalhes: ${err?.response?.data?.title || err.message}</p>
        </body>
      </html>
    `);
  }
});

// 3. ROTA DE LISTAGEM DE CONTAS (Todas)
app.get('/api/connections', async (req: Request, res: Response) => {
  try {
    const connections = await prisma.kommoConnection.findMany({
      select: {
          id: true,
          tenantId: true,
          accountName: true,
          kommoSubdomain: true,
          kommoAccountId: true,
          isActive: true,
          expiresAt: true,
          updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(connections);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(500).json({ error: err.message });
  }
});

// 3.1 ROTA DE LISTAGEM DE CONTAS DO TENANT
app.get('/api/tenants/:tenant_id/accounts', async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;
    const connections = await prisma.kommoConnection.findMany({
      where: { tenantId: tenant_id },
      select: {
          id: true,
          tenantId: true,
          accountName: true,
          kommoSubdomain: true,
          kommoAccountId: true,
          isActive: true,
          expiresAt: true,
          updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(connections);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(500).json({ error: err.message });
  }
});

// Alternar status
app.patch('/api/connections/:id/toggle', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const connection = await prisma.kommoConnection.findUnique({ where: { id } });
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada' });
      return;
    }
    
    // inverte o valor isActive
    const updated = await prisma.kommoConnection.update({
      where: { id },
      data: { isActive: !connection.isActive }
    });
    
    res.status(200).json({ success: true, isActive: updated.isActive });
  } catch (e: unknown) {
    const err = e as Error;
    res.status(500).json({ error: err.message });
  }
});


/**
 * 4. AJUSTE DE SEGURANÇA NO WEBHOOK CENTRAL
 * POST /api/webhooks/kommo
 */
app.post('/api/webhooks/kommo', async (req: Request, res: Response) => {
  try {
    const kommoAccountIdStr = req.body?.account?.id || req.body?.account_id || req.query.account_id;
    
    if (!kommoAccountIdStr) {
      console.warn('[Webhook Kommo] Evento recebido sem ID de conta (account.id).');
      res.status(400).send('ID da conta não identificado no webhook.');
      return;
    }

    const kommoAccountId = String(kommoAccountIdStr);
    
    // Busca banco
    const connection = await prisma.kommoConnection.findUnique({
      where: { kommoAccountId: kommoAccountId }
    });

    if (!connection) {
      console.warn(`[Webhook Kommo] Recebido evento para conta ${kommoAccountId} não encontrada no banco de dados.`);
      res.status(404).send('Conexão não encontrada.');
      return;
    }

    // REGRA DE SEGURANÇA: Se estiver inativa, pausa silenciosamente sem passar pro webhook n8n
    if (!connection.isActive) {
      console.log(`[Webhook Kommo] Evento recebido (conta ${kommoAccountId}) mas a conexão está PAUSADA (isActive=false).`);
      res.status(200).send('Pausado');
      return;
    }

    // Verifica token expiração e renova pre-emptivamente se necessário (<15 min)
    const now = new Date();
    const timeRemainingMs = connection.expiresAt.getTime() - now.getTime();
    if (timeRemainingMs < 900000) {
      console.log(`[Webhook Kommo] Renovando token preventivamente no webhook para conta ${kommoAccountId}`);
      await refreshKommoToken(kommoAccountId);
      
      const updatedConn = await prisma.kommoConnection.findUnique({ where: { kommoAccountId: kommoAccountId }});
      if(updatedConn) connection.accessToken = updatedConn.accessToken;
    }

    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nUrl) {
      console.error('[Webhook Kommo] Variavél N8N_WEBHOOK_URL não configurada no servidor.');
      res.status(200).send('N8N_WEBHOOK_URL was missing.');
      return;
    }

    // Disparo pro N8N
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
});

/**
 * 5. WEBHOOK EVOLUTION API
 * POST /api/webhooks/evolution/:kommoAccountId
 */
app.post('/api/webhooks/evolution/:kommoAccountId', async (req: Request, res: Response) => {
  try {
    const { kommoAccountId } = req.params;
    const body = req.body;

    const mensagem_whatsapp = body?.mensagem_whatsapp || '';
    const telefone_whatsapp = body?.telefone_whatsapp || '';

    if (!telefone_whatsapp) {
      res.status(400).send('O campo telefone_whatsapp é obrigatório.');
      return;
    }

    const connection = await prisma.kommoConnection.findUnique({
      where: { kommoAccountId }
    });

    if (!connection) {
      res.status(404).send('Conexão Kommo não encontrada.');
      return;
    }

    if (!connection.isActive) {
      res.status(200).send('Pausado');
      return;
    }

    // Renova o token se estiver perto de expirar
    const now = new Date();
    const timeRemainingMs = connection.expiresAt.getTime() - now.getTime();
    if (timeRemainingMs < 900000) {
      await refreshKommoToken(kommoAccountId);
      const updatedConn = await prisma.kommoConnection.findUnique({ where: { kommoAccountId } });
      if (updatedConn) connection.accessToken = updatedConn.accessToken;
    }

    let lead_existe = false;
    let finalLeadData = null;

    const axiosConfig = {
      headers: {
        'Authorization': `Bearer ${connection.accessToken}`
      }
    };

    try {
      const leadsRes = await axios.get(`https://${connection.kommoSubdomain}.kommo.com/api/v4/leads?query=${encodeURIComponent(telefone_whatsapp)}&with=contacts`, axiosConfig);
      
      const leadsRaw = leadsRes.data?._embedded?.leads;

      if (Array.isArray(leadsRaw) && leadsRaw.length > 0) {
        lead_existe = true;

        // 1. Filtrar o Lead mais recente
        const orderedLeads = leadsRaw.sort((a: any, b: any) => b.updated_at - a.updated_at);
        const latestLead = orderedLeads[0];

        // 2. Extrair Dados do Card
        const tagsRaw = latestLead._embedded?.tags || [];
        const tags: string[] = tagsRaw.map((t: any) => t.name);

        const cfRaw = latestLead.custom_fields_values || [];
        const custom_fields: Record<string, string> = {};
        cfRaw.forEach((cf: any) => {
          if (cf.field_name && cf.values && cf.values.length > 0) {
            custom_fields[cf.field_name] = cf.values[0].value;
          }
        });

        // 3. Buscar os Dados do Contato Vinculado
        let contatoObj = null;
        const contactsRaw = latestLead._embedded?.contacts || [];
        const mainContact = contactsRaw.find((c: any) => c.is_main === true) || contactsRaw[0];

        if (mainContact) {
          const contactRes = await axios.get(`https://${connection.kommoSubdomain}.kommo.com/api/v4/contacts/${mainContact.id}`, axiosConfig);
          const rawContact = contactRes.data;

          let phoneVal = '';
          let emailVal = '';

          const contactCFRaw = rawContact.custom_fields_values || [];
          contactCFRaw.forEach((cf: any) => {
            if (cf.field_code === 'PHONE' && cf.values && cf.values.length > 0) {
              phoneVal = cf.values[0].value;
            }
            if (cf.field_code === 'EMAIL' && cf.values && cf.values.length > 0) {
              emailVal = cf.values[0].value;
            }
          });

          contatoObj = {
            id: rawContact.id,
            nome_real: rawContact.name,
            telefone: phoneVal,
            email: emailVal
          };
        }

        finalLeadData = {
          id: latestLead.id,
          nome_card: latestLead.name,
          status_id: latestLead.status_id,
          pipeline_id: latestLead.pipeline_id,
          tags,
          custom_fields,
          contato: contatoObj
        };
      }
    } catch (kommoErr: any) {
      if (kommoErr.response && kommoErr.response.status === 204) {
        lead_existe = false;
      } else {
        console.error('[Evolution] Erro ao buscar lead na Kommo:', kommoErr.response?.data || kommoErr.message);
      }
    }

    // 4. Repasse completo para o n8n
    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (n8nUrl) {
      const payloadToN8n = {
        mensagem_whatsapp,
        telefone_whatsapp,
        lead_existe,
        lead: finalLeadData,
        access_token: connection.accessToken,
        subdomain: connection.kommoSubdomain
      };

      axios.post(n8nUrl, payloadToN8n).catch(err => {
        console.error('[Evolution] Falha ao enviar para o N8N:', err.message);
      });
    } else {
      console.warn('[Evolution] Variavél N8N_WEBHOOK_URL não configurada no servidor.');
    }

    res.status(200).send('OK');

  } catch (error: any) {
    console.error('[Evolution] Erro crítico:', error.message);
    res.status(500).send('Internal Error');
  }
});

/**
 * 6. ROTA DE ENTRADA DE LOGS (n8n -> Servidor)
 */
app.post('/api/logs', async (req: Request, res: Response) => {
  try {
    const { 
      tenantId, 
      leadId, 
      whatsappNumber, 
      incomingMessage, 
      aiResponse, 
      actionTaken, 
      status, 
      errorMessage 
    } = req.body;

    if (!tenantId || !whatsappNumber || !incomingMessage || !status) {
      res.status(400).json({ error: 'Campos tenantId, whatsappNumber, incomingMessage e status são obrigatórios.' });
      return;
    }

    const log = await prisma.interactionLog.create({
      data: {
        tenantId,
        leadId,
        whatsappNumber,
        incomingMessage,
        aiResponse,
        actionTaken,
        status,
        errorMessage
      }
    });

    res.status(201).json(log);
  } catch (error: any) {
    console.error('[Logs] Erro ao salvar log:', error.message);
    res.status(500).json({ error: 'Erro interno ao salvar o log.' });
  }
});

/**
 * 7. ROTA DE LISTAGEM DE LOGS (Painel -> Servidor)
 */
app.get('/api/tenants/:tenant_id/logs', async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;

    const logs = await prisma.interactionLog.findMany({
      where: { tenantId: tenant_id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json(logs);
  } catch (error: any) {
    console.error('[Logs] Erro ao buscar logs:', error.message);
    res.status(500).json({ error: 'Erro interno ao buscar os logs.' });
  }
});

/**
 * 8. ROTA OBTER QR CODE (Evolution API)
 */
app.get('/api/tenants/:tenant_id/qrcode', async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;

    const response = await axios.get(`${EVOLUTION_URL}/instance/connect/${tenant_id}`, {
      headers: {
        "apikey": EVOLUTION_API_KEY
      }
    });

    const data = response.data;

    // Se a instância já estiver conectada, a Evolution costuma retornar algo como state "open" ou conected
    if (data?.instance?.state === 'open' || data?.instance?.status === 'connected' || data?.state === 'open' || data?.status === 'connected') {
      res.json({ status: "CONNECTED" });
      return;
    }

    const qrCodeBase64 = data.base64 || data.code || data.qrcode;

    if (qrCodeBase64) {
      res.json({ status: "SCAN_QR", qrcode: qrCodeBase64 });
    } else {
      res.json({ status: "PENDING", details: data });
    }
  } catch (error: any) {
    const errorData = error.response?.data;
    const msg = typeof errorData?.message === 'string' ? errorData.message.toLowerCase() : '';

    // Tratar se a API der erro indicando que já está conectada/aberta
    if (msg.includes('open') || msg.includes('connected') || msg.includes('already connected')) {
      res.json({ status: "CONNECTED" });
      return;
    }

    console.error(`[Evolution] Erro ao buscar QR Code do tenant ${req.params.tenant_id}:`, errorData || error.message);
    res.status(500).json({ error: 'Erro interno ao buscar o QR Code.' });
  }
});

// Exemplo de rota protegida que usa o Middleware
app.get('/api/kommo/status', ensureValidKommoToken, (req: Request, res: Response) => {
  const token = (req as any).kommoToken;
  const subdomain = (req as any).kommoSubdomain;
  res.json({ message: 'Token válido!', subdomain, token_preview: token.substring(0, 10) + '...' });
});

// Inicializar Vite/Server e Cron Job
async function startServer() {
  // CRON JOB (Rotina de Segundo Plano - a cada 1 hora)
  cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Iniciando verificação preventiva de tokens da Kommo...');
    try {
      const futureCheckDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      
      const connectionsToRefresh = await prisma.kommoConnection.findMany({
        where: {
          expiresAt: {
            lte: futureCheckDate 
          }
        }
      });

      console.log(`[Cron] Encontradas ${connectionsToRefresh.length} conexões para renovar.`);

      for (const conn of connectionsToRefresh) {
        try {
          await refreshKommoToken(conn.kommoAccountId);
        } catch (err: any) {
          console.error(`[Cron] Falha ao renovar token da conta ${conn.kommoAccountId}:`, err.message);
        }
      }
    } catch (error) {
      console.error('[Cron] Erro geral na varredura de tokens:', error);
    }
  });
  console.log('[Cron] Job de renovação de tokens agendado (1h).');

  try {
    const { execSync } = require('child_process');
    console.log('[DB] Aplicando schema Prisma no banco de dados...');
    execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
    console.log('[DB] Tabela KommoConnection verificada/criada com sucesso!');
  } catch (error: unknown) {
    const err = error as Error;
    console.warn('[DB] Aviso: Não foi possível aplicar o schema Prisma (banco indisponível).', err.message);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running Hub API on http://localhost:${PORT}`);
  });
}

startServer();
