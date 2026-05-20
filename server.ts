import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { createServer as createViteServer } from 'vite';
import cron from 'node-cron';
import { refreshKommoToken, ensureValidKommoToken } from './src/lib/kommo-auth';

const app = express();
const PORT = 3000;

// Initialize Prisma
// We won't crash the server if DB is not setup, but log it
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

    const { empresa_id } = req.query;

    if (!empresa_id || typeof empresa_id !== 'string') {
      res.status(400).json({ error: 'O parâmetro empresa_id é obrigatório e deve ser uma string.' });
      return;
    }

    if (!client_id || !redirect_uri) {
      res.status(500).json({ 
        error: 'Faltam credenciais do Kommo Hub no servidor (.env ou painel do Coolify).',
        details: { hasClientId: !!client_id, hasRedirectUri: !!redirect_uri }
      });
      return;
    }

    // Na arquitetura da Kommo (standard), a janela de permissão é geralmente disparada via botão 
    // ou redirecionando o lojista para o marketplace/oauth.
    // O URL padrão para solicitação de autorização no Kommo é na raiz global.
    // Utilizaremos www.kommo.com/oauth
    const kommoAuthUrl = new URL('https://www.kommo.com/oauth');
    kommoAuthUrl.searchParams.append('client_id', client_id);
    kommoAuthUrl.searchParams.append('state', empresa_id);
    kommoAuthUrl.searchParams.append('mode', 'popup'); 
    // Nota: dependendo da implementação e mercado (Kommo / AmoCRM), 
    // podem ser precisos outros parâmetros.

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

    // Buscando as variáveis direto aqui dentro também 💡
    const client_id = process.env.KOMMO_CLIENT_ID;
    const client_secret = process.env.KOMMO_CLIENT_SECRET;
    const redirect_uri = process.env.KOMMO_REDIRECT_URI || (process.env.APP_URL ? `${process.env.APP_URL}/auth/kommo/callback` : undefined);

    const empresa_id = state;

    if (!client_id || !client_secret || !redirect_uri) {
      res.status(500).send('Faltam credenciais do Kommo Hub no servidor (.env ou painel do Coolify).');
      return;
    }

    if (!code || !empresa_id) {
       res.status(400).send('Parâmetros "code" e "state (empresa_id)" são obrigatórios.');
       return;
    }

    // Se a Kommo mandou referer(ex: 'empresa123.kommo.com') invés de 'subdomain' explícito
    if (!subdomain && referer) {
      subdomain = referer.split('.')[0];
    } else if (!subdomain) {
      res.status(400).send('Subdomínio não identificado no callback da Kommo (referer ou subdomain faltante).');
      return;
    }

    console.log(`[Kommo OAuth] Callback recebido da empresa ${empresa_id} no subdomínio ${subdomain}.`);

    // Payload para obter os Tokens
    const payload = {
      client_id,
      client_secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri,
    };

    const tokenUrl = `https://${subdomain}.kommo.com/oauth2/access_token`;

    // Chamada HTTP para obter o token de acesso
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

    // Timestamp de expiração
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Salvar ou atualizar no Banco de Dados PostgreSQL via Prisma
    await prisma.kommoConnection.upsert({
      where: { kommo_account_id: kommoAccountId },
      update: {
        empresa_id: empresa_id,
        kommo_subdomain: subdomain,
        account_name: accountName,
        is_active: true,
        access_token,
        refresh_token,
        expires_at: expiresAt,
      },
      create: {
        empresa_id: empresa_id,
        kommo_account_id: kommoAccountId,
        kommo_subdomain: subdomain,
        account_name: accountName,
        is_active: true,
        access_token,
        refresh_token,
        expires_at: expiresAt,
      }
    });

    console.log(`[Kommo OAuth] Tokens da conta ${kommoAccountId} (empresa ${empresa_id}) salvos com sucesso.`);

    // Mensagem de sucesso amigável (ou redirecionamento para o dashboard real da empresa)
    res.send(`
      <html>
        <head><title>Integração Concluída</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2>Integração com Kommo Finalizada com Sucesso! 🚀</h2>
          <p>Os tokens foram salvos para a empresa <strong>${empresa_id}</strong> no subdomínio ${subdomain}.kommo.com.</p>
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


// 1. ROTA DE LISTAGEM DE CONTAS
app.get('/api/tenants/:tenant_id/connections', async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;
    const connections = await prisma.kommoConnection.findMany({
      where: { empresa_id: tenant_id },
      select: {
          id: true,
          kommo_subdomain: true,
          kommo_account_id: true,
          account_name: true,
          is_active: true,
          expires_at: true,
          updated_at: true
      }
    });
    res.json(connections);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3. ROTA DE WEBHOOK CENTRALIZADA INTEGRADA AO N8N
 * POST /api/webhooks/kommo
 */
app.post('/api/webhooks/kommo', async (req: Request, res: Response) => {
  try {
    // A Kommo manda o payload urlencoded ou json
    // O ID da conta costuma vir em req.body.account?.id ou req.body.account_id dependendo de como é recebido
    const kommoAccountIdStr = req.body?.account?.id || req.body?.account_id || req.query.account_id;
    
    if (!kommoAccountIdStr) {
      console.warn('[Webhook Kommo] Evento recebido sem ID de conta (account.id).');
      res.status(400).send('ID da conta não identificado no webhook.');
      return;
    }

    const kommoAccountId = String(kommoAccountIdStr);
    
    // Busca banco
    const connection = await prisma.kommoConnection.findUnique({
      where: { kommo_account_id: kommoAccountId }
    });

    if (!connection || !connection.is_active) {
      console.warn(`[Webhook Kommo] Recebido evento para conta ${kommoAccountId} inativa ou não encontrada.`);
      res.status(404).send('Conexão não encontrada ou inativa.');
      return;
    }

    // Verifica token expiração e renova pre-emptivamente se necessário (<15 min)
    const now = new Date();
    const timeRemainingMs = connection.expires_at.getTime() - now.getTime();
    if (timeRemainingMs < 900000) {
      console.log(`[Webhook Kommo] Renovando token preventivamente no webhook para conta ${kommoAccountId}`);
      await refreshKommoToken(kommoAccountId);
      // Pega novamente
      const updatedConn = await prisma.kommoConnection.findUnique({ where: { kommo_account_id: kommoAccountId }});
      if(updatedConn) connection.access_token = updatedConn.access_token;
    }

    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nUrl) {
      console.error('[Webhook Kommo] Variavél N8N_WEBHOOK_URL não configurada no servidor.');
      // Retorna 200 pra kommo pra ela não tentar reenviar infinitamente bloqueando a fila de Webhooks
      res.status(200).send('N8N_WEBHOOK_URL was missing.');
      return;
    }

    // Disparo pro N8N
    const payloadToN8n = {
      tenant_id: connection.empresa_id,
      kommo_account_id: kommoAccountId,
      subdomain: connection.kommo_subdomain,
      access_token: connection.access_token,
      event_data: req.body
    };

    // Dispara assíncrono para liberar a Kommo rápido
    axios.post(n8nUrl, payloadToN8n).catch(err => {
      console.error('[Webhook Kommo] Falha ao enviar para o N8N:', err.message);
    });

    // Retorna OK pra kommo rapidamente
    res.status(200).send('OK');
  } catch (error: any) {
    console.error('[Webhook Kommo] Erro crítico no webhook:', error.message);
    res.status(500).send('Internal Error');
  }
});

// Rota útil para o frontend: listar integrações (ativas)
app.get('/api/connections/active', async (req: Request, res: Response) => {
  try {
    const connections = await prisma.kommoConnection.findMany({
      where: { is_active: true },
      select: {
          id: true,
          empresa_id: true,
          account_name: true,
          kommo_subdomain: true,
          expires_at: true,
          updated_at: true
      },
      orderBy: { created_at: 'desc' }
    });
    res.json(connections);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(500).json({ error: err.message });
  }
});

// Rota útil para o frontend: listar integrações (inativas)
app.get('/api/connections/inactive', async (req: Request, res: Response) => {
  try {
    const connections = await prisma.kommoConnection.findMany({
      where: { is_active: false },
      select: {
          id: true,
          empresa_id: true,
          account_name: true,
          kommo_subdomain: true,
          expires_at: true,
          updated_at: true
      },
      orderBy: { created_at: 'desc' }
    });
    res.json(connections);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(500).json({ error: err.message });
  }
});

// Alternar status
app.patch('/api/connections/:id/toggle-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const connection = await prisma.kommoConnection.findUnique({ where: { id } });
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada' });
      return;
    }
    
    const updated = await prisma.kommoConnection.update({
      where: { id },
      data: { is_active: !connection.is_active }
    });
    
    res.json({ success: true, is_active: updated.is_active });
  } catch (e: unknown) {
    const err = e as Error;
    res.status(500).json({ error: err.message });
  }
});

// Exemplo de rota protegida que usa o Middleware
app.get('/api/kommo/status', ensureValidKommoToken, (req: Request, res: Response) => {
  // Se chegou aqui, o token é válido e está no req (adicionado pelo middleware)
  const token = (req as any).kommoToken;
  const subdomain = (req as any).kommoSubdomain;
  res.json({ message: 'Token válido!', subdomain, token_preview: token.substring(0, 10) + '...' });
});

// Inicializar Vite/Server e Cron Job
async function startServer() {
  // 3. CRON JOB (Rotina de Segundo Plano - a cada 1 hora)
  // "0 * * * *" = roda no minuto 0 de cada hora
  cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Iniciando verificação preventiva de tokens da Kommo...');
    try {
      // Busca conexões que vão expirar nas próximas 2 horas (2 * 60 * 60 * 1000)
      const futureCheckDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      
      const connectionsToRefresh = await prisma.kommoConnection.findMany({
        where: {
          expires_at: {
            lte: futureCheckDate // expira antes dessa data futura
          }
        }
      });

      console.log(`[Cron] Encontradas ${connectionsToRefresh.length} conexões para renovar.`);

      for (const conn of connectionsToRefresh) {
        try {
          await refreshKommoToken(conn.kommo_account_id);
        } catch (err: any) {
          console.error(`[Cron] Falha ao renovar token da conta ${conn.kommo_account_id}:`, err.message);
        }
      }
    } catch (error) {
      console.error('[Cron] Erro geral na varredura de tokens:', error);
    }
  });
  console.log('[Cron] Job de renovação de tokens agendado (1h).');

  try {
    // Tenta criar a tabela automaticamente caso não exista (Ideal para subir no Coolify sem dor de cabeça)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS kommo_connections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id VARCHAR(255) NOT NULL,
          kommo_subdomain VARCHAR(255) NOT NULL,
          kommo_account_id VARCHAR(255) UNIQUE,
          account_name VARCHAR(255),
          is_active BOOLEAN DEFAULT true,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Migrações safe do código para caso a tabela já exista:
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE kommo_connections DROP CONSTRAINT IF EXISTS kommo_connections_empresa_id_key;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE kommo_connections ADD COLUMN IF NOT EXISTS kommo_account_id VARCHAR(255) UNIQUE;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE kommo_connections ADD COLUMN IF NOT EXISTS account_name VARCHAR(255);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE kommo_connections ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);
    } catch(e) {
      // Ignora erro se tentar alterar. Na maioria dos providers isso é bypass
    }

    console.log('[DB] Tabela kommo_connections verificada/criada com sucesso no PostgreSQL!');
  } catch (error: unknown) {
    const err = error as Error;
    console.warn('[DB] Aviso: Não foi possível criar/verificar a tabela (o banco pode estar offline ou a URL inválida):', err.message);
  }

  // Vite middleware for development
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
