import React, { useState } from 'react';
import axios from 'axios';
import { X, Save, Key } from 'lucide-react';

interface ManualConnectionModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function ManualConnectionModal({ onClose, onSuccess }: ManualConnectionModalProps) {
  const [formData, setFormData] = useState({
    tenantId: '',
    accountName: '',
    kommoAccountId: '',
    kommoSubdomain: '',
    accessToken: '',
    refreshToken: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await axios.post('/api/connections/manual', formData);
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Erro ao adicionar conexão manualmente.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
      <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
        <h2 className="text-lg font-medium text-white flex items-center gap-2">
          <Key className="w-5 h-5 text-emerald-400" />
          Adicionar Credenciais Manualmente
        </h2>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-white transition-colors p-1"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-6 overflow-y-auto">
        {error && (
          <div className="mb-6 p-4 bg-red-950/30 border border-red-900/50 text-red-400 rounded text-sm">
            {error}
          </div>
        )}

        <form id="manual-connection-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
               <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Tenant ID *</label>
               <input
                 required
                 type="text"
                 name="tenantId"
                 value={formData.tenantId}
                 onChange={handleChange}
                 placeholder="Ex: emp-123"
                 className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono text-sm placeholder-zinc-700"
               />
            </div>
            <div>
               <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Nome da Conta (Opcional)</label>
               <input
                 type="text"
                 name="accountName"
                 value={formData.accountName}
                 onChange={handleChange}
                 placeholder="Ex: Minha Empresa Ltda"
                 className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all text-sm placeholder-zinc-700"
               />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
               <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Kommo Account ID *</label>
               <input
                 required
                 type="text"
                 name="kommoAccountId"
                 value={formData.kommoAccountId}
                 onChange={handleChange}
                 placeholder="Ex: 31235123"
                 className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono text-sm placeholder-zinc-700"
               />
            </div>
            <div>
               <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Subdomínio Kommo *</label>
               <input
                 required
                 type="text"
                 name="kommoSubdomain"
                 value={formData.kommoSubdomain}
                 onChange={handleChange}
                 placeholder="Ex: meudominio"
                 className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono text-sm placeholder-zinc-700"
               />
               <p className="text-xs text-zinc-600 mt-1 max-w-sm">Apenas o nome do subdomínio, sem .kommo.com</p>
            </div>
          </div>

          <div>
             <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Access Token *</label>
             <textarea
               required
               name="accessToken"
               value={formData.accessToken}
               onChange={handleChange}
               rows={3}
               placeholder="eyJhb..."
               className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono text-sm placeholder-zinc-700 resize-none break-all"
             />
          </div>

          <div>
             <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Refresh Token *</label>
             <textarea
               required
               name="refreshToken"
               value={formData.refreshToken}
               onChange={handleChange}
               rows={3}
               placeholder="eyJhb..."
               className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono text-sm placeholder-zinc-700 resize-none break-all"
             />
          </div>

        </form>
      </div>

      <div className="p-4 border-t border-zinc-800 bg-zinc-900/30 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          form="manual-connection-form"
          disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-6 rounded transition-colors flex items-center justify-center gap-2"
        >
          {loading ? 'Salvando...' : (
            <>
              <Save className="w-4 h-4" /> 
              Salvar Credenciais
            </>
          )}
        </button>
      </div>
    </div>
  );
}
