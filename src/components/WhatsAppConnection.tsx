import { useState, useEffect } from 'react';
import axios from 'axios';
import { QrCode, CheckCircle2, Loader2, X, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface WhatsAppConnectionProps {
  tenantId?: string; // Made optional to easily use 'A5' generic
  onClose?: () => void;
}

const EVOLUTION_API_URL = 'https://evo.a5ecossistema.tech';
const EVOLUTION_API_KEY = 'qMP4DBS5bI0MzgDRBOFLCIr6TxDHUES3';

const evolutionApi = axios.create({
  baseURL: EVOLUTION_API_URL,
  headers: {
    'apikey': EVOLUTION_API_KEY,
    'Content-Type': 'application/json'
  }
});

export default function WhatsAppConnection({ tenantId, onClose }: WhatsAppConnectionProps) {
  const [status, setStatus] = useState<'INITIALIZING' | 'LOADING' | 'SCAN_QR' | 'CONNECTED' | 'ERROR'>('INITIALIZING');
  const [pairingCode, setPairingCode] = useState<string>('');
  const [qrCodeData, setQrCodeData] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);

  const instanceName = tenantId || 'A5';

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const startPolling = () => {
      const poll = async () => {
        try {
          const response = await evolutionApi.get(`/instance/connect/${instanceName}`);
          const data = response.data;
          
          const instanceState = data?.instance?.state || data?.state;
          const instanceStatus = data?.instance?.status || data?.status;

          // Check if it's already connected
          if (instanceState === 'open' || instanceStatus === 'connected' || instanceStatus === 'open') {
            setStatus('CONNECTED');
            if (intervalId) clearInterval(intervalId);
            return;
          }

          // Check if we have a QR Code string
          const qrCodeStr = data?.code || data?.base64 || data?.qrcode || data?.instance?.qr;
          
          if (qrCodeStr) {
            setStatus('SCAN_QR');
            setQrCodeData(qrCodeStr);
            if (data.pairingCode) {
              setPairingCode(data.pairingCode);
            }
          }
        } catch (error: any) {
          console.error('[Evolution] Error polling connection status:', error);
          // Only change to error if we weren't already scanning successfully
          // Network hiccups during polling shouldn't instantly break the UI
        }
      };

      // Poll immediately and then every 6s
      poll();
      intervalId = setInterval(poll, 6000);
    };

    const initializeInstance = async () => {
      setStatus('LOADING');
      try {
        await evolutionApi.post('/instance/create', {
          instanceName: instanceName,
          integration: "WHATSAPP-BAILEYS",
          alwaysOnline: true,
          readMessages: true,
          readStatus: false,
          rejectCall: false,
          groupsIgnore: true
        });
        
        // Successfully created, start polling
        startPolling();
      } catch (error: any) {
        // Handle variations of 'instance exists' in v2 (400, 403, or specific messages)
        const errorMsg = JSON.stringify(error.response?.data || '');
        if (
          error.response?.status === 400 || 
          error.response?.status === 403 || 
          errorMsg.toLowerCase().includes('already exist') ||
          errorMsg.toLowerCase().includes('já existe')
        ) {
          console.log('[Evolution] Instance already exists, proceeding to connect...', errorMsg);
          startPolling();
        } else {
          console.error('[Evolution] Failed to create instance:', error);
          setStatus('ERROR');
          setErrorMessage('Falha ao tentar criar a instância.');
        }
      }
    };

    const checkExistingAndInitialize = async () => {
      setStatus('LOADING');
      try {
        // Try connecting first. If it succeeds, it exists.
        await evolutionApi.get(`/instance/connect/${instanceName}`);
        startPolling();
      } catch (error: any) {
        // If it throws 404 (or other errors), we try to create it.
        initializeInstance();
      }
    };

    if (instanceName) {
      checkExistingAndInitialize();
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [instanceName, refreshKey]);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6 flex flex-col w-full max-w-sm mx-auto relative overflow-hidden">
      {onClose && (
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 transition-colors bg-zinc-800/50 hover:bg-zinc-800 rounded-full p-1"
        >
          <X className="w-5 h-5" />
        </button>
      )}
      
      <div className="text-center mb-8 mt-2">
        <h3 className="text-xl font-medium text-white mb-2 flex items-center justify-center gap-2">
          {status === 'CONNECTED' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          ) : (
            <QrCode className="w-5 h-5 text-zinc-400" />
          )}
          WhatsApp
        </h3>
        <p className="text-zinc-400 text-sm">
          {status === 'CONNECTED' 
            ? 'Sincronização ativa.' 
            : 'Escaneie o QR Code para conectar'}
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center min-h-[220px]">
        {(status === 'INITIALIZING' || status === 'LOADING') && (
          <div className="flex flex-col items-center justify-center space-y-4 text-zinc-400">
            <Loader2 className="w-10 h-10 animate-spin text-zinc-500" />
            <p className="text-sm">Iniciando contêiner seguro...</p>
          </div>
        )}

        {status === 'SCAN_QR' && qrCodeData && (
          <div className="flex flex-col items-center space-y-5 animate-in fade-in zoom-in duration-300">
            <div className="bg-white p-4 rounded-xl inline-block shadow-lg ring-1 ring-white/10">
              <QRCodeSVG value={qrCodeData} size={220} level="H" />
            </div>
            {pairingCode && (
              <p className="text-xs text-zinc-400 font-medium tracking-wider bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg">
                Código: <span className="text-zinc-200">{pairingCode}</span>
              </p>
            )}
            <button 
              onClick={() => setRefreshKey(prev => prev + 1)}
              className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors mt-2 px-3 py-2 rounded-lg hover:bg-zinc-800/50"
            >
              <RefreshCw className="w-4 h-4" />
              Atualizar QR Code
            </button>
          </div>
        )}

        {status === 'CONNECTED' && (
          <div className="flex flex-col items-center justify-center space-y-4 text-emerald-500 animate-in fade-in zoom-in duration-300">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center ring-4 ring-emerald-500/10 mb-2">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <p className="text-base font-semibold text-emerald-400 tracking-wide mt-2">
              WhatsApp Conectado com Sucesso!
            </p>
          </div>
        )}

        {status === 'ERROR' && (
          <div className="flex flex-col items-center justify-center space-y-4 text-zinc-400 text-center px-4">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
              <X className="w-8 h-8 text-red-500/80" />
            </div>
            <p className="text-sm text-red-400 font-medium">{errorMessage}</p>
            <button 
              onClick={() => setRefreshKey(prev => prev + 1)}
              className="mt-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium transition-colors"
            >
              Tentar Novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
