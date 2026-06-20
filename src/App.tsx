/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Network, ExternalLink, RefreshCw, Pause, Play, CheckCircle2, XCircle, Smartphone, Save, Webhook, Activity, Key, Copy } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import WhatsAppConnection from './components/WhatsAppConnection';
import LogsViewer from './components/LogsViewer';
import ManualConnectionModal from './components/ManualConnectionModal';

interface Connection {
  id: string;
  tenantId: string;
  accountName: string | null;
  kommoSubdomain: string;
  kommoAccountId: string;
  isActive: boolean;
  expiresAt: string;
  updatedAt: string;
  evolutionState?: string;
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
  const [showManualConnection, setShowManualConnection] = useState(false);
  const [openAiStats, setOpenAiStats] = useState<Record<string, any>>({});

  const getEvoStatusElement = (state?: string) => {
    switch(state) {
      case 'open':
        return <span className="text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider inline-block">Conectado</span>;
      case 'close':
        return <span className="text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider inline-block">Desconectado</span>;
      case 'connecting':
        return <span className="text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider inline-block">Conectando...</span>;
      case 'unknown':
      default:
        return <span className="text-zinc-500 bg-zinc-500/10 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider inline-block">Desconhecido</span>;
    }
  };

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

  const fetchOpenAiStats = async () => {
    try {
      const res = await axios.get('/api/openai/summary');
      setOpenAiStats(res.data || {});
    } catch (error) {
      console.warn('Erro ao buscar sumário da OpenAI', error);
    }
  };

  const generateOpenAiProject = async (tenantId: string, accountName: string) => {
    if (!confirm(`Deseja gerar um novo projeto OpenAI para ${accountName || tenantId}?`)) return;
    try {
      await axios.post('/api/openai/projects', {
        tenantId,
        projectName: accountName || tenantId
      });
      alert('Projeto e Credencial gerados com sucesso!');
      await fetchOpenAiStats();
    } catch (error: any) {
      console.error('Erro ao gerar projeto OpenAI', error);
      alert('Erro ao gerar projeto OpenAI: ' + (error.response?.data?.error || error.message));
    }
  };

  useEffect(() => {
    fetchConnections();
    fetchSettings();
    fetchOpenAiStats();
    
    // Auto-refresh connections list every 15 seconds to update Evolution's status
    const interval = setInterval(() => {
      fetchConnections();
    }, 15000);
    return () => clearInterval(interval);
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
            <p className="text-xs text-zinc-600 mt-1">Propriedade exclusiva - Desenvolvido por Fernando Nascimento Batista</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
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
              Auth
            </button>
            <button
              onClick={() => setShowManualConnection(true)}
              className="bg-zinc-800 text-zinc-300 hover:bg-zinc-700 font-medium py-1.5 px-4 rounded transition-colors flex items-center gap-2 text-sm border border-zinc-700"
            >
              <Key className="w-4 h-4" />
              Manual
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
            
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {activeConnections.length === 0 ? (
                <div className="col-span-full p-6 text-center text-zinc-600 text-sm border border-zinc-800 rounded bg-black/50">
                  Nenhuma conexão ativa no momento.
                </div>
              ) : (
                activeConnections.map((conn) => {
                  const pieData = [
                    { name: 'Tokens Entrada', value: openAiStats[conn.tenantId]?.tokensInput || 0, color: '#3b82f6' },
                    { name: 'Tokens Saída', value: openAiStats[conn.tenantId]?.tokensOutput || 0, color: '#a855f7' }
                  ].filter(d => d.value > 0);

                  return (
                    <div key={conn.id} className="bg-black border border-zinc-800 rounded-lg p-5 flex flex-col md:flex-row gap-6 group transition-all hover:bg-zinc-900/30">
                      
                      {/* Lado Esquerdo: Info e Botões */}
                      <div className="flex-1 flex flex-col gap-4 min-w-[50%]">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0 pr-4">
                            <h4 className="text-zinc-200 font-medium text-lg leading-tight truncate">{conn.accountName || conn.tenantId}</h4>
                            <p className="text-zinc-500 text-xs font-mono mt-1 w-full truncate" title={conn.tenantId}>ID: {conn.tenantId}</p>
                          </div>
                          <div className="flex h-2 w-2 rounded-full bg-emerald-500 shrink-0 mt-2 shadow-[0_0_8px_rgba(16,185,129,0.5)]" title="Ativo" />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div className="text-sm font-mono text-zinc-400 truncate">
                            <span className="text-zinc-600 block text-[10px] uppercase tracking-wider mb-1">Domínio API</span>
                            <span className="truncate block w-full" title={`${conn.kommoSubdomain}.kommo.com`}>
                              {conn.kommoSubdomain}.kommo.com
                            </span>
                          </div>

                          <div className="text-sm font-mono text-zinc-400">
                            <span className="text-zinc-600 block text-[10px] uppercase tracking-wider mb-1">WhatsApp Status</span>
                            <div className="mt-0.5">
                              {getEvoStatusElement(conn.evolutionState)}
                            </div>
                          </div>
                        </div>

                        {/* Credencial OpenAI (Secret Key) */}
                        <div className="text-sm border-t border-zinc-800/80 pt-3 mt-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-zinc-500 block text-[10px] uppercase tracking-wider font-sans font-semibold">Credencial OpenAI (Secret Key)</span>
                            {!openAiStats[conn.tenantId]?.apiKey ? (
                              <button
                                onClick={() => generateOpenAiProject(conn.tenantId, conn.accountName || "")}
                                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-[10px] uppercase tracking-wider font-medium transition-colors"
                                title="Gerar Secret Key"
                              >
                                Gerar Key
                              </button>
                            ) : (
                              <button 
                                onClick={() => {
                                  const key = openAiStats[conn.tenantId]?.apiKey;
                                  if (key) {
                                    navigator.clipboard.writeText(key);
                                    alert('Secret Key copiada para a área de transferência!');
                                  }
                                }}
                                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs border border-zinc-700"
                                title="Copiar Secret Key"
                              >
                                <Copy size={14} /> Copiar Key
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-start gap-2 mt-auto pt-4 border-t border-zinc-800/50">
                          <button
                            onClick={() => handleSyncEvolutionWebhook(conn.tenantId)}
                            disabled={syncingTenant === conn.tenantId}
                            className="text-zinc-400 hover:text-blue-400 transition-colors flex items-center justify-center w-8 h-8 rounded hover:bg-zinc-800 shrink-0"
                            title="Sincronizar Webhook Evolution"
                          >
                            <RefreshCw className={`w-4 h-4 ${syncingTenant === conn.tenantId ? 'animate-spin' : ''}`} />
                          </button>
                          <button
                            onClick={() => setSelectedTenantForQR(conn.tenantId)}
                            className="text-zinc-400 hover:text-emerald-400 transition-colors flex items-center justify-center w-8 h-8 rounded hover:bg-zinc-800 shrink-0"
                            title="WhatsApp QR"
                          >
                            <Smartphone className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setSelectedTenantForLogs(conn.tenantId)}
                            className="text-zinc-400 hover:text-purple-400 transition-colors flex items-center justify-center w-8 h-8 rounded hover:bg-zinc-800 shrink-0"
                            title="Logs"
                          >
                            <Activity className="w-4 h-4" />
                          </button>
                          
                          <div className="flex-1"></div>
                          
                          <button
                            onClick={() => toggleStatus(conn.id)}
                            className="text-zinc-400 hover:text-red-400 transition-colors flex items-center justify-center w-8 h-8 rounded hover:bg-zinc-800 shrink-0"
                            title="Pausar / Desativar"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Lado Direito: Gráfico e Stats OpenAI */}
                      <div className="w-full md:w-[220px] lg:w-[260px] flex flex-col pt-3 md:pt-0 md:pl-6 md:border-l md:border-zinc-800/50 shrink-0 justify-center">
                         <h5 className="text-zinc-500 text-[10px] font-sans font-bold uppercase tracking-wider mb-4 border-b border-zinc-800/50 pb-2">Uso OpenAI (Mês)</h5>
                         
                         <div className="grid grid-cols-2 gap-4 mb-4">
                           <div>
                             <span className="text-zinc-600 block text-[10px] uppercase tracking-wider mb-1 font-mono">Gasto</span>
                             <span className="text-lg font-medium text-emerald-400 font-mono tracking-tight">
                               {openAiStats[conn.tenantId]?.cost ? `$ ${openAiStats[conn.tenantId].cost.toFixed(2)}` : '$ 0.00'}
                             </span>
                           </div>
                           <div>
                             <span className="text-zinc-600 block text-[10px] uppercase tracking-wider mb-1 font-mono">Tokens</span>
                             <span className="text-lg font-medium text-purple-400 font-mono tracking-tight">
                               {openAiStats[conn.tenantId]?.tokensTotal ? openAiStats[conn.tenantId].tokensTotal.toLocaleString('pt-BR') : '0'}
                             </span>
                           </div>
                         </div>

                         {pieData.length > 0 ? (
                           <div className="h-[120px] w-full">
                             <ResponsiveContainer width="100%" height="100%">
                               <PieChart>
                                 <Pie
                                   data={pieData}
                                   cx="50%"
                                   cy="50%"
                                   innerRadius={30}
                                   outerRadius={50}
                                   paddingAngle={2}
                                   dataKey="value"
                                   stroke="none"
                                 >
                                   {pieData.map((entry, index) => (
                                     <Cell key={`cell-${index}`} fill={entry.color} />
                                   ))}
                                 </Pie>
                                 <RechartsTooltip 
                                   contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', fontSize: '12px' }}
                                   itemStyle={{ color: '#e4e4e7' }}
                                   formatter={(value: number) => value.toLocaleString('pt-BR')}
                                 />
                               </PieChart>
                             </ResponsiveContainer>
                           </div>
                         ) : (
                           <div className="flex-1 flex items-center justify-center min-h-[120px] text-zinc-600 text-xs font-mono bg-zinc-900/30 rounded border border-dashed border-zinc-800">
                             Nenhum uso registrado
                           </div>
                         )}

                         {pieData.length > 0 && (
                            <div className="flex justify-center gap-3 mt-2 text-[10px] uppercase tracking-wider font-mono text-zinc-500">
                               <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-blue-500" />Entrada</div>
                               <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-purple-500" />Saída</div>
                            </div>
                         )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Tabela Inativas */}
          <div className="space-y-4 pt-4">
             <div className="flex items-center gap-2 px-1">
               <div className="w-2 h-2 rounded-full bg-zinc-600" />
               <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-widest">Inativas</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {inactiveConnections.length === 0 ? (
                <div className="col-span-full p-6 text-center text-zinc-700 text-sm border border-zinc-800/50 rounded-lg bg-black/30">
                  Nenhuma conexão inativa.
                </div>
              ) : (
                inactiveConnections.map((conn) => {
                  const pieData = [
                    { name: 'Tokens Entrada', value: openAiStats[conn.tenantId]?.tokensInput || 0, color: '#3b82f6' },
                    { name: 'Tokens Saída', value: openAiStats[conn.tenantId]?.tokensOutput || 0, color: '#a855f7' }
                  ].filter(d => d.value > 0);

                  return (
                    <div key={conn.id} className="bg-black/50 border border-zinc-800/80 rounded-lg p-5 flex flex-col md:flex-row gap-6 group transition-colors hover:bg-zinc-900/40 opacity-75 hover:opacity-100">
                      <div className="flex-1 flex flex-col gap-4 min-w-[50%]">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0 pr-4">
                            <h4 className="text-zinc-400 font-medium truncate text-base hover:text-zinc-300 transition-colors">{conn.accountName || conn.tenantId}</h4>
                            <p className="text-zinc-600 text-xs font-mono mt-1 w-full truncate" title={conn.tenantId}>ID: {conn.tenantId}</p>
                          </div>
                          <div className="flex h-2 w-2 rounded-full bg-zinc-600 shrink-0 mt-2" title="Inativo" />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div className="text-sm font-mono text-zinc-500 truncate">
                            <span className="text-zinc-700 block text-[10px] uppercase tracking-wider mb-1">Domínio API</span>
                            <span className="truncate block w-full" title={`${conn.kommoSubdomain}.kommo.com`}>
                              {conn.kommoSubdomain}.kommo.com
                            </span>
                          </div>

                          <div className="text-sm font-mono text-zinc-500">
                            <span className="text-zinc-700 block text-[10px] uppercase tracking-wider mb-1">WhatsApp Status</span>
                            <div className="mt-0.5 opacity-70">
                              {getEvoStatusElement(conn.evolutionState)}
                            </div>
                          </div>
                        </div>

                        {/* Credencial OpenAI (Secret Key) */}
                        <div className="text-sm border-t border-zinc-800/50 pt-3 mt-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-zinc-600 block text-[10px] uppercase tracking-wider font-sans font-semibold">Credencial OpenAI (Secret Key)</span>
                            {!openAiStats[conn.tenantId]?.apiKey ? (
                              <button
                                onClick={() => generateOpenAiProject(conn.tenantId, conn.accountName || "")}
                                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-[10px] uppercase tracking-wider font-medium transition-colors"
                                title="Gerar Secret Key"
                              >
                                Gerar Key
                              </button>
                            ) : (
                              <button 
                                onClick={() => {
                                  const key = openAiStats[conn.tenantId]?.apiKey;
                                  if (key) {
                                    navigator.clipboard.writeText(key);
                                    alert('Secret Key copiada para a área de transferência!');
                                  }
                                }}
                                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-500 hover:text-white transition-colors flex items-center gap-1.5 text-xs border border-zinc-700"
                                title="Copiar Secret Key"
                              >
                                <Copy size={14} /> Copiar Key
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-start gap-2 mt-auto pt-4 border-t border-zinc-800/50">
                          <button
                            onClick={() => setSelectedTenantForLogs(conn.tenantId)}
                            className="text-zinc-500 hover:text-purple-400 hover:bg-zinc-800/80 transition-colors flex items-center justify-center w-8 h-8 rounded shrink-0"
                            title="Logs"
                          >
                            <Activity className="w-4 h-4" />
                          </button>

                          <div className="flex-1"></div>

                          <button
                            onClick={() => toggleStatus(conn.id)}
                            className="text-zinc-500 hover:text-white hover:bg-zinc-800/80 transition-colors flex items-center justify-center w-8 h-8 rounded shrink-0"
                            title="Start"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Lado Direito: Gráfico e Stats OpenAI */}
                      <div className="w-full md:w-[220px] lg:w-[260px] flex flex-col pt-3 md:pt-0 md:pl-6 md:border-l md:border-zinc-800/30 shrink-0 justify-center">
                         <h5 className="text-zinc-600 text-[10px] font-sans font-bold uppercase tracking-wider mb-4 border-b border-zinc-800/30 pb-2">Uso OpenAI (Mês)</h5>
                         
                         <div className="grid grid-cols-2 gap-4 mb-4 opacity-70">
                           <div>
                             <span className="text-zinc-700 block text-[10px] uppercase tracking-wider mb-1 font-mono">Gasto</span>
                             <span className="text-lg font-medium text-emerald-500/50 font-mono tracking-tight">
                               {openAiStats[conn.tenantId]?.cost ? `$ ${openAiStats[conn.tenantId].cost.toFixed(2)}` : '$ 0.00'}
                             </span>
                           </div>
                           <div>
                             <span className="text-zinc-700 block text-[10px] uppercase tracking-wider mb-1 font-mono">Tokens</span>
                             <span className="text-lg font-medium text-purple-500/50 font-mono tracking-tight">
                               {openAiStats[conn.tenantId]?.tokensTotal ? openAiStats[conn.tenantId].tokensTotal.toLocaleString('pt-BR') : '0'}
                             </span>
                           </div>
                         </div>

                         {pieData.length > 0 ? (
                           <div className="h-[120px] w-full opacity-60 grayscale hover:grayscale-0 transition-all">
                             <ResponsiveContainer width="100%" height="100%">
                               <PieChart>
                                 <Pie
                                   data={pieData}
                                   cx="50%"
                                   cy="50%"
                                   innerRadius={30}
                                   outerRadius={50}
                                   paddingAngle={2}
                                   dataKey="value"
                                   stroke="none"
                                 >
                                   {pieData.map((entry, index) => (
                                     <Cell key={`cell-${index}`} fill={entry.color} />
                                   ))}
                                 </Pie>
                                 <RechartsTooltip 
                                   contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', fontSize: '12px' }}
                                   itemStyle={{ color: '#e4e4e7' }}
                                   formatter={(value: number) => value.toLocaleString('pt-BR')}
                                 />
                               </PieChart>
                             </ResponsiveContainer>
                           </div>
                         ) : (
                           <div className="flex-1 flex items-center justify-center min-h-[120px] text-zinc-700 text-xs font-mono bg-black/20 rounded border border-dashed border-zinc-800/50">
                             Nenhum uso registrado
                           </div>
                         )}
                      </div>
                    </div>
                  );
                })
              )}
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

      {showManualConnection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-opacity">
          <ManualConnectionModal 
            onClose={() => setShowManualConnection(false)} 
            onSuccess={() => {
              setShowManualConnection(false);
              fetchConnections();
            }}
          />
        </div>
      )}
    </div>
  );
}
