import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

async function test() {
  const ai = new GoogleGenAI({ apiKey: "AIzaSyAH3nGvrUfV2SFvCVhABOJ5qLdVX-KbdEI" });
  const prompt = `Você é um analista de CRM inteligente responsável por mover leads pelas etapas do funil de vendas (pipeline), e atualizar os dados do lead baseado no que ele falar.

Analise a seguinte mensagem recente do Lead (usuário/cliente):
Mensagem do Lead: "Gostaria de realizar um agendamento"

O Lead está atualmente na etapa (status) de ID: 123.

Aqui estão as etapas (statuses) disponíveis no funil atual do lead, em ordem, junto com seus nomes e descrições.
Muita atenção ao "name" da etapa: se a mensagem do cliente indicar forte intenção ou pedido correspondente ao NOME da etapa (ex: cliente quer "agendar", e existe uma etapa "Agendamento"), você DEVE movê-lo para essa etapa imediatamente.
[
  {
    "id": 123,
    "name": "Novo",
    "description": "Lead entrou agora"
  },
  {
    "id": 456,
    "name": "Agendamento",
    "description": "Lead quer agendar, 1 dica"
  }
]

Sua tarefa:
1. Avalie se o Lead fez algo que corresponda ao avanço para uma NOVA ETAPA do funil, baseado ÚNICA E EXCLUSIVAMENTE nas intenções claras da mensagem dele relacionadas aos nomes das etapas ou descrições.
   - Se a intenção do cliente for compatível com uma etapa futura (ex: pediu agendamento -> etapa de agendamento), retorne o "ID" numérico dessa nova etapa em (novoStatusId).
   - Se o lead deve PERMANECER na etapa atual (a mensagem não justifica mudança de contexto), retorne o ID da etapa atual (123).
2. Identifique se a mensagem traz informações ("intent") para preencher algum dos campos personalizados disponíveis.
   - Extraia os dados relevantes e relacione-os usando "field_id" e "field_name", além do "value".
   - Retorne no array 'custom_fields' apenas se achar informacoes correspondentes aos campos.
   - Se nenhum campo foi identificado, retorne um array vazio [].
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          novoStatusId: { type: Type.NUMBER, description: "ID exato da nova etapa, ou da etapa atual se não houver mudança" },
          custom_fields: { 
            type: Type.ARRAY, 
            items: {
              type: Type.OBJECT,
              properties: {
                field_id: { type: Type.NUMBER, description: "ID of the custom field" },
                field_name: { type: Type.STRING, description: "Name of the custom field" },
                value: { type: Type.STRING, description: "Extracted value for the field" }
              },
              required: ["field_id", "field_name", "value"]
            }
          }
        },
        required: ["novoStatusId", "custom_fields"]
      }
    }
  });
  
  console.log(response.text);
}
test().catch(console.error);
