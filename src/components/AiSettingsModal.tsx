import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Save, RefreshCw, Bot, Check, LayoutTemplate, Link } from 'lucide-react';

interface Stage {
  id: number;
  name: string;
  color: string;
}

interface Pipeline {
  id: number;
  name: string;
  statuses: Stage[];
}

interface AiSettingsModalProps {
  connectionId: string;
  tenantId: string;
  accountName: string | null;
  initialAiEnabled: boolean;
  initialActiveStages: number[];
  initialActivePipelines: number[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function AiSettingsModal({
  connectionId,
  tenantId,
  accountName,
  initialAiEnabled,
  initialActiveStages,
  initialActivePipelines,
  onClose,
  onSuccess
}: AiSettingsModalProps) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [aiEnabled, setAiEnabled] = useState(initialAiEnabled);
  const [activeStages, setActiveStages] = useState<number[]>(initialActiveStages);
  const [activePipelines, setActivePipelines] = useState<number[]>(initialActivePipelines || []);

  useEffect(() => {
    const fetchPipelines = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get(`/api/connections/${connectionId}/pipelines`);
        setPipelines(response.data);
      } catch (err: any) {
        console.error('Erro ao buscar pipelines:', err);
        setError('Não foi possível carregar as pipelines desta conta Kommo. Verifique se a conexão está ativa e tente novamente.');
      } finally {
        setLoading(false);
      }
    };

    fetchPipelines();
  }, [connectionId]);

  const toggleStage = (stageId: number) => {
    setActiveStages(prev =>
      prev.includes(stageId)
        ? prev.filter(id => id !== stageId)
        : [...prev, stageId]
    );
  };
  
  const togglePipeline = (pipelineId: number) => {
    setActivePipelines(prev =>
      prev.includes(pipelineId)
        ? prev.filter(id => id !== pipelineId)
        : [...prev, pipelineId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await axios.patch(`/api/connections/${connectionId}/ai-settings`, {
        aiEnabled,
        aiActiveStages: activeStages,
        aiActivePipelines: activePipelines
      });
      onSuccess();
    } catch (err: any) {
      console.error('Erro ao salvar as configurações de IA:', err);
      setError('Falha ao salvar as configurações.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl flex flex-col max-h-[90vh]">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-zinc-800/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-white">
            <Bot size={22} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">Configurações de IA</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{accountName || tenantId}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded text-sm mb-4">
            {error}
          </div>
        )}

        {/* Global Toggle */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 flex items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-zinc-200">Ativação Global</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Ativa ou desativa completamente o processamento da IA para esta conexão Kommo.
            </p>
          </div>
          <button
            type="button"
            className={`w-12 h-6 rounded-full transition-colors relative shrink-0 focus:outline-none ${aiEnabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
            onClick={() => setAiEnabled(!aiEnabled)}
          >
            <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${aiEnabled ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        {/* Pipelines Loading Skeleton */}
        {loading ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-4 h-4 text-zinc-500 animate-spin" />
              <span className="text-sm text-zinc-400 font-medium">Buscando funis do CRM...</span>
            </div>
            {[1, 2].map(i => (
              <div key={i} className="animate-pulse bg-zinc-900/50 rounded-lg h-32 border border-zinc-800/50"></div>
            ))}
          </div>
        ) : (
          /* Pipelines List */
          <div className={`space-y-5 transition-opacity duration-300 ${!aiEnabled ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
            <h3 className="text-sm font-medium text-zinc-300 border-b border-zinc-800 pb-2 flex items-center gap-2">
              <LayoutTemplate size={16} className="text-zinc-500" />
              Etapas Permitidas para Atuação da IA
            </h3>
            
            {pipelines.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-6">Nenhum funil (pipeline) retornado pela Kommo.</p>
            ) : (
              pipelines.map(pipeline => {
                const isPipelineChecked = activePipelines.includes(pipeline.id);
                return (
                <div key={pipeline.id} className="bg-zinc-900/40 border border-zinc-800 rounded-md overflow-hidden">
                  <div className="bg-zinc-900/80 px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
                    <span className="font-medium text-sm text-zinc-200">{pipeline.name}</span>
                    <div className="flex items-center gap-2">
                       <span className="text-xs text-zinc-500">{isPipelineChecked ? 'Ativado' : 'Desativado'}</span>
                       <button
                         type="button"
                         className={`w-9 h-5 rounded-full transition-colors relative shrink-0 focus:outline-none ${isPipelineChecked ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                         onClick={() => togglePipeline(pipeline.id)}
                         title={isPipelineChecked ? "Desativar IA neste funil" : "Ativar IA neste funil"}
                       >
                         <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-transform ${isPipelineChecked ? 'left-[18px]' : 'left-1'}`} />
                       </button>
                    </div>
                  </div>
                  <div className={`p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 transition-opacity ${!isPipelineChecked ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
                    {pipeline.statuses.map(stage => {
                      const isChecked = activeStages.includes(stage.id);
                      return (
                        <div
                          key={stage.id}
                          className={`flex items-center gap-3 p-2.5 rounded cursor-pointer transition-colors border ${
                            isChecked
                              ? 'bg-emerald-500/5 border-emerald-500/30'
                              : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                          }`}
                          onClick={() => toggleStage(stage.id)}
                        >
                          <div
                            className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                              isChecked
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : 'bg-transparent border-zinc-600'
                            }`}
                          >
                            {isChecked && <Check size={12} strokeWidth={3} />}
                          </div>
                          
                          <div className="flex items-center gap-2 truncate">
                            <span 
                              className="w-3 h-3 rounded-full shrink-0" 
                              style={{ backgroundColor: stage.color || '#ccc' }} 
                            />
                            <span className="text-xs text-zinc-300 truncate font-medium">
                              {stage.name}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-5 border-t border-zinc-800/80 flex justify-end gap-3 bg-zinc-900/30">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-sm font-medium"
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={loading || saving}
          className={`flex items-center gap-2 px-5 py-2 rounded text-sm font-medium text-white transition-all ${
            loading || saving
              ? 'bg-emerald-600/50 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]'
          }`}
        >
          {saving ? (
             <><RefreshCw size={16} className="animate-spin" /> Salvando...</>
          ) : (
             <><Save size={16} /> Salvar Configurações</>
          )}
        </button>
      </div>
    </div>
  );
}
