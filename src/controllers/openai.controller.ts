import { Request, Response } from 'express';
import { createOpenAiProject, getOpenAiCosts, getOpenAiTokenUsage, getOpenAiProjectsFromDb } from '../lib/openai-manager';

export const createProject = async (req: Request, res: Response) => {
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
};

export const getProjects = async (req: Request, res: Response) => {
  try {
    const projects = await getOpenAiProjectsFromDb();
    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getCosts = async (req: Request, res: Response) => {
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
};

export const getUsage = async (req: Request, res: Response) => {
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
};

export const getSummary = async (req: Request, res: Response) => {
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
      
      const pCostsForProj = costsRes.data?.filter((c: any) => c.project_id === proj.projectId) || [];
      const pUsagesForProj = usageRes.data?.filter((u: any) => u.project_id === proj.projectId) || [];

      const totalCost = pCostsForProj.reduce((acc: number, curr: any) => acc + (curr.amount?.value || 0), 0);
      const currency = pCostsForProj[0]?.amount?.currency || 'USD';

      const tokensInput = pUsagesForProj.reduce((acc: number, curr: any) => acc + (curr.n_context_tokens_total || 0), 0);
      const tokensOutput = pUsagesForProj.reduce((acc: number, curr: any) => acc + (curr.n_generated_tokens_total || 0), 0);

      summaryByTenant[proj.tenantId] = {
        projectId: proj.projectId,
        projectName: proj.projectName,
        apiKey: proj.apiKey,
        cost: totalCost,
        currency: currency,
        tokensInput: tokensInput,
        tokensOutput: tokensOutput,
        tokensTotal: tokensInput + tokensOutput
      };
    }

    res.json(summaryByTenant);
  } catch (error: any) {
    console.error("[OpenAI] Falha ao gerar resumo:", error.message);
    res.status(500).json({ error: error.message });
  }
};
