import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

// Initialize Prisma
// We won't crash the server if DB is not setup, but log it
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environmental variable checks
const getRequiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    console.warn(`[Aviso] Variável de ambiente ${key} não está configurada.`);
    return '';
  }
  return value;
};

const client_id = getRequiredEnv('KOMMO_CLIENT_ID');
const client_secret = getRequiredEnv('KOMMO_CLIENT_SECRET');
const redirect_uri = getRequiredEnv('KOMMO_REDIRECT_URI');

// --- ROTAS DO FLUXO OAUTH KOMMO --- //

/**
 * Rota 1: Iniciar Conexão OAuth
 * GET /auth/kommo/connect?empresa_id=...
 */
app.get('/auth/kommo/connect', (req: Request, res: Response) => {
  try {
    const { empresa_id } = req.query;

    if (!empresa_id || typeof empresa_id !== 'string') {
      res.status(400).json({ error: 'O parâmetro empresa_id é obrigatório e deve ser uma string.' });
      return;
    }

    if (!client_id || !redirect_uri) {
      res.status(500).json({ error: 'Faltam credenciais do Kommo Hub no servidor (.env).' });
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
    // A documentação pede 'subdomain'. Kommo frequentemente manda via 'referer' ex: (meusubdominio.kommo.com)
    // Vamos capturar ambos para maior robustez, porém focado em 'subdomain' como pedido.
    const code = req.query.code as string;
    const state = req.query.state as string;
    const referer = req.query.referer as string; 
    let subdomain = req.query.subdomain as string;

    const empresa_id = state;

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

    // Timestamp de expiração
    // O expires_in costuma ser o tempo de vida em segundos (ex: 86400)
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Salvar ou atualizar no Banco de Dados PostgreSQL via Prisma
    await prisma.kommoConnection.upsert({
      where: { empresa_id },
      update: {
        kommo_subdomain: subdomain,
        access_token,
        refresh_token,
        expires_at: expiresAt,
      },
      create: {
        empresa_id,
        kommo_subdomain: subdomain,
        access_token,
        refresh_token,
        expires_at: expiresAt,
      }
    });

    console.log(`[Kommo OAuth] Tokens da empresa ${empresa_id} salvos com sucesso.`);

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
          <p>Detalhes: ${error?.response?.data?.title || error.message}</p>
        </body>
      </html>
    `);
  }
});


// Rota útil para o frontend: listar integrações (mock ou real apenas se DB estiver online para prevenir crash)
app.get('/api/connections', async (req: Request, res: Response) => {
  try {
    const connections = await prisma.kommoConnection.findMany({
      select: {
          id: true,
          empresa_id: true,
          kommo_subdomain: true,
          expires_at: true,
          updated_at: true
      }
    });
    res.json(connections);
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message && err.message.includes('Can\'t reach database')) {
      res.json([{
        id: '123',
        empresa_id: 'exemplo-banco-offline',
        kommo_subdomain: 'demo',
        expires_at: new Date(),
        updated_at: new Date()
      }]);
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// Inicializar Vite/Server
async function startServer() {
  try {
    // Tenta criar a tabela automaticamente caso não exista (Ideal para subir no Coolify sem dor de cabeça)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS kommo_connections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id VARCHAR(255) NOT NULL UNIQUE,
          kommo_subdomain VARCHAR(255) NOT NULL,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
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
