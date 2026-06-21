import axios from 'axios';

export async function createEvolutionInstance(tenantId: string, hostUrl?: string) {
  const EVOLUTION_URL_EXEC = process.env.EVOLUTION_URL || "https://evo.a5ecossistema.tech";
  const EVOLUTION_API_KEY_EXEC = process.env.EVOLUTION_API_KEY || "qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3";

  let createdResponse = null;

  const setWebhook = async () => {
    console.log(`[Evolution] Configurando Webhook Centralizador para a instância: ${tenantId}`);
    try {
      const finalUrlStr = hostUrl?.trim() || (process.env.APP_URL?.trim() || 'https://tarif.nexusdevhub.com');
      const finalUrl = finalUrlStr.replace(/\/$/, '');

      await axios.post(
        `${EVOLUTION_URL_EXEC}/webhook/set/${tenantId}`,
        {
          webhook: {
            enabled: true,
            url: `${finalUrl}/api/webhooks/evolution/${tenantId}`,
            webhookByEvents: false,
            byEvents: false,
            webhookBase64: false,
            base64: false,
            events: [
              "MESSAGES_UPSERT",
              "CONNECTION_UPDATE",
              "messages.upsert",
              "connection.update"
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
