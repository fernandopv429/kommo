import { Worker, Job } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { fetchLeadData } from '../lib/kommo-utils';
import { handleGeminiRouting } from '../lib/ai-routing';
import { refreshKommoToken } from '../lib/kommo-auth';

const prisma = new PrismaClient();

export let messageWorker: Worker | null = null;

if (process.env.REDIS_URL) {
  messageWorker = new Worker(
    'evolution-messages',
    async (job: Job) => {
    const { tenantId, telefone_whatsapp, bufferKey } = job.data;

    console.log(`[Worker] Iniciando job ${job.id} para ${tenantId}:${telefone_whatsapp}`);

    // Extrair mensagens concatenadas
    const mensagensArr = await redisConnection.lrange(bufferKey, 0, -1);
    if (!mensagensArr || mensagensArr.length === 0) {
      console.log(`[Worker] Nenhuma mensagem encontrada no buffer ${bufferKey}. Ignorando.`);
      return;
    }

    // Limpar o buffer APÓS capturar as mensagens, assim novas mensagens começarão um novo ciclo
    await redisConnection.del(bufferKey);

    const mensagem_whatsapp = mensagensArr.join('\\n');
    console.log(`[Worker] Mensagem consolidada (${mensagensArr.length} msgs): "${mensagem_whatsapp}"`);

    const connection = await prisma.kommoConnection.findFirst({
      where: { tenantId: tenantId, isActive: true }
    });

    if (!connection) {
      console.warn(`[Worker] Conexão Kommo não encontrada para o tenant ${tenantId}.`);
      return;
    }

    // Renova o token se estiver perto de expirar
    const now = new Date();
    const timeRemainingMs = connection.expiresAt.getTime() - now.getTime();
    if (timeRemainingMs < 900000) {
      await refreshKommoToken(connection.kommoAccountId);
      const updatedConn = await prisma.kommoConnection.findUnique({ where: { kommoAccountId: connection.kommoAccountId } });
      if (updatedConn) connection.accessToken = updatedConn.accessToken;
    }

    const { exists: lead_existe, lead: finalLeadData, source: lead_source } = await fetchLeadData(tenantId, telefone_whatsapp, connection) as any;

    // Analisa a mensagem com Gemini para mover de etapa
    let ai_parsed: any = {};
    let ai_text_response: string | null = null;
    let action_taken: string | null = null;

    if (lead_existe && finalLeadData) {
      const oldStatusId = finalLeadData.status_id;
      const pipelineId = finalLeadData.pipeline_id;
      
      const isPipelineActive = connection.aiActivePipelines && connection.aiActivePipelines.includes(pipelineId);
      const isStageActive = connection.aiActiveStages && connection.aiActiveStages.includes(oldStatusId);
      
      // A IA só atua se o global estiver ativo, O FUNIL estiver ativo E A ETAPA estiver ativa.
      const isAiActive = connection.aiEnabled && isPipelineActive && isStageActive;

      if (isAiActive) {
        ai_parsed = await handleGeminiRouting(connection, mensagem_whatsapp, finalLeadData) || {};
        
        const novoStatusNum = Number(ai_parsed.novoStatusId);
        const isStatusChanged = !isNaN(novoStatusNum) && novoStatusNum > 0 && novoStatusNum !== Number(oldStatusId);

        if (isStatusChanged) {
          finalLeadData.status_id = novoStatusNum;
          action_taken = `Moveu para etapa ${novoStatusNum}`;
        } else {
          action_taken = "Manteve na etapa atual";
        }

        if (ai_parsed.custom_fields && ai_parsed.custom_fields.length > 0) {
          action_taken = action_taken ? `${action_taken} | Atualizou campos` : "Atualizou campos";
        }
        ai_text_response = JSON.stringify(ai_parsed);
      } else {
        action_taken = "Ignorado (IA desativada para esta etapa)";
      }
    } else {
      action_taken = "Ignorado (Lead inexistente)";
    }

    // Criar o log da interação
    try {
      await prisma.interactionLog.create({
        data: {
          tenantId: tenantId,
          leadId: finalLeadData ? String(finalLeadData.id) : null,
          whatsappNumber: telefone_whatsapp,
          incomingMessage: mensagem_whatsapp,
          aiResponse: ai_text_response,
          actionTaken: action_taken,
          status: 'SUCCESS'
        }
      });
    } catch (e: any) {
      console.warn(`[Worker] Falha ao salvar InteractionLog:`, e.message);
    }

    // Repasse completo para o n8n
    const webhookSetting = await prisma.systemSetting.findUnique({ where: { key: 'N8N_WEBHOOK_URL' } });
    const n8nUrl = webhookSetting?.value || process.env.N8N_WEBHOOK_URL;
    
    if (n8nUrl) {
      const payloadToN8n: any = {
        mensagem_whatsapp,
        telefone_whatsapp,
        lead_existe,
        lead: finalLeadData,
        access_token: connection.accessToken,
        subdomain: connection.kommoSubdomain,
        tenantId: connection.tenantId,

        Lead_id: finalLeadData ? finalLeadData.id : null,
        Nome: finalLeadData ? finalLeadData.name : "",
        Status_id: (ai_parsed.novoStatusId && Number(ai_parsed.novoStatusId) > 0) ? Number(ai_parsed.novoStatusId) : (finalLeadData ? finalLeadData.status_id : null),
        campos_personalizados_lead: finalLeadData ? finalLeadData.custom_fields : {},
        has_update: ((ai_parsed.novoStatusId && Number(ai_parsed.novoStatusId) > 0 && Number(ai_parsed.novoStatusId) !== Number(finalLeadData ? finalLeadData.status_id : null))) || (ai_parsed.custom_fields && ai_parsed.custom_fields.length > 0),
        campos_personalizados_atualizados_ia: ai_parsed.custom_fields || []
      };

      if (finalLeadData && finalLeadData.custom_fields) {
        Object.entries(finalLeadData.custom_fields).forEach(([key, value]) => {
          if (key && value) {
            payloadToN8n[key] = value;
          }
        });
      }

      if (ai_parsed.custom_fields && Array.isArray(ai_parsed.custom_fields)) {
        ai_parsed.custom_fields.forEach((cf: any) => {
          if (cf.field_name && cf.value) {
            payloadToN8n[cf.field_name] = cf.value;
          }
        });
      }

      try {
        await axios.post(n8nUrl, payloadToN8n);
        console.log(`[Worker] Encaminhado com sucesso para o n8n do tenant ${tenantId}`);
      } catch (err: any) {
        console.warn(`[Worker] Erro ao enviar para N8N: ${err.message}`);
      }
    } else {
      console.warn(`[Worker] Webhook N8N não configurado.`);
    }

    // Atualiza o cache persistente
    if (lead_existe && finalLeadData && lead_source === 'api') {
      try {
        await prisma.kommoLeadCache.upsert({
          where: { tenantId_phoneNumber: { tenantId, phoneNumber: telefone_whatsapp } },
          update: {
            leadId: finalLeadData.id,
            name: finalLeadData.name,
            price: finalLeadData.price || 0,
            statusId: finalLeadData.status_id,
            pipelineId: finalLeadData.pipeline_id,
            tags: finalLeadData.tags || [],
            customFields: { ...finalLeadData.custom_fields, _contatoObj: finalLeadData.contato },
            updatedAt: new Date()
          },
          create: {
            tenantId,
            phoneNumber: telefone_whatsapp,
            leadId: finalLeadData.id,
            name: finalLeadData.name,
            price: finalLeadData.price || 0,
            statusId: finalLeadData.status_id,
            pipelineId: finalLeadData.pipeline_id,
            tags: finalLeadData.tags || [],
            customFields: { ...finalLeadData.custom_fields, _contatoObj: finalLeadData.contato }
          }
        });
      } catch (e: any) {
         console.warn(`[Worker] Erro ao atualizar cache persistente:`, e.message);
      }
    }
  },
  {
    connection: redisConnection,
    concurrency: 10 // processar várias mensagens independentes em paralelo se precisar
  }
);
}

if (messageWorker) {
  messageWorker.on('completed', job => {
    console.log(`[Worker] Job ${job.id} concluído com sucesso.`);
  });

  messageWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} falhou com erro: ${err.message}`);
  });
}
