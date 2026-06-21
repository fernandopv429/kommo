import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { registerKommoWebhook, refreshKommoToken } from '../lib/kommo-auth';
import { fetchLeadData } from '../lib/kommo-utils';
import { createEvolutionInstance } from '../services/evolution.service';

const prisma = new PrismaClient();

export const connectKommo = (req: Request, res: Response) => {
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
};

export const kommoCallback = async (req: Request, res: Response) => {
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

    await prisma.kommoConnection.upsert({
      where: { kommoAccountId: kommoAccountId },
      update: {
        tenantId: tenantId,
        kommoSubdomain: subdomain,
        accountName: accountName,
        isActive: true, 
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expiresAt,
      },
      create: {
        tenantId: tenantId,
        kommoAccountId: kommoAccountId,
        kommoSubdomain: subdomain,
        accountName: accountName,
        isActive: true,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expiresAt,
      }
    });

    console.log(`[Kommo OAuth] Tokens da conta ${kommoAccountId} (tenant ${tenantId}) salvos com sucesso.`);

    const hostUrl = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
    await registerKommoWebhook(kommoAccountId, hostUrl);
    await createEvolutionInstance(tenantId, hostUrl);

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
};

export const getConnections = async (req: Request, res: Response) => {
  try {
    const connections = await prisma.kommoConnection.findMany({
      select: {
          id: true,
          tenantId: true,
          accountName: true,
          kommoSubdomain: true,
          kommoAccountId: true,
          isActive: true,
          aiEnabled: true,
          aiActiveStages: true,
          aiActivePipelines: true,
          expiresAt: true,
          updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

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
};

export const manualConnect = async (req: Request, res: Response) => {
  try {
    const { tenantId, accountName, kommoAccountId, kommoSubdomain, accessToken, refreshToken } = req.body;

    if (!tenantId || !kommoAccountId || !kommoSubdomain || !accessToken || !refreshToken) {
      res.status(400).json({ error: 'Existem campos obrigatórios faltando (tenantId, kommoAccountId, kommoSubdomain, accessToken, refreshToken).' });
      return;
    }

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

    try {
      await createEvolutionInstance(tenantId);
    } catch (evoError: any) {
      console.error(`[Manual Connection] Falha ao criar instancia Evolution para tenant ${tenantId}. Ocorreu no processo paralelo.`, evoError.message);
    }

    res.json(newConnection);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTenantAccounts = async (req: Request, res: Response) => {
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
};

export const getConnectionInfo = async (req: Request, res: Response) => {
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
};

export const getLead = async (req: Request, res: Response) => {
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
};

export const toggleConnectionStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const connection = await prisma.kommoConnection.findUnique({ where: { id } });
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada' });
      return;
    }
    
    const updated = await prisma.kommoConnection.update({
      where: { id },
      data: { isActive: !connection.isActive }
    });
    
    res.status(200).json({ success: true, isActive: updated.isActive });
  } catch (e: unknown) {
    const err = e as Error;
    res.status(500).json({ error: err.message });
  }
};

export const updateAiSettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { aiEnabled, aiActiveStages, aiActivePipelines } = req.body;

    const connection = await prisma.kommoConnection.findUnique({ where: { id } });
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada' });
      return;
    }

    const updated = await prisma.kommoConnection.update({
      where: { id },
      data: {
        aiEnabled: aiEnabled !== undefined ? aiEnabled : connection.aiEnabled,
        aiActiveStages: Array.isArray(aiActiveStages) ? aiActiveStages : connection.aiActiveStages,
        aiActivePipelines: Array.isArray(aiActivePipelines) ? aiActivePipelines : connection.aiActivePipelines
      }
    });

    res.status(200).json({ success: true, data: updated });
  } catch (e: unknown) {
    const err = e as Error;
    console.error('[API updateAiSettings] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
};

export const getPipelines = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const connection = await prisma.kommoConnection.findUnique({ where: { id } });
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada' });
      return;
    }

    const now = new Date();
    const timeRemainingMs = connection.expiresAt.getTime() - now.getTime();
    if (timeRemainingMs < 900000) {
      await refreshKommoToken(connection.kommoAccountId);
      const updatedConn = await prisma.kommoConnection.findUnique({ where: { kommoAccountId: connection.kommoAccountId } });
      if (updatedConn) connection.accessToken = updatedConn.accessToken;
    }

    const kommoResponse = await axios.get(`https://${connection.kommoSubdomain}.kommo.com/api/v4/leads/pipelines`, {
      headers: {
        'Authorization': `Bearer ${connection.accessToken}`
      }
    });

    const pipelinesData = kommoResponse.data?._embedded?.pipelines || [];

    const formattedPipelines = pipelinesData.map((pipeline: any) => {
      const statuses = pipeline._embedded?.statuses || [];
      return {
        id: pipeline.id,
        name: pipeline.name,
        statuses: statuses.map((status: any) => ({
          id: status.id,
          name: status.name,
          color: status.color
        }))
      };
    });

    res.json(formattedPipelines);
  } catch (error: any) {
    console.error('[API getPipelines] Erro:', error?.response?.data || error.message);
    res.status(500).json({ error: 'Erro interno ao buscar as pipelines.', details: error?.response?.data });
  }
};

export const kommoStatus = (req: Request, res: Response) => {
  const token = (req as any).kommoToken;
  const subdomain = (req as any).kommoSubdomain;
  res.json({ message: 'Token válido!', subdomain, token_preview: token.substring(0, 10) + '...' });
};
