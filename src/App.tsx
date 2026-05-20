/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Network, Database, Link as ShieldCheck, ExternalLink, RefreshCw } from 'lucide-react';

export default function App() {
  const [empresaId, setEmpresaId] = useState('');
  const [connections, setConnections] = useState<{ id: string; empresa_id: string; kommo_subdomain: string; expires_at: string; updated_at: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchConnections = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/connections');
      const data = await res.json();
      if (Array.isArray(data)) {
        setConnections(data);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchConnections();
  }, []);

  const handleConnect = () => {
    if (!empresaId) return alert('Por favor, informe o ID da Empresa');
    // Redireciona o lojista/usuário para a Rota 1 
    window.location.href = `/auth/kommo/connect?empresa_id=${empresaId}`;
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Header */}
        <header className="flex items-center gap-4 border-b border-neutral-800 pb-6">
          <div className="p-3 bg-blue-600/20 rounded-xl">
            <Network className="w-8 h-8 text-blue-500" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Hub de Integrações</h1>
            <p className="text-neutral-400 mt-1">Gerenciador OAuth 2.0 Kommo (Multi-tenant)</p>
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Card Configurar Nova Conexão */}
          <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-6 shadow-xl">
            <h2 className="text-xl font-medium mb-4 flex items-center gap-2">
              <ExternalLink className="w-5 h-5 text-neutral-400" />
              Nova Conexão Kommo
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-2">
                  ID da Empresa (Tenant ID)
                </label>
                <input
                  type="text"
                  value={empresaId}
                  onChange={(e) => setEmpresaId(e.target.value)}
                  placeholder="ex: tenant-12345"
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>
              <button
                onClick={handleConnect}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                Conectar Kommo
              </button>
            </div>
            <p className="text-xs text-neutral-500 mt-4 leading-relaxed">
              O administrador da empresa será direcionado ao portal da Kommo para autorizar o acesso. Certifique-se que as chaves de API estão configuradas no .env.
            </p>
          </div>

          {/* Card Listagem Banco de Dados */}
          <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-6 shadow-xl flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-medium flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-500" />
                Conexões Ativas
              </h2>
              <button onClick={fetchConnections} className="p-2 hover:bg-neutral-700 rounded-lg transition-colors" title="Atualizar">
                <RefreshCw className={`w-4 h-4 text-neutral-400 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-3">
              {connections.length === 0 ? (
                <div className="h-full flex items-center justify-center text-neutral-500 text-sm">
                  Nenhuma conexão registrada.
                </div>
              ) : (
                connections.map((conn, idx) => (
                  <div key={idx} className="bg-neutral-900/50 border border-neutral-700/50 rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-blue-400" />
                        {conn.empresa_id}
                      </p>
                      <p className="text-sm text-neutral-500 mt-1">
                        Subdomínio: <span className="text-neutral-300">{conn.kommo_subdomain}.kommo.com</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Ativa
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
