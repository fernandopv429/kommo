import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
let errorLogged = false;

export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => {
    if (!process.env.REDIS_URL) {
      if (!errorLogged) {
        console.warn('[Redis] REDIS_URL não definido. Ignorando tentativas de conexão.');
        errorLogged = true;
      }
      return null;
    }
    return Math.min(times * 50, 2000);
  }
});

redisConnection.on('error', (err) => {
  if (process.env.REDIS_URL) {
    console.error('[Redis Error]', err.message);
  }
});
redisConnection.on('connect', () => console.log('[Redis] Conectado com sucesso.'));
