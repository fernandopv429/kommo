import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

const prisma = new PrismaClient();

/**
 * 1. FUNÇÃO AUXILIAR DE REFRESH (Core)
 * Renova o access_token de uma conta usando o refresh_token atual salvo no banco.
 */
export async function refreshKommoToken(kommoAccountId: string): Promise<void> {
  try {
    const client_id = process.env.KOMMO_CLIENT_ID?.trim();
    const client_secret = process.env.KOMMO_CLIENT_SECRET?.trim();
    let redirect_uri = process.env.KOMMO_REDIRECT_URI?.trim();
    if (!redirect_uri && process.env.APP_URL) {
      redirect_uri = `${process.env.APP_URL.trim()}/auth/kommo/callback`;
    }
    if (!redirect_uri) {
      redirect_uri = 'https://tarif.nexusdevhub.com/auth/kommo/callback';
    }

    if (!client_id || !client_secret || !redirect_uri) {
      throw new Error('Faltam credenciais do Kommo Hub (.env ou painel do Coolify)');
    }

    // Busca a conexão existente no banco
    const connection = await prisma.kommoConnection.findUnique({
      where: { kommoAccountId },
    });

    if (!connection) {
      throw new Error(`Conexão Kommo não encontrada para a conta ${kommoAccountId}.`);
    }

    console.log(`[Kommo Refresh] Solicitando novo token para conta ${kommoAccountId} via refresh_token...`);

    const payload = {
      client_id,
      client_secret,
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken,
      redirect_uri,
    };

    const tokenUrl = `https://${connection.kommoSubdomain}.kommo.com/oauth2/access_token`;

    const tokenResponse = await axios.post(tokenUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!access_token || !refresh_token) {
      throw new Error('A resposta de refresh não contem access_token ou refresh_token.');
    }

    // Calcula nova data de expiração
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await prisma.kommoConnection.update({
      where: { kommoAccountId },
      data: {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt,
        updatedAt: new Date(),
      },
    });

    console.log(`[Kommo Refresh] Tokens da conta ${kommoAccountId} atualizados com sucesso.`);
  } catch (error: unknown) {
    const err = error as any;
    console.error(`[Kommo Refresh] Erro ao renovar token para ${kommoAccountId}:`, err?.response?.data || err.message);
    throw err;
  }
}

/**
 * 2. MIDDLEWARE DE VERIFICAÇÃO AUTOMÁTICA
 */
export async function ensureValidKommoToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const kommoAccountId = (req.query.kommoAccountId || req.body.kommoAccountId || req.headers['x-kommo-account-id']) as string;
    const tenantId = (req.query.tenantId || req.body.tenantId || req.headers['x-tenant-id']) as string;

    if (!kommoAccountId && !tenantId) {
      res.status(400).json({ error: 'O parâmetro kommoAccountId ou tenantId é obrigatório para esta rota.' });
      return;
    }

    let connection;
    
    if (kommoAccountId) {
      connection = await prisma.kommoConnection.findUnique({
        where: { kommoAccountId },
      });
    } else {
      connection = await prisma.kommoConnection.findFirst({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'desc' }
      });
    }

    if (!connection) {
      res.status(404).json({ error: 'Conexão Kommo não encontrada ou não autorizada para esta solicitação.' });
      return;
    }

    const now = new Date();
    const timeRemainingMs = connection.expiresAt.getTime() - now.getTime();
    
    if (timeRemainingMs < 900000) {
      console.log(`[Kommo Middleware] Token da conta ${connection.kommoAccountId} expirando em breve. Atualizando...`);
      await refreshKommoToken(connection.kommoAccountId);
      
      const updatedConn = await prisma.kommoConnection.findUnique({
        where: { kommoAccountId: connection.kommoAccountId },
      });
      if (updatedConn) {
        connection = updatedConn;
      }
    }

    if (connection) {
      (req as any).kommoToken = connection.accessToken;
      (req as any).kommoSubdomain = connection.kommoSubdomain;
      (req as any).kommoAccountId = connection.kommoAccountId;
      (req as any).tenantId = connection.tenantId;
    }

    next();
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Kommo Middleware] Erro:', err.message);
    res.status(500).json({ error: 'Erro interno ao validar/renovar o token da Kommo' });
  }
}

/**
 * 3. FUNÇÃO DE REGISTRO DE WEBHOOK
 * Registra o webhook na Kommo para receber atualizações de leads
 */
export async function registerKommoWebhook(kommoAccountId: string): Promise<void> {
  try {
    const connection = await prisma.kommoConnection.findUnique({
      where: { kommoAccountId },
    });

    if (!connection) {
      throw new Error(`Conexão Kommo não encontrada para a conta ${kommoAccountId}.`);
    }

    const { accessToken, kommoSubdomain } = connection;
    
    // Utilize a URL do app se disponível, senão fallback p/ a URL do seu painel
    const destination = process.env.APP_URL 
      ? `${process.env.APP_URL.trim()}/api/webhooks/kommo`
      : "https://tarif.nexusdevhub.com/api/webhooks/kommo";

    const webhookUrl = `https://${kommoSubdomain}.kommo.com/api/v4/webhooks`;

    const payload = {
      destination,
      settings: [
        "add_lead",
        "status_lead"
      ]
    };

    console.log(`[Webhook Register] Registrando webhook para conta ${kommoAccountId} no destino ${destination}...`);

    await axios.post(webhookUrl, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      }
    });

    console.log(`[Webhook Register] Webhook cadastrado com sucesso para a conta ${kommoAccountId}.`);
  } catch (error: any) {
    // Trata caso a Kommo responda que já existe
    if (error.response?.data && JSON.stringify(error.response.data).includes('already exists')) {
      console.log(`[Webhook Register] O webhook já estava cadastrado para a conta ${kommoAccountId}.`);
    } else {
      console.error(`[Webhook Register] Erro ao cadastrar webhook para ${kommoAccountId}:`, error.response?.data || error.message);
    }
  }
}
