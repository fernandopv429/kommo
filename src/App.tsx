/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Network, ExternalLink, RefreshCw, Pause, Play, CheckCircle2, XCircle, Smartphone, Save, Webhook } from 'lucide-react';
import WhatsAppConnection from './components/WhatsAppConnection';

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

  const fetchSettings = async () => {
    try {
      const res = await axios.get('/api/settings/N8N_WEBHOOK_URL');
      if (res.data?.value) {
        setWebhookUrl(res.data.value);
      }
    } catch (e: any) {
      console.error('Erro ao buscar configuração do webhook:', e.message);
    }
  };

  const saveWebhook = async () => {
    setSavingWebhook(true);
    try {
      await axios.post('/api/settings', { key: 'N8N_WEBHOOK_URL', value: webhookUrl });
      alert('Webhook centralizador salvo com sucesso!');
    } catch (e: any) {
      console.error('Erro ao salvar webhook:', e.message);
      alert('Falha ao salvar webhook centralizador.');
    } finally {
      setSavingWebhook(false);
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-12">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-zinc-800 pb-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg">
              <Network className="w-8 h-8 text-blue-500" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-white">Hub de Integrações</h1>
              <p className="text-zinc-400 mt-1">Gerenciador OAuth 2.0 Kommo (Multi-tenant)</p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
            <input
              type="text"
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              placeholder="Tenant ID (ex: emp-123)"
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all w-56"
            />
            <button
              onClick={handleConnect}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-5 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Nova Conexão
            </button>
          </div>
        </header>

        {/* Global Configuration Section */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="flex-1 w-full max-w-2xl">
            <label className="block text-sm font-medium text-zinc-400 mb-1.5 flex items-center gap-1.5">
              <Webhook className="w-4 h-4" /> Webhook Centralizador URL
            </label>
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://seu-sistema.com/webhook/..."
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all font-mono text-sm"
            />
          </div>
          <button
            onClick={saveWebhook}
            disabled={savingWebhook}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium py-2.5 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 shrink-0 md:mb-[1px]"
          >
            {savingWebhook ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar Webhook
          </button>
        </div>

        {errorMessage && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-start gap-3">
            <XCircle className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="whitespace-pre-wrap font-mono text-sm">{errorMessage}</div>
          </div>
        )}

        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-2">
              Status das Conexões
            </h2>
            <button
              onClick={fetchConnections}
              className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 rounded-lg text-sm transition-colors text-zinc-300"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar Listas
            </button>
          </div>

          {/* Tabela Ativas */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center gap-2">
               <CheckCircle2 className="w-5 h-5 text-emerald-500" />
               <h3 className="text-lg font-medium text-emerald-100">Conexões Ativas</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-zinc-400">
                <thead className="bg-zinc-950/50 text-xs uppercase font-medium text-zinc-500 border-b border-zinc-800">
                  <tr>
                    <th className="px-6 py-4">Tenant ID</th>
                    <th className="px-6 py-4">Nome Identificador</th>
                    <th className="px-6 py-4">Subdomínio Kommo</th>
                    <th className="px-6 py-4">Expira Em</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {activeConnections.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                        Nenhuma conexão ativa no momento.
                      </td>
                    </tr>
                  ) : (
                    activeConnections.map((conn) => (
                      <tr key={conn.id} className="hover:bg-zinc-800/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-zinc-200">{conn.tenantId}</td>
                        <td className="px-6 py-4">{conn.accountName || '-'}</td>
                        <td className="px-6 py-4">{conn.kommoSubdomain}.kommo.com</td>
                        <td className="px-6 py-4">{formatDate(conn.expiresAt)}</td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <button
                            onClick={() => setSelectedTenantForQR(conn.tenantId)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                            WhatsApp QR
                          </button>
                          <button
                            onClick={() => toggleStatus(conn.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                          >
                            <Pause className="w-3.5 h-3.5" />
                            Pausar / Desativar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabela Inativas */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden opacity-80 hover:opacity-100 transition-opacity">
            <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center gap-2">
               <XCircle className="w-5 h-5 text-zinc-500" />
               <h3 className="text-lg font-medium text-zinc-300">Conexões Inativas / Pausadas</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-zinc-400">
                <thead className="bg-zinc-950/50 text-xs uppercase font-medium text-zinc-500 border-b border-zinc-800">
                  <tr>
                    <th className="px-6 py-4">Tenant ID</th>
                    <th className="px-6 py-4">Nome Identificador</th>
                    <th className="px-6 py-4">Subdomínio Kommo</th>
                    <th className="px-6 py-4">Última Atualização</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {inactiveConnections.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                        Nenhuma conexão inativa.
                      </td>
                    </tr>
                  ) : (
                    inactiveConnections.map((conn) => (
                      <tr key={conn.id} className="hover:bg-zinc-800/50 transition-colors bg-zinc-950/20">
                        <td className="px-6 py-4 font-medium text-zinc-400">{conn.tenantId}</td>
                        <td className="px-6 py-4 text-zinc-500">{conn.accountName || '-'}</td>
                        <td className="px-6 py-4 text-zinc-500">{conn.kommoSubdomain}.kommo.com</td>
                        <td className="px-6 py-4 text-zinc-500">{formatDate(conn.updatedAt)}</td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => toggleStatus(conn.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                            Reativar
                          </button>
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

      {selectedTenantForQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity">
          <WhatsAppConnection 
            tenantId={selectedTenantForQR} 
            onClose={() => setSelectedTenantForQR(null)} 
          />
        </div>
      )}
    </div>
  );
}
