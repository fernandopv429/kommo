import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function fetchLeadData(tenantId: string, telefone_limpo: string, connection: any) {
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

      return {
        exists: true,
        source: 'api',
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
