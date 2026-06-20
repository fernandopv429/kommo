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
import OpenAI from "openai";
import { createOpenAiProject, getOpenAiCosts, getOpenAiTokenUsage, getOpenAiProjectsFromDb } from './src/lib/openai-manager';
import { addMessageToBuffer } from './src/queues/messageQueue';
import './src/queues/messageWorker'; // Inicia o worker


const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";
const EVOLUTION_URL = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";

async function createEvolutionInstance(tenantId: string) {
  const EVOLUTION_URL_EXEC = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";
  const EVOLUTION_API_KEY_EXEC = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";

  let createdResponse = null;

  const setWebhook = async () => {
    console.log(`[Evolution] Configurando Webhook Centralizador para a instância: ${tenantId}`);
    try {
      const finalUrl = 'https://tarif.nexusdevhub.com';

      await axios.post(
        `${EVOLUTION_URL_EXEC}/webhook/set/${tenantId}`,
        {
          webhook: {
            enabled: true,
            url: `${finalUrl}/api/webhooks/evolution/${tenantId}`,
            webhookByEvents: true,
            webhookBase64: false,
            events: [
              "MESSAGES_UPSERT",
              "CONNECTION_UPDATE"
            ]
          }
        },
        {
          headers: {
            "apikey": EVOLUTION_API_KEY_EXEC,
            "Content-Type": "application/json"
          }
        }
      );
      console.log(`[Evolution] Webhook centralizador configurado com sucesso para a instância '${tenantId}'. URL: ${finalUrl}/api/webhooks/evolution/${tenantId}`);
    } catch (webhookError: any) {
      console.error(`[Evolution] Falha ao configurar webhook para '${tenantId}':`, webhookError.response?.data || webhookError.message);
    }
  };

  try {
    console.log(`[Evolution] Solicitando criação da instância: ${tenantId}`);
    const response = await axios.post(
      `${EVOLUTION_URL_EXEC}/instance/create`,
      {
        instanceName: tenantId,
        integration: "WHATSAPP-BAILEYS",
        alwaysOnline: true,
        readMessages: true,
        readStatus: false,
        rejectCall: false,
        groupsIgnore: true
      },
      {
        headers: {
          "apikey": EVOLUTION_API_KEY_EXEC,
          "Content-Type": "application/json"
        }
      }
    );
    console.log(`[Evolution] Instância '${tenantId}' criada com sucesso.`);
    createdResponse = response.data;
    await setWebhook(); // Configura após sucesso
  } catch (error: any) {
    const errorData = error.response?.data;
    if (error.response?.status === 400 || (typeof errorData?.message === 'string' && errorData.message.includes('A instância já existe') || JSON.stringify(errorData).includes('already exists'))) {
      console.log(`[Evolution] Instância ${tenantId} já mapeada no servidor.`);
      createdResponse = { status: "EXISTS" };
      await setWebhook(); // Configura se já existir para garantir o vínculo
    } else {
      console.error(`[Evolution] Erro na criação do container para '${tenantId}':`, errorData || error.message);
      throw error;
    }
  }

  return createdResponse;
}

const app = express();
const PORT = 3000;

// Initialize Prisma
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROTAS DE CONFIGURAÇÃO DO SISTEMA --- //

app.get('/api/settings/:key', async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const setting = await prisma.systemSetting.findUnique({ where: { key } });
    res.json({ value: setting?.value || '' });
  } catch (error: any) {
    console.error(`[Settings] Erro no banco de dados para a chave ${req.params.key}:`, error.message);
    res.status(200).json({ value: '' });
  }
});

app.post('/api/settings', async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      res.status(400).json({ error: 'Key is required' });
      return;
    }
    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
    res.json(setting);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- ROTAS DE PROJETOS OPENAI --- //

app.post('/api/openai/projects', async (req: Request, res: Response) => {
  try {
    const { tenantId, projectName } = req.body;
    if (!projectName) {
      res.status(400).json({ error: 'projectName is required' });
      return;
    }
    const newProject = await createOpenAiProject(tenantId || "default", projectName);
    res.json(newProject);
  } catch (error: any) {
    console.error("[OpenAI] Falha ao criar projeto:", error.response?.data || error.message);
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

app.get('/api/openai/projects', async (req: Request, res: Response) => {
  try {
    const projects = await getOpenAiProjectsFromDb();
    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/openai/costs', async (req: Request, res: Response) => {
  try {
    const { start_time, end_time, group_by_project } = req.query;
    if (!start_time) {
      res.status(400).json({ error: 'start_time is required' });
      return;
    }
    const costs = await getOpenAiCosts(
      String(start_time), 
      end_time ? String(end_time) : undefined, 
      group_by_project === 'true'
    );
    res.json(costs);
  } catch (error: any) {
    console.error("[OpenAI] Falha ao buscar custos:", error.response?.data || error.message);
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

app.get('/api/openai/usage', async (req: Request, res: Response) => {
  try {
    const { start_time, group_by_project } = req.query;
    if (!start_time) {
      res.status(400).json({ error: 'start_time is required' });
      return;
    }
    const usage = await getOpenAiTokenUsage(
      String(start_time), 
      group_by_project === 'true'
    );
    res.json(usage);
  } catch (error: any) {
    console.error("[OpenAI] Falha ao buscar uso (tokens):", error.response?.data || error.message);
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

app.get('/api/openai/summary', async (req: Request, res: Response) => {
  try {
    const projects = await getOpenAiProjectsFromDb();
    if (projects.length === 0) {
      return res.json({});
    }

    const d = new Date();
    d.setDate(1);
    d.setHours(0,0,0,0);
    const start_time = Math.floor(d.getTime() / 1000).toString();

    let costsRes = { data: [] };
    let usageRes = { data: [] };

    try {
      costsRes = await getOpenAiCosts(start_time, undefined, true);
    } catch(e) {
      console.warn("Could not fetch costs", e);
    }

    try {
      usageRes = await getOpenAiTokenUsage(start_time, true); 
    } catch(e) {
      console.warn("Could not fetch usage", e);
    }

    const summaryByTenant: Record<string, any> = {};

    for (const proj of projects) {
      if (!proj.tenantId) continue;
      
      const pCostsForProj = costsRes.data?.filter((c: any) => c.project_id === proj.projectId) || [];
      const pUsagesForProj = usageRes.data?.filter((u: any) => u.project_id === proj.projectId) || [];

      const totalCost = pCostsForProj.reduce((acc: number, curr: any) => acc + (curr.amount?.value || 0), 0);
      const currency = pCostsForProj[0]?.amount?.currency || 'USD';

      const tokensInput = pUsagesForProj.reduce((acc: number, curr: any) => acc + (curr.n_context_tokens_total || 0), 0);
      const tokensOutput = pUsagesForProj.reduce((acc: number, curr: any) => acc + (curr.n_generated_tokens_total || 0), 0);

      summaryByTenant[proj.tenantId] = {
        projectId: proj.projectId,
        projectName: proj.projectName,
        apiKey: proj.apiKey,
        cost: totalCost,
        currency: currency,
        tokensInput: tokensInput,
        tokensOutput: tokensOutput,
        tokensTotal: tokensInput + tokensOutput
      };
    }

    res.json(summaryByTenant);
  } catch (error: any) {
    console.error("[OpenAI] Falha ao gerar resumo:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- ROTAS DO FLUXO OAUTH KOMMO --- //

/**
 * Rota 1: Iniciar Conexão OAuth
 * GET /auth/kommo/connect?empresa_id=...
 */
app.get('/auth/kommo/connect', (req: Request, res: Response) => {
  try {
    const client_id = process.env.KOMMO_CLIENT_ID;
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const dynamic_redirect = `${protocol}://${host}/auth/kommo/callback`;
    const redirect_uri = process.env.KOMMO_REDIRECT_URI || dynamic_redirect;

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
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const dynamic_redirect = `${protocol}://${host}/auth/kommo/callback`;
    const redirect_uri = process.env.KOMMO_REDIRECT_URI || dynamic_redirect;

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
          <p style="font-size: 12px; color: #555;">Dados extras: ${JSON.stringify(err?.response?.data || {})}</p>
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

    // Fetch instances from Evolution to enrich the data with connection status
    let evolutionInstances: any[] = [];
    try {
      const EVOLUTION_URL_EXEC = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";
      const EVOLUTION_API_KEY_EXEC = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";
      
      const response = await axios.get(`${EVOLUTION_URL_EXEC}/instance/fetchInstances`, {
        headers: { "apikey": EVOLUTION_API_KEY_EXEC }
      });
      if (response.data && Array.isArray(response.data)) {
        evolutionInstances = response.data;
      }
    } catch (evoErr: any) {
      console.warn('[API] Falha ao buscar instâncias da Evolution API:', evoErr.message);
    }

    const enrichedConnections = connections.map(conn => {
      const evoInstance = evolutionInstances.find(env => env.instance?.instanceName === conn.tenantId || env.name === conn.tenantId || env.instanceName === conn.tenantId);
      
      // Dependendo da versão da Evolution API, o estado pode estar em diferentes campos
      let evoState = 'unknown';
      if (evoInstance) {
         evoState = evoInstance.state || evoInstance.instance?.state || evoInstance.status || evoInstance.connectionStatus || 'disconnected';
      }

      return {
        ...conn,
        evolutionState: evoState
      };
    });

    res.json(enrichedConnections);
  } catch (e: unknown) {
    const err = e as Error;
    console.error('[API] Erro ao buscar conexões:', err.message);
    res.status(200).json([]);
  }
});

// Adição manual de credenciais
app.post('/api/connections/manual', async (req: Request, res: Response) => {
  try {
    const { tenantId, accountName, kommoAccountId, kommoSubdomain, accessToken, refreshToken } = req.body;

    if (!tenantId || !kommoAccountId || !kommoSubdomain || !accessToken || !refreshToken) {
      res.status(400).json({ error: 'Existem campos obrigatórios faltando (tenantId, kommoAccountId, kommoSubdomain, accessToken, refreshToken).' });
      return;
    }

    // Default expirations for manual token inputs is usually ~24h for Kommo, if they expire sooner the refresh cron will fix it
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const cleanSubdomain = kommoSubdomain.replace('.kommo.com', '').replace('https://', '').replace('/', '');

    const newConnection = await prisma.kommoConnection.upsert({
      where: { kommoAccountId },
      update: {
        tenantId,
        accountName: accountName || 'Conta Adicionada Manualmente',
        kommoSubdomain: cleanSubdomain,
        accessToken,
        refreshToken,
        expiresAt,
        isActive: true
      },
      create: {
        tenantId,
        accountName: accountName || 'Conta Adicionada Manualmente',
        kommoAccountId,
        kommoSubdomain: cleanSubdomain,
        accessToken,
        refreshToken,
        expiresAt,
        isActive: true
      }
    });

    // CHAMADA AUTOMÁTICA O CALLBACK (Criar Instancia Evolution e Webhook)
    try {
      await createEvolutionInstance(tenantId);
    } catch (evoError: any) {
      console.error(`[Manual Connection] Falha ao criar instancia Evolution para tenant ${tenantId}. Ocorreu no processo paralelo.`, evoError.message);
    }

    res.json(newConnection);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

// 3.2 ROTA PARA CONSULTAR INFORMAÇÕES DA CONEXÃO PELA INSTÂNCIA (TENANT)
app.get('/api/connections/info/:tenantId', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    
    const connection = await prisma.kommoConnection.findFirst({
      where: { tenantId: tenantId },
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

    if (!connection) {
      res.status(404).json({ exists: false, message: 'Nenhuma conexão ativa encontrada para este identificador (telefone).' });
      return;
    }

    res.json({
      exists: true,
      data: connection
    });

  } catch (error: any) {
    console.error('[API Connection Info] Erro:', error.message);
    res.status(500).json({ error: 'Erro interno ao consultar informações da conexão.' });
  }
});

// 3.3 CONSULTA DE LEAD NA KOMMO POR TELEFONE
app.get('/api/leads/:tenantId/:phoneNumber', async (req: Request, res: Response) => {
  try {
    const { tenantId, phoneNumber } = req.params;
    
    const telefone_limpo = phoneNumber.replace(/\D/g, '');

    const connection = await prisma.kommoConnection.findFirst({
      where: { tenantId: tenantId, isActive: true }
    });

    if (!connection) {
      res.status(404).json({ error: 'Conexão Kommo não encontrada ou inativa para este tenant.' });
      return;
    }

    // Renova o token se necessário
    const now = new Date();
    const timeRemainingMs = connection.expiresAt.getTime() - now.getTime();
    if (timeRemainingMs < 900000) {
      await refreshKommoToken(connection.kommoAccountId);
      const updatedConn = await prisma.kommoConnection.findUnique({ where: { kommoAccountId: connection.kommoAccountId } });
      if (updatedConn) connection.accessToken = updatedConn.accessToken;
    }

    const { exists, lead } = await fetchLeadData(tenantId, telefone_limpo, connection);

    res.json({ exists, lead });

  } catch (error: any) {
    console.error('[API Lead Query] Erro:', error.message);
    res.status(500).json({ error: 'Erro interno ao consultar o Lead.' });
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

    // Buscar a URL do webhook global no banco de dados, ou fallback para ENV
    const webhookSetting = await prisma.systemSetting.findUnique({ where: { key: 'N8N_WEBHOOK_URL' } });
    const n8nUrl = webhookSetting?.value || process.env.N8N_WEBHOOK_URL;
    
    if (!n8nUrl) {
      console.error('[Webhook Kommo] Webhook centralizador N8N não configurado.');
      res.status(200).send('N8N webhook was missing.');
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
 * POST /api/webhooks/evolution/:tenantId
 */
app.post('/api/webhooks/evolution/:tenantId', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const body = req.body;

    // Verificar se é evento de conexão (CONNECTION_UPDATE)
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

    // Verificar se a mensagem foi enviada por nós mesmos (fromMe)
    if (body?.data?.key?.fromMe === true || body?.data?.fromMe === true) {
      res.status(200).send('Ignored self message');
      return;
    }

    // Extrair o JID remoto e limpar
    const remoteJid = body.data?.key?.remoteJid || '';
    const telefone_whatsapp = remoteJid.replace(/@s\.whatsapp\.net/g, '').replace(/\D/g, '');

    // Extrair a mensagem dependendo do tipo (texto simples ou estendido/midia)
    const mensagem_whatsapp = body.data?.message?.conversation || body.data?.message?.extendedTextMessage?.text || '';

    if (!telefone_whatsapp || !mensagem_whatsapp) {
      res.status(400).send('Dados de telefone ou mensagem ausentes ou inválidos.');
      return;
    }

    // Adicionar a mensagem ao buffer do Redis com debounce (via BullMQ)
    await addMessageToBuffer(tenantId, telefone_whatsapp, mensagem_whatsapp);

    // Responder rapidamente para não dar timeout
    res.status(200).send('Queued');
  } catch (error: any) {
    console.error('[Evolution Webhook] Erro crítico:', error.message);
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

    const qrCodeBase64 = data.base64 || data.code || data.qrcode || data.instance?.qr;

    if (qrCodeBase64) {
      res.json({ status: "SCAN_QR", qrcode: qrCodeBase64 });
    } else {
      res.json({ status: "CREATING", details: data }); // Modificado para CREATING para que o front polling entenda
    }
  } catch (error: any) {
    const errorData = error.response?.data;
    const msg = typeof errorData?.message === 'string' ? errorData.message.toLowerCase() : '';

    // Se no connect retornar 404, significa que a instância ainda não terminou de subir ou não existe
    if (error.response?.status === 404 || msg.includes('does not exist')) {
      console.log(`[Evolution] Instância '${req.params.tenant_id}' não encontrada. Iniciando criação...`);
      try {
        await createEvolutionInstance(req.params.tenant_id);
      } catch (createError) {
        console.error(`[Evolution] Falha ao tentar criar a instância automaticamente:`, createError);
      }
      res.json({ status: "CREATING" });
      return;
    }

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

/**
 * Rota para forçar sincronização do webhook na Evolution manualmente
 */
app.post('/api/tenants/:tenant_id/sync-webhook', async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;
    const EVOLUTION_URL_EXEC = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";
    const EVOLUTION_API_KEY_EXEC = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";

    const finalUrl = 'https://tarif.nexusdevhub.com';

    await axios.post(
      `${EVOLUTION_URL_EXEC}/webhook/set/${tenant_id}`,
      {
        webhook: {
          enabled: true,
          url: `${finalUrl}/api/webhooks/evolution/${tenant_id}`,
          webhookByEvents: true,
          webhookBase64: false,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
        }
      },
      {
        headers: {
          "apikey": EVOLUTION_API_KEY_EXEC,
          "Content-Type": "application/json"
        }
      }
    );
    res.json({ success: true, message: "Webhook sincronizado com a Evolution", url: `${finalUrl}/api/webhooks/evolution/${tenant_id}` });
  } catch (error: any) {
    console.error(`[Evolution] Falha ao sintonizar webhook manual para '${req.params.tenant_id}':`, error.response?.data || error.message);
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
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
