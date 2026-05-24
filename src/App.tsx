/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Network, ExternalLink, RefreshCw, Pause, Play, CheckCircle2, XCircle, Smartphone, Save, Webhook, Activity } from 'lucide-react';
import WhatsAppConnection from './components/WhatsAppConnection';
import LogsViewer from './components/LogsViewer';

interface Connection {
  id: string;
  tenantId: string;
  accountName: string | null;
  kommoSubdomain: string;
  kommoAccountId: string;
  isActive: boolean;
  expiresAt: string;
  updatedAt: string;
}

export default function App() {
  const [empresaId, setEmpresaId] = useState('');
  const [activeConnections, setActiveConnections] = useState<Connection[]>([]);
  const [inactiveConnections, setInactiveConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTenantForQR, setSelectedTenantForQR] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [syncingTenant, setSyncingTenant] = useState<string | null>(null);
  const [selectedTenantForLogs, setSelectedTenantForLogs] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      const resN8N = await axios.get('/api/settings/N8N_WEBHOOK_URL');
      if (resN8N.data?.value) {
        setWebhookUrl(resN8N.data.value);
      }
    } catch (e: any) {
      console.error('Erro ao buscar configuração do webhook:', e.message);
    }
  };

  const saveSettings = async () => {
    setSavingWebhook(true);
    try {
      await axios.post('/api/settings', { key: 'N8N_WEBHOOK_URL', value: webhookUrl });
      alert('Configurações salvas com sucesso!');
    } catch (e: any) {
      console.error('Erro ao salvar webhook:', e.message);
      alert('Falha ao salvar configurações.');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleSyncEvolutionWebhook = async (tenantId: string) => {
    setSyncingTenant(tenantId);
    try {
      await axios.post(`/api/tenants/${tenantId}/sync-webhook`);
      alert(`Webhook Evolution atualizado/sintonizado com sucesso.`);
    } catch (e: any) {
      const details = e.response?.data?.details;
      alert(`Erro ao sincronizar webhook na Evolution.\nDetalhes: ${JSON.stringify(details || e.response?.data || e.message)}`);
    } finally {
      setSyncingTenant(null);
    }
  };

  const fetchConnections = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await axios.get<Connection[]>('/api/connections');
      const allConns = res.data;
      setActiveConnections(allConns.filter(c => c.isActive));
      setInactiveConnections(allConns.filter(c => !c.isActive));
    } catch (e: any) {
      console.error('Erro ao buscar as conexões:', e);
      const backendError = e.response?.data?.error || e.message;
      setErrorMessage(`Erro de conexão: ${backendError}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
    fetchSettings();
  }, []);

  const handleConnect = () => {
    if (!empresaId) return alert('Por favor, informe o ID da Empresa');
    window.location.href = `/auth/kommo/connect?empresa_id=${empresaId}`;
  };

  const toggleStatus = async (id: string) => {
    try {
      await axios.patch(`/api/connections/${id}/toggle`);
      await fetchConnections();
    } catch (error) {
      console.error('Erro ao alterar status:', error);
      alert('Não foi possível alterar o status da conexão.');
    }
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 p-4 md:p-10 font-sans selection:bg-purple-500/30">
      <div className="max-w-6xl mx-auto space-y-12">
        {/* Header Options */}
        <header className="flex flex-col md:flex-row items-baseline justify-between gap-6 pb-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-100 flex items-center gap-3">
              <Network className="w-7 h-7 text-zinc-400" />
              Integrações
            </h1>
            <p className="text-sm text-zinc-500 mt-2">Gerenciador OAuth 2.0 Kommo (Multi-tenant)</p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              placeholder="Tenant ID (ex: emp-123)"
              className="bg-transparent border border-zinc-800 rounded px-3 py-1.5 text-zinc-200 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all text-sm w-48 placeholder-zinc-700"
            />
            <button
              onClick={handleConnect}
              className="bg-white text-black hover:bg-zinc-200 font-medium py-1.5 px-4 rounded transition-colors flex items-center gap-2 text-sm"
            >
              <ExternalLink className="w-4 h-4" />
              Nova Conexão
            </button>
          </div>
        </header>

        {/* Global Configuration Section */}
        <div className="border border-zinc-800 rounded-lg p-5 flex flex-col md:flex-row md:items-end justify-between gap-4 bg-zinc-950/30">
          <div className="flex-1 w-full max-w-2xl">
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Webhook className="w-3.5 h-3.5" /> Webhook Centralizador URL
            </label>
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://seu-sistema.com/webhook/..."
              className="w-full bg-transparent border border-zinc-800 rounded px-3 py-2 text-zinc-200 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all font-mono text-sm placeholder-zinc-700"
            />
          </div>
          <button
            onClick={saveSettings}
            disabled={savingWebhook}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-5 rounded transition-colors flex items-center justify-center gap-2 shrink-0 border border-zinc-700 h-[38px]"
          >
            {savingWebhook ? <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" /> : <Save className="w-4 h-4 text-zinc-400" />}
            Salvar
          </button>
        </div>

        {errorMessage && (
          <div className="bg-red-950/30 border border-red-900/50 text-red-400 p-4 rounded flex items-start gap-3 text-sm">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="whitespace-pre-wrap font-mono">{errorMessage}</div>
          </div>
        )}

        <div className="space-y-10">
          <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
            <h2 className="text-xl font-medium tracking-tight text-white flex items-center gap-2">
              Status das Conexões
            </h2>
            <button
              onClick={fetchConnections}
              className="group flex items-center gap-2 px-3 py-1 bg-transparent hover:bg-zinc-900 rounded text-xs transition-colors text-zinc-500 hover:text-zinc-300"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-zinc-300' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
              Atualizar
            </button>
          </div>

          {/* Tabelas combinadas ou separadas por seções clean */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-1">
               <div className="w-2 h-2 rounded-full bg-emerald-500" />
               <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-widest">Ativas</h3>
            </div>
            
            <div className="border border-zinc-800 rounded bg-black overflow-hidden">
              <table className="w-full text-left text-sm text-zinc-400 font-mono">
                <thead className="text-xs text-zinc-500 border-b border-zinc-800 bg-zinc-900/20">
                  <tr>
                    <th className="px-4 py-3 font-normal">Tenant ID</th>
                    <th className="px-4 py-3 font-normal">Identificador</th>
                    <th className="px-4 py-3 font-normal">Domínio</th>
                    <th className="px-4 py-3 font-normal">Expira Em</th>
                    <th className="px-4 py-3 font-normal text-right">Opções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {activeConnections.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-zinc-600 text-xs">
                        Nenhuma conexão ativa no momento.
                      </td>
                    </tr>
                  ) : (
                    activeConnections.map((conn) => (
                      <tr key={conn.id} className="hover:bg-zinc-900/30 transition-colors group">
                        <td className="px-4 py-3 text-zinc-300">{conn.tenantId}</td>
                        <td className="px-4 py-3">{conn.accountName || '-'}</td>
                        <td className="px-4 py-3 truncate max-w-[150px]">{conn.kommoSubdomain}.kommo.com</td>
                        <td className="px-4 py-3">{formatDate(conn.expiresAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleSyncEvolutionWebhook(conn.tenantId)}
                              disabled={syncingTenant === conn.tenantId}
                              className="text-zinc-500 hover:text-blue-400 transition-colors flex items-center gap-1.5 text-xs"
                              title="Sincronizar Webhook Evolution"
                            >
                              <RefreshCw className={`w-4 h-4 ${syncingTenant === conn.tenantId ? 'animate-spin' : ''}`} />
                              Sync
                            </button>
                            <span className="text-zinc-800 hidden md:inline">|</span>
                            <button
                              onClick={() => setSelectedTenantForQR(conn.tenantId)}
                              className="text-zinc-500 hover:text-emerald-400 transition-colors flex items-center gap-1.5 text-xs"
                              title="WhatsApp QR"
                            >
                              <Smartphone className="w-4 h-4" /> QR
                            </button>
                            <span className="text-zinc-800">|</span>
                            <button
                              onClick={() => setSelectedTenantForLogs(conn.tenantId)}
                              className="text-zinc-500 hover:text-purple-400 transition-colors flex items-center gap-1.5 text-xs"
                              title="Logs"
                            >
                              <Activity className="w-4 h-4" /> Logs
                            </button>
                            <span className="text-zinc-800">|</span>
                            <button
                              onClick={() => toggleStatus(conn.id)}
                              className="text-zinc-500 hover:text-red-400 transition-colors flex items-center gap-1.5 text-xs"
                              title="Pausar / Desativar"
                            >
                              <Pause className="w-4 h-4" /> Parar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabela Inativas */}
          <div className="space-y-4 pt-4">
             <div className="flex items-center gap-2 px-1">
               <div className="w-2 h-2 rounded-full bg-zinc-600" />
               <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-widest">Inativas</h3>
            </div>
            <div className="border border-zinc-800/50 rounded bg-black/50 overflow-hidden">
              <table className="w-full text-left text-sm text-zinc-500 font-mono">
                 <thead className="text-xs text-zinc-600 border-b border-zinc-800/50">
                  <tr>
                    <th className="px-4 py-3 font-normal">Tenant ID</th>
                    <th className="px-4 py-3 font-normal">Identificador</th>
                    <th className="px-4 py-3 font-normal">Domínio</th>
                    <th className="px-4 py-3 font-normal">Atualizado Em</th>
                    <th className="px-4 py-3 font-normal text-right">Opções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {inactiveConnections.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-zinc-700 text-xs">
                        Nenhuma conexão inativa.
                      </td>
                    </tr>
                  ) : (
                    inactiveConnections.map((conn) => (
                      <tr key={conn.id} className="hover:bg-zinc-900/30 transition-colors group">
                        <td className="px-4 py-3 text-zinc-400">{conn.tenantId}</td>
                        <td className="px-4 py-3">{conn.accountName || '-'}</td>
                        <td className="px-4 py-3 truncate max-w-[150px]">{conn.kommoSubdomain}.kommo.com</td>
                        <td className="px-4 py-3">{formatDate(conn.updatedAt)}</td>
                        <td className="px-4 py-3 text-right">
                           <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity gap-3">
                            <button
                              onClick={() => setSelectedTenantForLogs(conn.tenantId)}
                              className="text-zinc-500 hover:text-purple-400 transition-colors flex items-center gap-1.5 text-xs"
                              title="Logs"
                            >
                              <Activity className="w-4 h-4" /> Logs
                            </button>
                            <span className="text-zinc-800 hidden md:inline">|</span>
                            <button
                              onClick={() => toggleStatus(conn.id)}
                              className="text-zinc-500 hover:text-white transition-colors flex items-center gap-1.5 text-xs"
                            >
                              <Play className="w-4 h-4" /> Start
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {selectedTenantForLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-opacity">
          <LogsViewer 
            tenantId={selectedTenantForLogs} 
            onClose={() => setSelectedTenantForLogs(null)} 
          />
        </div>
      )}

      {selectedTenantForQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-opacity">
          <WhatsAppConnection 
            tenantId={selectedTenantForQR} 
            onClose={() => setSelectedTenantForQR(null)} 
          />
        </div>
      )}
    </div>
  );
}
