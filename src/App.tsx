/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Network, ExternalLink, RefreshCw, Pause, Play, CheckCircle2, XCircle } from 'lucide-react';

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

  const fetchConnections = async () => {
    setLoading(true);
    try {
      const res = await axios.get<Connection[]>('/api/connections');
      const allConns = res.data;
      setActiveConnections(allConns.filter(c => c.isActive));
      setInactiveConnections(allConns.filter(c => !c.isActive));
    } catch (e) {
      console.error('Erro ao buscar as conexões:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
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
                        <td className="px-6 py-4 text-right">
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
    </div>
  );
}
