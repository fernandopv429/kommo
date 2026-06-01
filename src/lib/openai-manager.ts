import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getAdminKey() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'OPENAI_ADMIN_KEY' } });
  return setting?.value || process.env.OPENAI_ADMIN_KEY;
}

export async function createOpenAiProject(tenantId: string, projectName: string) {
  const adminKey = await getAdminKey();
  if (!adminKey) throw new Error("OPENAI_ADMIN_KEY não configurada.");

  // 1. Criar Projeto
  const projectRes = await axios.post('https://api.openai.com/v1/organization/projects', {
    name: projectName
  }, {
    headers: {
      "Authorization": `Bearer ${adminKey}`,
      "Content-Type": "application/json"
    }
  });
  
  const projectId = projectRes.data.id;

  // 2. Criar Service Account
  const serviceAccountRes = await axios.post(`https://api.openai.com/v1/organization/projects/${projectId}/service_accounts`, {
    name: "api-service"
  }, {
    headers: {
      "Authorization": `Bearer ${adminKey}`,
      "Content-Type": "application/json"
    }
  });

  let apiKey = "";
  // Tentar encontrar a API Key na resposta
  if (serviceAccountRes.data.api_key && typeof serviceAccountRes.data.api_key === 'string') {
    apiKey = serviceAccountRes.data.api_key;
  } else if (serviceAccountRes.data.api_key && serviceAccountRes.data.api_key.key) {
    apiKey = serviceAccountRes.data.api_key.key;
  } else if (serviceAccountRes.data.key) {
    apiKey = serviceAccountRes.data.key;
  } else {
    // OpenAI Service Account response format includes api_key.key or similar. 
    // Just stringify if we can't find it to avoid losing data
    apiKey = JSON.stringify(serviceAccountRes.data);
  }

  // 3. Salvar no banco
  const newProject = await prisma.openAiProject.create({
    data: {
      tenantId: tenantId,
      projectId: projectId,
      projectName: projectName,
      apiKey: apiKey
    }
  });

  return newProject;
}

export async function getOpenAiCosts(startTime: string, endTime?: string, groupByProject: boolean = false) {
  const adminKey = await getAdminKey();
  if (!adminKey) throw new Error("OPENAI_ADMIN_KEY não configurada.");

  let url = `https://api.openai.com/v1/organization/costs?start_time=${startTime}`;
  if (endTime) {
    url += `&end_time=${endTime}`;
  }

  // The OpenAI documentation states: `group_by[]=project_id`
  if (groupByProject) {
    url += `&group_by[]=project_id`;
  }

  const res = await axios.get(url, {
    headers: {
      "Authorization": `Bearer ${adminKey}`
    }
  });

  return res.data;
}

export async function getOpenAiTokenUsage(startTime: string, groupByProject: boolean = false) {
  const adminKey = await getAdminKey();
  if (!adminKey) throw new Error("OPENAI_ADMIN_KEY não configurada.");

  let url = `https://api.openai.com/v1/organization/usage/completions?start_time=${startTime}`;
  
  if (groupByProject) {
    url += `&group_by[]=project_id`;
  }

  const res = await axios.get(url, {
    headers: {
      "Authorization": `Bearer ${adminKey}`
    }
  });

  return res.data;
}

export async function getOpenAiProjectsFromDb() {
  return await prisma.openAiProject.findMany({
    orderBy: { createdAt: 'desc' }
  });
}
