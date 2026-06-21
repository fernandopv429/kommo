import { Request, Response } from 'express';
import axios from 'axios';
import { createEvolutionInstance } from '../services/evolution.service';

export const getEvolutionQrCode = async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;
    const EVOLUTION_URL = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";
    const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";

    const response = await axios.get(`${EVOLUTION_URL}/instance/connect/${tenant_id}`, {
      headers: {
        "apikey": EVOLUTION_API_KEY
      }
    });

    const data = response.data;

    if (data?.instance?.state === 'open' || data?.instance?.status === 'connected' || data?.state === 'open' || data?.status === 'connected') {
      res.json({ status: "CONNECTED" });
      return;
    }

    const qrCodeBase64 = data.base64 || data.code || data.qrcode || data.instance?.qr;

    if (qrCodeBase64) {
      res.json({ status: "SCAN_QR", qrcode: qrCodeBase64 });
    } else {
      res.json({ status: "CREATING", details: data }); 
    }
  } catch (error: any) {
    const errorData = error.response?.data;
    const msg = typeof errorData?.message === 'string' ? errorData.message.toLowerCase() : '';

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

    if (msg.includes('open') || msg.includes('connected') || msg.includes('already connected')) {
      res.json({ status: "CONNECTED" });
      return;
    }

    console.error(`[Evolution] Erro ao buscar QR Code do tenant ${req.params.tenant_id}:`, errorData || error.message);
    res.status(500).json({ error: 'Erro interno ao buscar o QR Code.' });
  }
};

export const syncEvolutionWebhook = async (req: Request, res: Response) => {
  try {
    const { tenant_id } = req.params;
    const EVOLUTION_URL_EXEC = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";
    const EVOLUTION_API_KEY_EXEC = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";

    const finalUrlStr = process.env.APP_URL?.trim() || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
    const finalUrl = finalUrlStr.replace(/\/$/, '');

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
};
