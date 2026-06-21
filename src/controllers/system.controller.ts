import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getSetting = async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const setting = await prisma.systemSetting.findUnique({ where: { key } });
    res.json({ value: setting?.value || '' });
  } catch (error: any) {
    console.error(`[Settings] Erro no banco de dados para a chave ${req.params.key}:`, error.message);
    res.status(200).json({ value: '' });
  }
};

export const updateSetting = async (req: Request, res: Response) => {
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
};

export const createLog = async (req: Request, res: Response) => {
  try {
    const { tenantId, leadId, whatsappNumber, incomingMessage, aiResponse, actionTaken, status, errorMessage } = req.body;
    if (!tenantId || !whatsappNumber || !incomingMessage || !status) {
      res.status(400).json({ error: 'Campos tenantId, whatsappNumber, incomingMessage e status são obrigatórios.' });
      return;
    }
    const log = await prisma.interactionLog.create({
      data: { tenantId, leadId, whatsappNumber, incomingMessage, aiResponse, actionTaken, status, errorMessage }
    });
    res.status(201).json(log);
  } catch (error: any) {
    console.error('[Logs] Erro ao salvar log:', error.message);
    res.status(500).json({ error: 'Erro interno ao salvar o log.' });
  }
};

export const getLogs = async (req: Request, res: Response) => {
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
};
