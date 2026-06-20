import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://:qrvkcCepMlQkZo9VJD788Ulo7ZasHTphI7VbGwhbKpKHEPFnliavScCM0MwmYgyq@85.31.63.37:6380/0';

export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

redisConnection.on('error', (err) => console.error('[Redis Error]', err));
redisConnection.on('connect', () => console.log('[Redis] Conectado com sucesso.'));
