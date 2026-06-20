import axios from 'axios';
import OpenAI from "openai";
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function handleGeminiRouting(connection: any, mensagem_whatsapp: string, leadData: any) {
  try {
    if (!leadData || !leadData.pipeline_id || !leadData.status_id) return null;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('[AI Routing] OPENAI_API_KEY não configurada. Pulando análise IA.');
      return null;
    }
    
    const pipelineId = leadData.pipeline_id;
    if (!pipelineId) {
      console.warn('[Gemini Routing] Pipeline ID missing in leadData:', leadData);
      return null;
    }
    
    // Buscar etapas do pipeline
    const axiosConfig = {
      headers: { 'Authorization': `Bearer ${connection.accessToken}` }
    };
    
    console.log(`[Gemini Routing] Fetching statuses for pipeline ID: ${pipelineId}`);
    const pipeRes = await axios.get(
      `https://${connection.kommoSubdomain}.kommo.com/api/v4/leads/pipelines/${pipelineId}`,
      axiosConfig
    );
    
    const statusesRaw = pipeRes.data?._embedded?.statuses || [];
    console.log(`[Gemini Routing] Pipeline fetched. Statuses count: ${statusesRaw.length}`);
    const statuses = statusesRaw
      .filter((s: any) => s.id !== 142 && s.id !== 143) // Ignore Won and Lost by default
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description || "" 
      }));

    // Buscar campos personalizados
    let customFieldsContext = "";
    try {
      const cfRes = await axios.get(
        `https://${connection.kommoSubdomain}.kommo.com/api/v4/leads/custom_fields`,
        axiosConfig
      );
      const customFieldsRaw = cfRes.data?._embedded?.custom_fields || [];
      const cfs = customFieldsRaw.map((cf: any) => ({
        id: cf.id,
        name: cf.name,
        type: cf.type
      }));
      customFieldsContext = `\nAqui estão os campos personalizados disponíveis do Lead:\n${JSON.stringify(cfs, null, 2)}`;
    } catch (err: any) {
      console.warn('[Gemini Routing] Falha ao buscar custom fields', err.message);
    }
    
    console.log(`\n======================================================`);
    console.log(`[AI Routing] INICIANDO ANÁLISE DE ROTEAMENTO (LEAD ID: ${leadData.id})`);
    console.log(`[AI Routing] Mensagem recebida: "${mensagem_whatsapp}"`);
    console.log(`======================================================`);

    const openai = new OpenAI({ apiKey });
    
    // 1. Encontrar o nome amigável da etapa atual para dar contexto real à IA
    const etapaAtualObj = statuses.find((s: any) => Number(s.id) === Number(leadData.status_id));
    const nomeEtapaAtual = etapaAtualObj ? etapaAtualObj.name : "Desconhecida";

    console.log(`[AI Routing] Mapeamento de Status disponíveis para este Pipeline:`);
    console.log(JSON.stringify(statuses, null, 2));

    const prompt = `Você é um analista de CRM inteligente e perspicaz, responsável por mover leads pelas etapas do funil de vendas (pipeline) baseado estritamente na intenção da última mensagem comercial enviada pelo cliente.

=== CONTEXTO ATUAL DO LEAD ===
- Última Mensagem do Lead: "${mensagem_whatsapp}"
- Etapa Onde o Lead Está Agora: ID ${leadData.status_id} (Nome da Etapa: "${nomeEtapaAtual}")

=== ETAPAS DISPONÍVEIS NO FUNIL (A DECISÃO DEVE SER UM DESTES IDs) ===
Analise os NOMES e as DESCRIÇÕES abaixo para identificar para onde o lead deve avançar:
${JSON.stringify(statuses, null, 2)}

${customFieldsContext}

=== REGRAS DE TRANSIÇÃO CRÍTICAS ===
1. Compare a intenção da "Última Mensagem do Lead" com as Etapas Disponíveis, avaliando o significado e propósito de cada etapa.
2. Se a mensagem do cliente indicar forte intenção de avançar no funil para uma das próximas etapas mapeadas, você OBRIGATORIAMENTE deve retornar o ID dessa nova etapa no campo "novoStatusId".
   - A decisão deve ser baseada nas etapas reais do pipeline informadas acima. Não "invente" status que não estão na lista.
   - Encontre a etapa que casa perfeitamente com a intenção da mensagem. Exemplo genérico: Se a intenção é marcar um compromisso, e existir uma etapa cujo objetivo seja agendamento/reunião, mude para ela. Se a intenção for envio de proposta e houver etapa de proposta, mude para ela.
3. Se a mensagem for apenas um agradecimento ("Obrigado"), uma saudação ("Olá", "Tudo bem?"), uma dúvida isolada ou algo que NÃO indique avanço real no processo de vendas, ele DEVE PERMANECER na etapa atual. Nesse caso, retorne exatamente o ID atual: ${leadData.status_id}.

=== PREENCHIMENTO DE CAMPOS PERSONALIZADOS ===
Sua tarefa também inclui identificar se a mensagem traz informações para preencher campos personalizados:
- Se houver dados (ex: email, nome, CPF) que correspondam a um campo listado, preencha a array 'custom_fields' com 'field_id', 'field_name', e 'value'.
- Se não houver dados, retorne uma array vazia [].

=== EXEMPLOS DE COMPORTAMENTO ===
- Se a mensagem indica claramente que o usuário realizou a ação esperada para avançar para a etapa X -> Saída: {"novoStatusId": <ID_DA_ETAPA_X>, "custom_fields": []}
- Mensagem: "Beleza, valeu!" -> Saída (MANTÉM): {"novoStatusId": ${leadData.status_id}, "custom_fields": []}
- Mensagem: "Meu email é ola@teste.com" -> Saída (MANTÉM STATUS, ATUALIZA CAMPO): {"novoStatusId": ${leadData.status_id}, "custom_fields": [{"field_id": 999123, "field_name": "Email", "value": "ola@teste.com"}]}

Retorne exclusivamente o JSON preenchido. O "novoStatusId" DEVE ser um número inteiro correspondente ao ID de uma das etapas válidas, caso contrário o sistema falhará.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "crm_routing_response",
          schema: {
            type: "object",
            properties: {
              novoStatusId: { type: "number", description: "ID exato da nova etapa, ou da etapa atual se não houver mudança" },
              custom_fields: { 
                type: "array", 
                items: {
                  type: "object",
                  properties: {
                    field_id: { type: "number", description: "ID of the custom field" },
                    field_name: { type: "string", description: "Name of the custom field" },
                    value: { type: "string", description: "Extracted value for the field" }
                  },
                  required: ["field_id", "field_name", "value"],
                  additionalProperties: false
                }
              }
            },
            required: ["novoStatusId", "custom_fields"],
            additionalProperties: false
          },
          strict: true
        }
      }
    });
    
    const rawText = response.choices[0].message.content || "{}";
    console.log('[AI Routing] Resposta bruta da IA recebida:', rawText);

    const parsed = JSON.parse(rawText.trim());
    console.log('[AI Routing] JSON processado pela IA:', JSON.stringify(parsed, null, 2));
    
    const fieldsToUpdate: any[] = [];
    if (parsed.custom_fields && Array.isArray(parsed.custom_fields)) {
      parsed.custom_fields.forEach((cf: any) => {
        if (cf.field_id && cf.value) {
          fieldsToUpdate.push({ field_id: Number(cf.field_id), values: [{ value: cf.value }] });
        }
      });
    }

    const novoStatus = Number(parsed.novoStatusId);
    const hasStatusChange = !isNaN(novoStatus) && novoStatus > 0 && novoStatus !== Number(leadData.status_id);
    const hasFields = fieldsToUpdate.length > 0;

    if (hasStatusChange || hasFields) {
      console.log(`[AI Routing] PREPARANDO ATUALIZAÇÃO PARA O LEAD ID: ${leadData.id}`);
      if (hasStatusChange) {
        const novoStatusObj = statuses.find((s: any) => Number(s.id) === novoStatus);
        const nomeNovoStatus = novoStatusObj ? novoStatusObj.name : "Desconhecido";
        console.log(`[AI Routing] -> STATUS: Lead será movido do ID ${leadData.status_id} (${nomeEtapaAtual}) para ${novoStatus} (${nomeNovoStatus}) - Pipeline ID mapeado: ${leadData.pipeline_id}`);
      }
      if (hasFields) {
        console.log(`[AI Routing] -> CAMPOS: ${fieldsToUpdate.length} campo(s) será(ão) atualizado(s)`);
        console.log(`[AI Routing] -> DETALHE DOS CAMPOS: ${JSON.stringify(fieldsToUpdate)}`);
      }
      
      const patchData: any = { id: Number(leadData.id) };
      if (hasStatusChange) {
        patchData.status_id = Number(parsed.novoStatusId);
        patchData.pipeline_id = Number(leadData.pipeline_id);
      }
      if (hasFields) {
        patchData.custom_fields_values = fieldsToUpdate;
      }

      try {
        const patchRes = await axios.patch(
          `https://${connection.kommoSubdomain}.kommo.com/api/v4/leads`,
          [ patchData ],
          axiosConfig
        );
        console.log(`[AI Routing] SUCESSO: Atualização confirmada na Kommo (HTTP ${patchRes.status}).`);
      } catch (e: any) {
        const statusCode = e.response?.status;
        console.error(`[AI Routing] ERRO FATAL ao atualizar na Kommo (HTTP ${statusCode}).`);
        const isLeadNotFound = statusCode === 400 && 
          (JSON.stringify(e.response?.data).includes('Lead not found') || JSON.stringify(e.response?.data).includes('not_found'));

        if (isLeadNotFound) {
          console.warn(`[AI Routing] ALERTA: O Lead ID ${leadData.id} não existe mais na Kommo.`);
          try {
            await prisma.kommoLeadCache.deleteMany({
              where: { tenantId: connection.tenantId, leadId: Number(leadData.id) }
            });
          } catch (cacheErr: any) {
            console.error('[AI Routing] Erro ao tentar limpar o banco de dados de cache:', cacheErr.message);
          }
        }
      }

      if (hasStatusChange) {
        try {
          await prisma.kommoLeadCache.updateMany({
            where: { leadId: leadData.id, tenantId: connection.tenantId },
            data: { statusId: parsed.novoStatusId }
          });
        } catch (err: any) {
          console.warn('[Gemini Routing] Erro ao atualizar cache local:', err.message);
        }
      }
    }
    
    return parsed;
  } catch (err: any) {
    console.error("[Gemini Routing] Falha na avaliação:", err.message);
    return null;
  }
}

