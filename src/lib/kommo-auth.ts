import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

const prisma = new PrismaClient();

/**
 * 1. FUNÇÃO AUXILIAR DE REFRESH (Core)
 * Renova o access_token de uma conta usando o refresh_token atual salvo no banco.
 */
export async function refreshKommoToken(kommo_account_id: string): Promise<void> {
  try {
    const client_id = process.env.KOMMO_CLIENT_ID?.trim();
    const client_secret = process.env.KOMMO_CLIENT_SECRET?.trim();
    // Default fallback to APP_URL logic if KOMMO_REDIRECT_URI is not perfectly set.
    let redirect_uri = process.env.KOMMO_REDIRECT_URI?.trim();
    if (!redirect_uri && process.env.APP_URL) {
      redirect_uri = `${process.env.APP_URL.trim()}/auth/kommo/callback`;
    }

    if (!client_id || !client_secret || !redirect_uri) {
      throw new Error('Faltam credenciais do Kommo Hub (.env ou painel do Coolify)');
    }

    // Busca a conexão existente no banco
    const connection = await prisma.kommoConnection.findUnique({
      where: { kommo_account_id },
    });

    if (!connection) {
      throw new Error(`Conexão Kommo não encontrada para a conta ${kommo_account_id}.`);
    }

    console.log(`[Kommo Refresh] Solicitando novo token para conta ${kommo_account_id} via refresh_token...`);

    const payload = {
      client_id,
      client_secret,
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
      redirect_uri,
    };

    const tokenUrl = `https://${connection.kommo_subdomain}.kommo.com/oauth2/access_token`;

    const tokenResponse = await axios.post(tokenUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!access_token || !refresh_token) {
      throw new Error('A resposta de refresh não contem access_token ou refresh_token.');
    }

    // Calcula nova data de expiração (normalmente 24h)
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await prisma.kommoConnection.update({
      where: { kommo_account_id },
      data: {
        access_token,
        refresh_token,
        expires_at: expiresAt,
        updated_at: new Date(),
      },
    });

    console.log(`[Kommo Refresh] Tokens da conta ${kommo_account_id} atualizados com sucesso.`);
  } catch (error: unknown) {
    const err = error as any;
    console.error(`[Kommo Refresh] Erro ao renovar token para ${kommo_account_id}:`, err?.response?.data || err.message);
    throw err;
  }
}

/**
 * 2. MIDDLEWARE DE VERIFICAÇÃO AUTOMÁTICA
 * Verifica e renova o token antes da rota seguir (caso esteja há menos de 15 min de expirar).
 */
export async function ensureValidKommoToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Busca kommo_account_id ou empresa_id na query, body ou header
    const kommo_account_id = (req.query.kommo_account_id || req.body.kommo_account_id || req.headers['x-kommo-account-id']) as string;
    const empresa_id = (req.query.empresa_id || req.body.empresa_id || req.headers['x-empresa-id']) as string;

    if (!kommo_account_id && !empresa_id) {
      res.status(400).json({ error: 'O parâmetro kommo_account_id ou empresa_id é obrigatório para esta rota.' });
      return;
    }

    let connection;
    
    if (kommo_account_id) {
      connection = await prisma.kommoConnection.findUnique({
        where: { kommo_account_id },
      });
    } else {
      // Fallback para a primeira conta ativa encontrada para a empresa (se o front só mandar empresa_id)
      connection = await prisma.kommoConnection.findFirst({
        where: { empresa_id, is_active: true },
      });
    }

    if (!connection) {
      res.status(404).json({ error: 'Conexão Kommo não encontrada ou não autorizada para esta solicitação.' });
      return;
    }

    // Verifica se expirou ou expira em menos de 15 minutos (15 * 60 * 1000 = 900000ms)
    const now = new Date();
    const timeRemainingMs = connection.expires_at.getTime() - now.getTime();
    
    if (timeRemainingMs < 900000) {
      console.log(`[Kommo Middleware] Token da conta ${connection.kommo_account_id} expirando em breve. Atualizando...`);
      await refreshKommoToken(connection.kommo_account_id);
      
      // Busca atualizado para não usar old token
      connection = await prisma.kommoConnection.findUnique({
        where: { kommo_account_id: connection.kommo_account_id },
      });
    }

    if(connection) {
      // Adiciona o token à requisição p/ ser usado facilmente na próxima etapa
      (req as any).kommoToken = connection.access_token;
      (req as any).kommoSubdomain = connection.kommo_subdomain;
      (req as any).kommoAccountId = connection.kommo_account_id;
      (req as any).empresaId = connection.empresa_id;
    }

    next();
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Kommo Middleware] Erro:', err.message);
    res.status(500).json({ error: 'Erro interno ao validar/renovar o token da Kommo' });
  }
}
