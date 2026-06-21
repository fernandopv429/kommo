import { Queue } from 'bullmq';
import { redisConnection } from '../lib/redis';

// Define a fila do BullMQ apenas se existir URL
export let messageQueue: Queue | null = null;
if (process.env.REDIS_URL) {
  messageQueue = new Queue('evolution-messages', {
    connection: redisConnection
  });
}

export const addMessageToBuffer = async (tenantId: string, telefone_whatsapp: string, mensagem: string) => {
  if (!messageQueue || !process.env.REDIS_URL) {
     console.warn(`[Queue] Ignorando mensagem de ${telefone_whatsapp} pois REDIS_URL não está configurado.`);
     return;
  }
  const bufferKey = `buffer:${tenantId}:${telefone_whatsapp}`;
  
  // Adiciona a mensagem ao buffer no Redis (usando list)
  await redisConnection.rpush(bufferKey, mensagem);
  
  // Adiciona um job à fila com debounce de 8 segundos
  // Se já existir um job para essa chave na fila de delay, ele pode não ser sobrescrito imediatamente se usarmos apenas jobId.
  // Usar uma combinação de jobId constante garante que apenas um job exista aguardando.
  const jobId = `job:${tenantId}:${telefone_whatsapp}`;
  
  await messageQueue.add(
    'processMessages', 
    { tenantId, telefone_whatsapp, bufferKey },
    { 
      delay: 8000, 
      jobId: jobId,
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    }
  );
};
