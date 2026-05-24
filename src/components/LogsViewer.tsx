import { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Activity, RefreshCw } from 'lucide-react';

interface Log {
  id: string;
  tenantId: string;
  leadId: string | null;
  whatsappNumber: string;
  incomingMessage: string;
  aiResponse: string | null;
  actionTaken: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

interface LogsViewerProps {
  tenantId: string;
  onClose: () => void;
}

export default function LogsViewer({ tenantId, onClose }: LogsViewerProps) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`/api/tenants/${tenantId}/logs`);
      setLogs(res.data);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [tenantId]);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col font-sans">
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <h2 className="text-lg font-medium text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-zinc-400" />
          Logs de Interação
          <span className="text-xs font-mono text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded ml-2">
            {tenantId}
          </span>
        </h2>
        <div className="flex items-center gap-4">
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="text-zinc-500 hover:text-white transition-colors"
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading && logs.length === 0 ? (
          <div className="flex justify-center py-10">
            <RefreshCw className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : error ? (
          <div className="text-red-400 text-sm text-center py-10">{error}</div>
        ) : logs.length === 0 ? (
          <div className="text-zinc-500 text-sm text-center py-10">Nenhum log encontrado para este tenant.</div>
        ) : (
          <div className="space-y-4">
            {logs.map((log) => (
              <div key={log.id} className="border border-zinc-800/50 bg-zinc-900/20 rounded p-4 text-sm flex flex-col gap-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-medium tracking-wide ${
                        log.status === 'SUCCESS' ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'
                      }`}
                    >
                      {log.status}
                    </span>
                    <span className="text-zinc-400 font-mono text-xs">{log.whatsappNumber}</span>
                  </div>
                  <span className="text-xs text-zinc-500 font-mono">
                    {new Date(log.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
                
                <div>
                  <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Mensagem do Cliente</div>
                  <div className="text-zinc-300 whitespace-pre-wrap">{log.incomingMessage}</div>
                </div>

                {log.aiResponse && (
                  <div>
                    <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Resposta IA</div>
                    <div className="text-zinc-400 italic">"{log.aiResponse}"</div>
                  </div>
                )}

                {log.actionTaken && (
                  <div>
                    <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Ação</div>
                    <div className="text-zinc-200 bg-zinc-800/50 px-2 py-1 rounded inline-block text-xs font-mono">{log.actionTaken}</div>
                  </div>
                )}

                {log.errorMessage && (
                  <div className="mt-2 bg-red-950/20 border border-red-900/30 text-red-400 p-2 rounded text-xs font-mono whitespace-pre-wrap">
                    Erro: {log.errorMessage}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
