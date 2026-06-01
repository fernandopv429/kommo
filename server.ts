import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { createServer as createViteServer } from 'vite';
import cron from 'node-cron';
import { refreshKommoToken, ensureValidKommoToken, registerKommoWebhook } from './src/lib/kommo-auth';
import OpenAI from "openai";
import { createOpenAiProject, getOpenAiCosts, getOpenAiTokenUsage, getOpenAiProjectsFromDb } from './src/lib/openai-manager';

const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";
const EVOLUTION_URL = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";

async function createEvolutionInstance(tenantId: string) {
  const EVOLUTION_URL_EXEC = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";
  const EVOLUTION_API_KEY_EXEC = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";

  let createdResponse = null;

  const setWebhook = async () => {
    console.log(`[Evolution] Configurando Webhook Centralizador para a instância: ${tenantId}`);
    try {
      const finalUrl = 'https://tarif.nexusdevhub.com';

      await axios.post(
        `${EVOLUTION_URL_EXEC}/webhook/set/${tenantId}`,
        {
          webhook: {
            enabled: true,
            url: `${finalUrl}/api/webhooks/evolution/${tenantId}`,
            webhookByEvents: true,
            webhookBase64: false,
            events: [
              "MESSAGES_UPSERT",
              "CONNECTION_UPDATE"
            ]
          }
        },
        {
          headers: {
            "apikey": EVOLUTION_API_KEY_EXEC,
            "Content-Type": "application/json"
          }
        }
      );
      console.log(`[Evolution] Webhook centralizador configurado com sucesso para a instância '${tenantId}'. URL: ${finalUrl}/api/webhooks/evolution/${tenantId}`);
    } catch (webhookError: any) {
      console.error(`[Evolution] Falha ao configurar webhook para '${tenantId}':`, webhookError.response?.data || webhookError.message);
    }
  };

  try {
    console.log(`[Evolution] Solicitando criação da instância: ${tenantId}`);
    const response = await axios.post(
      `${EVOLUTION_URL_EXEC}/instance/create`,
      {
        instanceName: tenantId,
        integration: "WHATSAPP-BAILEYS",
        alwaysOnline: true,
        readMessages: true,
        readStatus: false,
        rejectCall: false,
        groupsIgnore: true
      },
      {
        headers: {
          "apikey": EVOLUTION_API_KEY_EXEC,
          "Content-Type": "application/json"
        }
      }
    );
    console.log(`[Evolution] Instância '${tenantId}' criada com sucesso.`);
    createdResponse = response.data;
    await setWebhook(); // Configura após sucesso
  } catch (error: any) {
    const errorData = error.response?.data;
    if (error.response?.status === 400 || (typeof errorData?.message === 'string' && errorData.message.includes('A instância já existe') || JSON.stringify(errorData).includes('already exists'))) {
      console.log(`[Evolution] Instância ${tenantId} já mapeada no servidor.`);
      createdResponse = { status: "EXISTS" };
      await setWebhook(); // Configura se já existir para garantir o vínculo
    } else {
      console.error(`[Evolution] Erro na criação do container para '${tenantId}':`, errorData || error.message);
      throw error;
    }
  }

  return createdResponse;
}

const app = express();
const PORT = 3000;

// Initialize Prisma
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROTAS DE CONFIGURAÇÃO DO SISTEMA --- //

app.get('/api/settings/:key', async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const setting = await prisma.systemSetting.findUnique({ where: { key } });
    res.json({ value: setting?.value || '' });
  } catch (error: any) {
    console.error(`[Settings] Erro no banco de dados para a chave ${req.params.key}:`, error.message);
    res.status(200).json({ value: '' });
  }
});

app.post('/api/settings', async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      res.status(400).json({ error: 'Key is required' });
      return;
    }
    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
    res.json(setting);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- ROTAS DE PROJETOS OPENAI --- //

app.post('/api/openai/projects', async (req: Request, res: Response) => {
  try {
    const { tenantId, projectName } = req.body;
    if (!projectName) {
      res.status(400).json({ error: 'projectName is required' });
      return;
    }
    const newProject = await createOpenAiProject(tenantId || "default", projectName);
    res.json(newProject);
  } catch (error: any) {
    console.error("[OpenAI] Falha ao criar projeto:", error.response?.data || error.message);
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

app.get('/api/openai/projects', async (req: Request, res: Response) => {
  try {
    const projects = await getOpenAiProjectsFromDb();
    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/openai/costs', async (req: Request, res: Response) => {
  try {
    const { start_time, end_time, group_by_project } = req.query;
    if (!start_time) {
      res.status(400).json({ error: 'start_time is required' });
      return;
    }
    const costs = await getOpenAiCosts(
      String(start_time), 
      end_time ? String(end_time) : undefined, 
      group_by_project === 'true'
    );
    res.json(costs);
  } catch (error: any) {
    console.error("[OpenAI] Falha ao buscar custos:", error.response?.data || error.message);
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

app.get('/api/openai/usage', async (req: Request, res: Response) => {
  try {
    const { start_time, group_by_project } = req.query;
    if (!start_time) {
      res.status(400).json({ error: 'start_time is required' });
      return;
    }
    const usage = await getOpenAiTokenUsage(
      String(start_time), 
      group_by_project === 'true'
    );
    res.json(usage);
  } catch (error: any) {
    console.error("[OpenAI] Falha ao buscar uso (tokens):", error.response?.data || error.message);
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

app.get('/api/openai/summary', async (req: Request, res: Response) => {
  try {
    const projects = await getOpenAiProjectsFromDb();
    if (projects.length === 0) {
      return res.json({});
    }

    const d = new Date();
    d.setDate(1);
    d.setHours(0,0,0,0);
    const start_time = Math.floor(d.getTime() / 1000).toString();

    let costsRes = { data: [] };
    let usageRes = { data: [] };

    try {
      costsRes = await getOpenAiCosts(start_time, undefined, true);
    } catch(e) {
      console.warn("Could not fetch costs", e);
    }

    try {
      usageRes = await getOpenAiTokenUsage(start_time, true); 
    } catch(e) {
      console.warn("Could not fetch usage", e);
    }

    const summaryByTenant: Record<string, any> = {};

    for (const proj of projects) {
      if (!proj.tenantId) continue;
      
      const pCost = costsRes.data?.find((c: any) => c.project_id === proj.projectId);
      const pUsage = usageRes.data?.find((u: any) => u.project_id === proj.projectId);

      summaryByTenant[proj.tenantId] = {
        projectId: proj.projectId,
        projectName: proj.projectName,
        cost: pCost?.amount?.value || 0,
        currency: pCost?.amount?.currency || 'USD',
        tokensInput: pUsage?.n_context_tokens_total || 0,
        tokensOutput: pUsage?.n_generated_tokens_total || 0,
        tokensTotal: (pUsage?.n_context_tokens_total || 0) + (pUsage?.n_generated_tokens_total || 0)
      };
    }

    res.json(summaryByTenant);
  } catch (error: any) {
    console.error("[OpenAI] Falha ao gerar resumo:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- ROTAS DO FLUXO OAUTH KOMMO --- //

/**
 * Helper: Busca Lead na Base (Cache) ou na API da Kommo
 */
async function fetchLeadData(tenantId: string, telefone_limpo: string, connection: any) {
  let cachedLead = null;
  try {
    cachedLead = await prisma.kommoLeadCache.findUnique({
      where: { tenantId_phoneNumber: { tenantId, phoneNumber: telefone_limpo } }
    });
  } catch (err: any) {
    console.warn('[DB] Cache indisponível, buscando direto na API:', err.message);
  }

  if (cachedLead) {
    const rawCustomFields = cachedLead.customFields as any || {};
    const contato = rawCustomFields._contatoObj || null;
    const custom_fields = { ...rawCustomFields };
    delete custom_fields._contatoObj;

    return {
      exists: true,
      lead: {
        id: cachedLead.leadId,
        nome_card: cachedLead.name,
        name: cachedLead.name,
        price: cachedLead.price,
        status_id: cachedLead.statusId,
        pipeline_id: cachedLead.pipelineId,
        tags: cachedLead.tags,
        custom_fields,
        contato: contato
      }
    };
  }

  const axiosConfig = {
    headers: { 'Authorization': `Bearer ${connection.accessToken}` }
  };

  try {
    // 1. First, search for contacts matching the phone number
    let leadIdToFetch: number | null = null;
    let mainContact: any = null;

    try {
      const contactsRes = await axios.get(
        `https://${connection.kommoSubdomain}.kommo.com/api/v4/contacts?query=${encodeURIComponent(telefone_limpo)}&with=leads`,
        axiosConfig
      );
      const contactsRaw = contactsRes.data?._embedded?.contacts;
      if (Array.isArray(contactsRaw) && contactsRaw.length > 0) {
        // Find first contact with leads
        for (const contact of contactsRaw) {
          const linkedLeads = contact._embedded?.leads;
          if (Array.isArray(linkedLeads) && linkedLeads.length > 0) {
            mainContact = contact;
            leadIdToFetch = linkedLeads[0].id;
            break;
          }
        }
      }
    } catch (err: any) {
      if (err.response && err.response.status !== 204) {
        console.error('[Evolution] Erro ao buscar contatos na Kommo:', err.response?.data || err.message);
      }
    }

    let leadsRaw: any[] = [];
    
    // 2. Se achou um leadId pelo contato, busca o lead específico
    if (leadIdToFetch) {
      try {
        const leadRes = await axios.get(
          `https://${connection.kommoSubdomain}.kommo.com/api/v4/leads/${leadIdToFetch}?with=contacts`,
          axiosConfig
        );
        if (leadRes.data) {
          leadsRaw = [leadRes.data];
        }
      } catch (err: any) {
        // fallback
      }
    }

    // 3. Se não achou pelos contatos, busca direto em leads (fallback)
    if (leadsRaw.length === 0) {
      const leadsRes = await axios.get(
        `https://${connection.kommoSubdomain}.kommo.com/api/v4/leads?query=${encodeURIComponent(telefone_limpo)}&with=contacts`,
        axiosConfig
      );
      leadsRaw = leadsRes.data?._embedded?.leads || [];
    }

    if (Array.isArray(leadsRaw) && leadsRaw.length > 0) {
      const orderedLeads = leadsRaw.sort((a: any, b: any) => b.updated_at - a.updated_at);
      const latestLead = orderedLeads[0];

      const tagsRaw = latestLead._embedded?.tags || [];
      const tags: string[] = tagsRaw.map((t: any) => t.name);

      const cfRaw = latestLead.custom_fields_values || [];
      const custom_fields: Record<string, string> = {};
      cfRaw.forEach((cf: any) => {
        if (cf.field_name && cf.values && cf.values.length > 0) {
          custom_fields[cf.field_name] = cf.values[0].value;
        }
      });

      let contatoObj = null;
      
      // Use mainContact found matching the phone, else find first is_main
      const contactsRawFallback = latestLead._embedded?.contacts || [];
      const fallbackContact = contactsRawFallback.find((c: any) => c.is_main === true) || contactsRawFallback[0];
      const targetContact = mainContact || fallbackContact;

      if (targetContact) {
        try {
          // If we already have the contact populated from the first request, we can use it.
          // But to be safe and ensure all custom fields, fetch it by ID.
          const contactRes = await axios.get(
            `https://${connection.kommoSubdomain}.kommo.com/api/v4/contacts/${targetContact.id}`,
            axiosConfig
          );
          const rawContact = contactRes.data;

          let phoneVal = '';
          let emailVal = '';

          const contactCFRaw = rawContact.custom_fields_values || [];
          contactCFRaw.forEach((cf: any) => {
            if (cf.field_code === 'PHONE' && cf.values && cf.values.length > 0) {
              phoneVal = cf.values[0].value;
            }
            if (cf.field_code === 'EMAIL' && cf.values && cf.values.length > 0) {
              emailVal = cf.values[0].value;
            }
          });

          contatoObj = {
            id: rawContact.id,
            nome_real: rawContact.name,
            telefone: phoneVal,
            email: emailVal
          };
        } catch (contactErr: any) {
          console.error('[Evolution] Erro ao buscar dados do contato:', contactErr.message);
        }
      }

      // Removendo o .create sincrono daqui para não travar a automação caso o cache falhe
      // Faremos o upsert no final do fluxo, conforme pedido.

      return {
        exists: true,
        source: 'api', // Flag para indicar que veio da API e precisa ser persistido
        lead: {
          id: latestLead.id,
          nome_card: latestLead.name,
          name: latestLead.name,
          price: latestLead.price,
          status_id: latestLead.status_id,
          pipeline_id: latestLead.pipeline_id,
          tags,
          custom_fields,
          contato: contatoObj
        }
      };
    } else {
      return { exists: false, lead: null };
    }
  } catch (kommoErr: any) {
    if (kommoErr.response && kommoErr.response.status === 204) {
      return { exists: false, lead: null };
    }
    console.error('[Evolution] Erro ao buscar lead na Kommo:', kommoErr.response?.data || kommoErr.message);
    return { exists: false, lead: null };
  }
}

async function handleGeminiRouting(connection: any, mensagem_whatsapp: string, leadData: any) {
  try {
    if (!leadData || !leadData.pipeline_id || !leadData.status_id) return null;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('[AI Routing] OPENAI_API_KEY não configurada. Pulando análise IA. (Você precisa configurar a chave no painel de configurações do app)');
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
      .filter((s: any) => s.id !== 142 && s.id !== 143) // Ignore Won and Lost by default, unless they specifically ask, but usually we just keep all active pipeline statuses. Actually let's keep them all just in case.
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
      
      // Atribuir o ID principal do lead
      const patchData: any = { 
        id: Number(leadData.id)
      };
      
      // Se houver alteração de etapa, enviamos o status_id (e o pipeline_id para evitar erro de pipeline mismatch)
      if (hasStatusChange) {
        patchData.status_id = Number(parsed.novoStatusId);
        patchData.pipeline_id = Number(leadData.pipeline_id);
      }
      
      if (hasFields) {
        patchData.custom_fields_values = fieldsToUpdate;
      }

      try {
        console.log(`[AI Routing] Enviando PATCH para a API da Kommo (URL:  https://${connection.kommoSubdomain}.kommo.com/api/v4/leads)`);
        console.log(`[AI Routing] Payload da requisição: ${JSON.stringify([patchData], null, 2)}`);

        const patchRes = await axios.patch(
          `https://${connection.kommoSubdomain}.kommo.com/api/v4/leads`,
          [ patchData ],
          axiosConfig
        );
        console.log(`[AI Routing] SUCESSO: Atualização confirmada na Kommo (HTTP ${patchRes.status}).`);
        console.log(`[AI Routing] Resposta da API da Kommo: `, JSON.stringify(patchRes.data, null, 2));
      } catch (e: any) {
        const errorData = e.response?.data;
        const statusCode = e.response?.status;
        
        console.error(`[AI Routing] ERRO FATAL ao atualizar na Kommo (HTTP ${statusCode}).`);
        console.error(`[AI Routing] Detalhes do erro da API da Kommo: `, JSON.stringify(errorData || e.message, null, 2));

        const isLeadNotFound = statusCode === 400 && 
          (JSON.stringify(errorData).includes('Lead not found') || JSON.stringify(errorData).includes('not_found'));

        if (isLeadNotFound) {
          console.warn(`[AI Routing] ALERTA: O Lead ID ${leadData.id} não existe mais na Kommo (foi excluído no CRM).`);
          console.warn(`[AI Routing] Iniciando limpeza de cache...`);
          
          try {
            await prisma.kommoLeadCache.deleteMany({
              where: { 
                tenantId: connection.tenantId,
                leadId: Number(leadData.id)
              }
            });
            console.log(`[AI Routing] Cache obsoleto limpo. O próximo contato recriará o lead.`);
          } catch (cacheErr: any) {
            console.error('[AI Routing] Erro ao tentar limpar o banco de dados de cache:', cacheErr.message);
          }
        }
      }

      if (hasStatusChange) {
        // Atualiza o cache local para que as próximas mensagens reconheçam a nova etapa
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
  } catch (error: any) {
    console.error('[Gemini Routing] Erro ao processar:', error.response?.data || error.message);
  }
  return null;
}

/**
 * Rota 1: Iniciar Conexão OAuth
 * GET /auth/kommo/connect?empresa_id=...
 */
app.get('/auth/kommo/connect', (req: Request, res: Response) => {
  try {
    const client_id = process.env.KOMMO_CLIENT_ID;
    const redirect_uri = process.env.KOMMO_REDIRECT_URI || (process.env.APP_URL ? `${process.env.APP_URL}/auth/kommo/callback` : 'https://tarif.nexusdevhub.com/auth/kommo/callback');

    const empresa_id = req.query.empresa_id || req.query.tenantId;

    if (!empresa_id || typeof empresa_id !== 'string') {
      res.status(400).json({ error: 'O parâmetro empresa_id (ou tenantId) é obrigatório e deve ser uma string.' });
      return;
    }

    if (!client_id || !redirect_uri) {
      res.status(500).json({ 
        error: 'Faltam credenciais do Kommo Hub no servidor (.env ou painel do Coolify).',
        details: { hasClientId: !!client_id, hasRedirectUri: !!redirect_uri }
      });
      return;
    }

    const kommoAuthUrl = new URL('https://www.kommo.com/oauth');
    kommoAuthUrl.searchParams.append('client_id', client_id);
    kommoAuthUrl.searchParams.append('state', empresa_id);
    kommoAuthUrl.searchParams.append('mode', 'popup'); 

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

    const client_id = process.env.KOMMO_CLIENT_ID;
    const client_secret = process.env.KOMMO_CLIENT_SECRET;
    const redirect_uri = process.env.KOMMO_REDIRECT_URI || (process.env.APP_URL ? `${process.env.APP_URL}/auth/kommo/callback` : 'https://tarif.nexusdevhub.com/auth/kommo/callback');

    const tenantId = state;

    if (!client_id || !client_secret || !redirect_uri) {
      res.status(500).send('Faltam credenciais do Kommo Hub no servidor (.env ou painel do Coolify).');
      return;
    }

    if (!code || !tenantId) {
       res.status(400).send('Parâmetros "code" e "state (tenantId)" são obrigatórios.');
       return;
    }

    if (!subdomain && referer) {
      subdomain = referer.split('.')[0];
    } else if (!subdomain) {
      res.status(400).send('Subdomínio não identificado no callback da Kommo (referer ou subdomain faltante).');
      return;
    }

    console.log(`[Kommo OAuth] Callback recebido do tenant ${tenantId} no subdomínio ${subdomain}.`);

    const payload = {
      client_id,
      client_secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri,
    };

    const tokenUrl = `https://${subdomain}.kommo.com/oauth2/access_token`;

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

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Salvar ou atualizar no Banco de Dados PostgreSQL via Prisma
    await prisma.kommoConnection.upsert({
      where: { kommoAccountId: kommoAccountId },
      update: {
        tenantId: tenantId,
        kommoSubdomain: subdomain,
        accountName: accountName,
        isActive: true, // Garante que volta pra true se reconectar
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expiresAt,
      },
      create: {
        tenantId: tenantId,
        kommoAccountId: kommoAccountId,
        kommoSubdomain: subdomain,
        accountName: accountName,
        isActive: true, // Garante que o registro começa como true
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expiresAt,
      }
    });

    console.log(`[Kommo OAuth] Tokens da conta ${kommoAccountId} (tenant ${tenantId}) salvos com sucesso.`);

    // 2. CHAMADA AUTOMÁTICA NO CALLBACK (Registrar Webhook)
    await registerKommoWebhook(kommoAccountId);

    // 3. CHAMADA AUTOMÁTICA O CALLBACK (Criar Instancia Evolution)
    await createEvolutionInstance(tenantId);

    res.send(`
      <html>
        <head><title>Integração Concluída</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2>Integração com Kommo Finalizada com Sucesso! 🚀</h2>
          <p>Os tokens foram salvos para a empresa <strong>${tenantId}</strong> no subdomínio ${subdomain}.kommo.com.</p>
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
          <p style="font-size: 12px; color: #555;">Dados extras: ${JSON.stringify(err?.response?.data || {})}</p>
        </body>
      </html>
    `);
  }
});

// 3. ROTA DE LISTAGEM DE CONTAS (Todas)
app.get('/api/connections', async (req: Request, res: Response) => {
  try {
    const connections = await prisma.kommoConnection.findMany({
      select: {
          id: true,
          tenantId: true,
          accountName: true,
          kommoSubdomain: true,
          kommoAccountId: true,
          isActive: true,
          expiresAt: true,
          updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Fetch instances from Evolution to enrich the data with connection status
    let evolutionInstances: any[] = [];
    try {
      const EVOLUTION_URL_EXEC = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";
      const EVOLUTION_API_KEY_EXEC = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";
      
      const response = await axios.get(`${EVOLUTION_URL_EXEC}/instance/fetchInstances`, {
        headers: { "apikey": EVOLUTION_API_KEY_EXEC }
      });
      if (response.data && Array.isArray(response.data)) {
        evolutionInstances = response.data;
      }
    } catch (evoErr: any) {
      console.warn('[API] Falha ao buscar instâncias da Evolution API:', evoErr.message);
    }

    const enrichedConnections = connections.map(conn => {
      const evoInstance = evolutionInstances.find(env => env.instance?.instanceName === conn.tenantId || env.name === conn.tenantId || env.instanceName === conn.tenantId);
      
      // Dependendo da versão da Evolution API, o estado pode estar em diferentes campos
      let evoState = 'unknown';
      if (evoInstance) {
         evoState = evoInstance.state || evoInstance.instance?.state || evoInstance.status || evoInstance.connectionStatus || 'disconnected';
      }

      return {
        ...conn,
        evolutionState: evoState
      };
    });

    res.json(enrichedConnections);
  } catch (e: unknown) {
    const err = e as Error;
    console.error('[API] Erro ao buscar conexões:', err.message);
    res.status(200).json([]);
  }
});

// Adição manual de credenciais
app.post('/api/connections/manual', async (req: Request, res: Response) => {
  try {
    const { tenantId, accountName, kommoAccountId, kommoSubdomain, accessToken, refreshToken } = req.body;

    if (!tenantId || !kommoAccountId || !kommoSubdomain || !accessToken || !refreshToken) {
      res.status(400).json({ error: 'Existem campos obrigatórios faltando (tenantId, kommoAccountId, kommoSubdomain, accessToken, refreshToken).' });
      return;
    }

    // Default expirations for manual token inputs is usually ~24h for Kommo, if they expire sooner the refresh cron will fix it
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const cleanSubdomain = kommoSubdomain.replace('.kommo.com', '').replace('https://', '').replace('/', '');

    const newConnection = await prisma.kommoConnection.upsert({
      where: { kommoAccountId },
      update: {
        tenantId,
        accountName: accountName || 'Conta Adicionada Manualmente',
        kommoSubdomain: cleanSubdomain,
        accessToken,
        refreshToken,
        expiresAt,
        isActive: true
      },
      create: {
        tenantId,
        accountName: accountName || 'Conta Adicionada Manualmente',
        kommoAccountId,
        kommoSubdomain: cleanSubdomain,
        accessToken,
        refreshToken,
        expiresAt,
        isActive: true
      }
    });

    // CHAMADA AUTOMÁTICA O CALLBACK (Criar Instancia Evolution e Webhook)
    try {
      await createEvolutionInstance(tenantId);
    } catch (evoError: any) {
      console.error(`[Manual Connection] Falha ao criar instancia Evolution para tenant ${tenantId}. Ocorreu no processo paralelo.`, evoError.message);
    }

    res.json(newConnection);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3.1 ROTA DE LISTAGEM DE CONTAS DO TENANT
app.get('/api/tenants/:tenant_id/accounts', async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;
    const connections = await prisma.kommoConnection.findMany({
      where: { tenantId: tenant_id },
      select: {
          id: true,
          tenantId: true,
          accountName: true,
          kommoSubdomain: true,
          kommoAccountId: true,
          isActive: true,
          expiresAt: true,
          updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(connections);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(500).json({ error: err.message });
  }
});

// 3.2 ROTA PARA CONSULTAR INFORMAÇÕES DA CONEXÃO PELA INSTÂNCIA (TENANT)
app.get('/api/connections/info/:tenantId', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    
    const connection = await prisma.kommoConnection.findFirst({
      where: { tenantId: tenantId },
      select: {
        id: true,
        tenantId: true,
        accountName: true,
        kommoSubdomain: true,
        kommoAccountId: true,
        isActive: true,
        expiresAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!connection) {
      res.status(404).json({ exists: false, message: 'Nenhuma conexão ativa encontrada para este identificador (telefone).' });
      return;
    }

    res.json({
      exists: true,
      data: connection
    });

  } catch (error: any) {
    console.error('[API Connection Info] Erro:', error.message);
    res.status(500).json({ error: 'Erro interno ao consultar informações da conexão.' });
  }
});

// 3.3 CONSULTA DE LEAD NA KOMMO POR TELEFONE
app.get('/api/leads/:tenantId/:phoneNumber', async (req: Request, res: Response) => {
  try {
    const { tenantId, phoneNumber } = req.params;
    
    const telefone_limpo = phoneNumber.replace(/\D/g, '');

    const connection = await prisma.kommoConnection.findFirst({
      where: { tenantId: tenantId, isActive: true }
    });

    if (!connection) {
      res.status(404).json({ error: 'Conexão Kommo não encontrada ou inativa para este tenant.' });
      return;
    }

    // Renova o token se necessário
    const now = new Date();
    const timeRemainingMs = connection.expiresAt.getTime() - now.getTime();
    if (timeRemainingMs < 900000) {
      await refreshKommoToken(connection.kommoAccountId);
      const updatedConn = await prisma.kommoConnection.findUnique({ where: { kommoAccountId: connection.kommoAccountId } });
      if (updatedConn) connection.accessToken = updatedConn.accessToken;
    }

    const { exists, lead } = await fetchLeadData(tenantId, telefone_limpo, connection);

    res.json({ exists, lead });

  } catch (error: any) {
    console.error('[API Lead Query] Erro:', error.message);
    res.status(500).json({ error: 'Erro interno ao consultar o Lead.' });
  }
});

// Alternar status
app.patch('/api/connections/:id/toggle', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const connection = await prisma.kommoConnection.findUnique({ where: { id } });
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada' });
      return;
    }
    
    // inverte o valor isActive
    const updated = await prisma.kommoConnection.update({
      where: { id },
      data: { isActive: !connection.isActive }
    });
    
    res.status(200).json({ success: true, isActive: updated.isActive });
  } catch (e: unknown) {
    const err = e as Error;
    res.status(500).json({ error: err.message });
  }
});


/**
 * 4. AJUSTE DE SEGURANÇA NO WEBHOOK CENTRAL
 * POST /api/webhooks/kommo
 */
app.post('/api/webhooks/kommo', async (req: Request, res: Response) => {
  try {
    const kommoAccountIdStr = req.body?.account?.id || req.body?.account_id || req.query.account_id;
    
    if (!kommoAccountIdStr) {
      console.warn('[Webhook Kommo] Evento recebido sem ID de conta (account.id).');
      res.status(400).send('ID da conta não identificado no webhook.');
      return;
    }

    const kommoAccountId = String(kommoAccountIdStr);
    
    // Busca banco
    const connection = await prisma.kommoConnection.findUnique({
      where: { kommoAccountId: kommoAccountId }
    });

    if (!connection) {
      console.warn(`[Webhook Kommo] Recebido evento para conta ${kommoAccountId} não encontrada no banco de dados.`);
      res.status(404).send('Conexão não encontrada.');
      return;
    }

    // REGRA DE SEGURANÇA: Se estiver inativa, pausa silenciosamente sem passar pro webhook n8n
    if (!connection.isActive) {
      console.log(`[Webhook Kommo] Evento recebido (conta ${kommoAccountId}) mas a conexão está PAUSADA (isActive=false).`);
      res.status(200).send('Pausado');
      return;
    }

    // Verifica token expiração e renova pre-emptivamente se necessário (<15 min)
    const now = new Date();
    const timeRemainingMs = connection.expiresAt.getTime() - now.getTime();
    if (timeRemainingMs < 900000) {
      console.log(`[Webhook Kommo] Renovando token preventivamente no webhook para conta ${kommoAccountId}`);
      await refreshKommoToken(kommoAccountId);
      
      const updatedConn = await prisma.kommoConnection.findUnique({ where: { kommoAccountId: kommoAccountId }});
      if(updatedConn) connection.accessToken = updatedConn.accessToken;
    }

    // Buscar a URL do webhook global no banco de dados, ou fallback para ENV
    const webhookSetting = await prisma.systemSetting.findUnique({ where: { key: 'N8N_WEBHOOK_URL' } });
    const n8nUrl = webhookSetting?.value || process.env.N8N_WEBHOOK_URL;
    
    if (!n8nUrl) {
      console.error('[Webhook Kommo] Webhook centralizador N8N não configurado.');
      res.status(200).send('N8N webhook was missing.');
      return;
    }

    // Disparo pro N8N
    const leadId = req.body['leads[status][0][id]'] || req.body['leads[add][0][id]'];
    const statusId = req.body['leads[status][0][status_id]'] || req.body['leads[add][0][status_id]'];

    const payloadToN8n = {
      lead_id: leadId,
      status_id: statusId,
      subdomain: connection.kommoSubdomain,
      access_token: connection.accessToken
    };

    axios.post(n8nUrl, payloadToN8n).catch(err => {
      console.error('[Webhook Kommo] Falha ao enviar para o N8N:', err.message);
    });

    res.status(200).send('OK');
  } catch (error: any) {
    console.error('[Webhook Kommo] Erro crítico no webhook:', error.message);
    res.status(500).send('Internal Error');
  }
});

/**
 * 5. WEBHOOK EVOLUTION API
 * POST /api/webhooks/evolution/:tenantId
 */
app.post('/api/webhooks/evolution/:tenantId', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const body = req.body;

    // Verificar se é evento de conexão (CONNECTION_UPDATE)
    if (body?.event === 'connection.update') {
      const state = body?.data?.state || body?.state || body?.data?.status || 'unknown';
      console.log(`[Evolution Webhook] Status da conexão alterado para o tenant ${tenantId}. Status: ${state}`);
      
      const webhookSetting = await prisma.systemSetting.findUnique({ where: { key: 'N8N_WEBHOOK_URL' } });
      const n8nUrl = webhookSetting?.value || process.env.N8N_WEBHOOK_URL;
      
      if (n8nUrl) {
         try {
           await axios.post(n8nUrl, {
             event_type: 'evolution_connection_update',
             tenantId: tenantId,
             state: state,
             raw_data: body
           });
           console.log(`[Evolution Webhook] Evento de desconexão/conexão enviado para o n8n.`);
         } catch(e: any) {
           console.warn(`[Evolution Webhook] Falha ao enviar evento de conexão para n8n: ${e.message}`);
         }
      }
      
      res.status(200).send('Connection update logged');
      return;
    }

    // Verificar se a mensagem foi enviada por nós mesmos (fromMe)
    if (body?.data?.key?.fromMe === true || body?.data?.fromMe === true) {
      res.status(200).send('Ignored self message');
      return;
    }

    // Extrair o JID remoto e limpar
    const remoteJid = body.data?.key?.remoteJid || '';
    const telefone_whatsapp = remoteJid.replace(/@s\.whatsapp\.net/g, '').replace(/\D/g, '');

    // Extrair a mensagem dependendo do tipo (texto simples ou estendido/midia)
    const mensagem_whatsapp = body.data?.message?.conversation || body.data?.message?.extendedTextMessage?.text || '';

    if (!telefone_whatsapp || !mensagem_whatsapp) {
      res.status(400).send('Dados de telefone ou mensagem ausentes ou inválidos.');
      return;
    }

    const connection = await prisma.kommoConnection.findFirst({
      where: { tenantId: tenantId, isActive: true }
    });

    if (!connection) {
      res.status(404).send('Conexão Kommo não encontrada para este tenant.');
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

    // 4. Analisa a mensagem com Gemini para mover de etapa (opcional/baseado na intenção)
    let ai_parsed: any = {};
    let ai_text_response: string | null = null;
    let action_taken: string | null = null;

    if (lead_existe && finalLeadData) {
      const oldStatusId = finalLeadData.status_id;
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
      console.warn('[Evolution Webhook] Falha ao salvar InteractionLog:', e.message);
    }

    // 5. Repasse completo para o n8n
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

        // Variáveis mapeadas diretamente para facilitar o uso no n8n ($json.Lead_id, etc)
        Lead_id: finalLeadData ? finalLeadData.id : null,
        Nome: finalLeadData ? finalLeadData.name : "",
        Status_id: (ai_parsed.novoStatusId && Number(ai_parsed.novoStatusId) > 0) ? Number(ai_parsed.novoStatusId) : (finalLeadData ? finalLeadData.status_id : null),
        campos_personalizados_lead: finalLeadData ? finalLeadData.custom_fields : {},
        has_update: ((ai_parsed.novoStatusId && Number(ai_parsed.novoStatusId) > 0 && Number(ai_parsed.novoStatusId) !== Number(finalLeadData ? finalLeadData.status_id : null))) || (ai_parsed.custom_fields && ai_parsed.custom_fields.length > 0),
        campos_personalizados_atualizados_ia: ai_parsed.custom_fields || []
      };

      // 1. Injetar todos os custom fields atuais do Lead no payload dinamicamente
      if (finalLeadData && finalLeadData.custom_fields) {
        Object.entries(finalLeadData.custom_fields).forEach(([key, value]) => {
          if (key && value) {
            payloadToN8n[key] = value;
          }
        });
      }

      // 2. Sobrescrever com os campos identificados pela IA (se houver atualização nessa interação)
      if (ai_parsed.custom_fields && Array.isArray(ai_parsed.custom_fields)) {
        ai_parsed.custom_fields.forEach((cf: any) => {
          if (cf.field_name && cf.value) {
            payloadToN8n[cf.field_name] = cf.value;
          }
        });
      }

      await axios.post(n8nUrl, payloadToN8n);
      console.log(`[Evolution Webhook] Encaminhado com sucesso para o n8n do tenant ${tenantId}`);
    } else {
      console.warn('[Evolution] Webhook centralizador N8N não configurado no servidor (banco de dados ou .env).');
    }

    // 6. Atualiza o cache persistente APÓS enviar para o webhook (conforme requisito)
    if (lead_existe && finalLeadData && lead_source === 'api') {
      try {
        await prisma.kommoLeadCache.upsert({
          where: { tenantId_phoneNumber: { tenantId, phoneNumber: telefone_whatsapp } },
          create: {
            tenantId,
            phoneNumber: telefone_whatsapp,
            leadId: finalLeadData.id,
            name: finalLeadData.name,
            price: finalLeadData.price || 0,
            statusId: finalLeadData.status_id,
            pipelineId: finalLeadData.pipeline_id,
            tags: finalLeadData.tags || [],
            customFields: { ...(finalLeadData.custom_fields || {}), _contatoObj: finalLeadData.contato }
          },
          update: {
            leadId: finalLeadData.id,
            name: finalLeadData.name,
            price: finalLeadData.price || 0,
            statusId: finalLeadData.status_id,
            pipelineId: finalLeadData.pipeline_id,
            tags: finalLeadData.tags || [],
            customFields: { ...(finalLeadData.custom_fields || {}), _contatoObj: finalLeadData.contato }
          }
        });
        console.log(`[Evolution Webhook] Cache persistente atualizado com sucesso após envio N8N (Lead ID: ${finalLeadData.id})`);
      } catch (cacheErr: any) {
        console.warn('[Evolution Webhook] Falha ao preencher cache persistente (ignorando para não travar automação):', cacheErr.message);
      }
    }

    res.status(200).send('OK');

  } catch (error: any) {
    console.error('[Evolution Webhook] Erro crítico:', error.message);
    res.status(500).send('Internal Error');
  }
});

/**
 * 6. ROTA DE ENTRADA DE LOGS (n8n -> Servidor)
 */
app.post('/api/logs', async (req: Request, res: Response) => {
  try {
    const { 
      tenantId, 
      leadId, 
      whatsappNumber, 
      incomingMessage, 
      aiResponse, 
      actionTaken, 
      status, 
      errorMessage 
    } = req.body;

    if (!tenantId || !whatsappNumber || !incomingMessage || !status) {
      res.status(400).json({ error: 'Campos tenantId, whatsappNumber, incomingMessage e status são obrigatórios.' });
      return;
    }

    const log = await prisma.interactionLog.create({
      data: {
        tenantId,
        leadId,
        whatsappNumber,
        incomingMessage,
        aiResponse,
        actionTaken,
        status,
        errorMessage
      }
    });

    res.status(201).json(log);
  } catch (error: any) {
    console.error('[Logs] Erro ao salvar log:', error.message);
    res.status(500).json({ error: 'Erro interno ao salvar o log.' });
  }
});

/**
 * 7. ROTA DE LISTAGEM DE LOGS (Painel -> Servidor)
 */
app.get('/api/tenants/:tenant_id/logs', async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;

    const logs = await prisma.interactionLog.findMany({
      where: { tenantId: tenant_id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json(logs);
  } catch (error: any) {
    console.error('[Logs] Erro ao buscar logs:', error.message);
    res.status(500).json({ error: 'Erro interno ao buscar os logs.' });
  }
});

/**
 * 8. ROTA OBTER QR CODE (Evolution API)
 */
app.get('/api/tenants/:tenant_id/qrcode', async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;

    const response = await axios.get(`${EVOLUTION_URL}/instance/connect/${tenant_id}`, {
      headers: {
        "apikey": EVOLUTION_API_KEY
      }
    });

    const data = response.data;

    // Se a instância já estiver conectada, a Evolution costuma retornar algo como state "open" ou conected
    if (data?.instance?.state === 'open' || data?.instance?.status === 'connected' || data?.state === 'open' || data?.status === 'connected') {
      res.json({ status: "CONNECTED" });
      return;
    }

    const qrCodeBase64 = data.base64 || data.code || data.qrcode || data.instance?.qr;

    if (qrCodeBase64) {
      res.json({ status: "SCAN_QR", qrcode: qrCodeBase64 });
    } else {
      res.json({ status: "CREATING", details: data }); // Modificado para CREATING para que o front polling entenda
    }
  } catch (error: any) {
    const errorData = error.response?.data;
    const msg = typeof errorData?.message === 'string' ? errorData.message.toLowerCase() : '';

    // Se no connect retornar 404, significa que a instância ainda não terminou de subir ou não existe
    if (error.response?.status === 404 || msg.includes('does not exist')) {
      console.log(`[Evolution] Instância '${req.params.tenant_id}' não encontrada. Iniciando criação...`);
      try {
        await createEvolutionInstance(req.params.tenant_id);
      } catch (createError) {
        console.error(`[Evolution] Falha ao tentar criar a instância automaticamente:`, createError);
      }
      res.json({ status: "CREATING" });
      return;
    }

    // Tratar se a API der erro indicando que já está conectada/aberta
    if (msg.includes('open') || msg.includes('connected') || msg.includes('already connected')) {
      res.json({ status: "CONNECTED" });
      return;
    }

    console.error(`[Evolution] Erro ao buscar QR Code do tenant ${req.params.tenant_id}:`, errorData || error.message);
    res.status(500).json({ error: 'Erro interno ao buscar o QR Code.' });
  }
});

// Exemplo de rota protegida que usa o Middleware
app.get('/api/kommo/status', ensureValidKommoToken, (req: Request, res: Response) => {
  const token = (req as any).kommoToken;
  const subdomain = (req as any).kommoSubdomain;
  res.json({ message: 'Token válido!', subdomain, token_preview: token.substring(0, 10) + '...' });
});

/**
 * Rota para forçar sincronização do webhook na Evolution manualmente
 */
app.post('/api/tenants/:tenant_id/sync-webhook', async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;
    const EVOLUTION_URL_EXEC = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";
    const EVOLUTION_API_KEY_EXEC = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";

    const finalUrl = 'https://tarif.nexusdevhub.com';

    await axios.post(
      `${EVOLUTION_URL_EXEC}/webhook/set/${tenant_id}`,
      {
        webhook: {
          enabled: true,
          url: `${finalUrl}/api/webhooks/evolution/${tenant_id}`,
          webhookByEvents: true,
          webhookBase64: false,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
        }
      },
      {
        headers: {
          "apikey": EVOLUTION_API_KEY_EXEC,
          "Content-Type": "application/json"
        }
      }
    );
    res.json({ success: true, message: "Webhook sincronizado com a Evolution", url: `${finalUrl}/api/webhooks/evolution/${tenant_id}` });
  } catch (error: any) {
    console.error(`[Evolution] Falha ao sintonizar webhook manual para '${req.params.tenant_id}':`, error.response?.data || error.message);
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

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
