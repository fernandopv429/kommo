import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';

export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

redisConnection.on('error', (err) => console.error('[Redis Error]', err));
redisConnection.on('connect', () => console.log('[Redis] Conectado com sucesso.'));
