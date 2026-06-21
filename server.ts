import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { createServer as createViteServer } from 'vite';
import cron from 'node-cron';

import { refreshKommoToken } from './src/lib/kommo-auth';
import './src/queues/messageWorker'; // Inicia o worker

// Import das Rotas
import systemRoutes from './src/routes/system.routes';
import openaiRoutes from './src/routes/openai.routes';
import kommoAuthRoutes from './src/routes/kommo-auth.routes';
import kommoRoutes from './src/routes/kommo.routes';
import evolutionRoutes from './src/routes/evolution.routes';
import webhooksRoutes from './src/routes/webhooks.routes';

const app = express();
const PORT = 3000;
const prisma = new PrismaClient();

app.use(cors());
// Aumento dos limites para evitar payloads cortados (A API Evolution às vezes manda jsons enormes em mensagens como vídeos/áudios)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware global para registrar as conexões chegando (Apenas para debug)
app.use((req, res, next) => {
  if (!req.url.includes('/assets/') && !req.url.includes('.js') && !req.url.includes('.css')) {
    console.log(`[Request] ${req.method} ${req.url}`);
  }
  next();
});

// Montar rotas
app.use('/api', systemRoutes);
app.use('/api/openai', openaiRoutes);
app.use('/auth/kommo', kommoAuthRoutes);
app.use('/api', kommoRoutes); 
app.use('/api', evolutionRoutes);
app.use('/api/webhooks', webhooksRoutes);

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
