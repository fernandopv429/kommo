import { useState, useEffect } from 'react';
import axios from 'axios';
import { QrCode, CheckCircle2, Loader2, X } from 'lucide-react';

interface WhatsAppConnectionProps {
  tenantId: string;
  onClose?: () => void;
}

export default function WhatsAppConnection({ tenantId, onClose }: WhatsAppConnectionProps) {
  const [status, setStatus] = useState<'LOADING' | 'SCAN_QR' | 'CONNECTED' | 'ERROR'>('LOADING');
  const [qrCode, setQrCode] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (!tenantId) return;

    let intervalId: NodeJS.Timeout;

    const checkStatus = async () => {
      try {
        const response = await axios.get(`/api/tenants/${tenantId}/qrcode`);
        const data = response.data;

        if (data.status === 'CONNECTED') {
          setStatus('CONNECTED');
          if (intervalId) clearInterval(intervalId);
        } else if (data.status === 'SCAN_QR') {
          setStatus('SCAN_QR');
          setQrCode(data.qrcode);
        } else if (data.status === 'PENDING') {
          setStatus('LOADING');
        }
      } catch (error) {
        console.error('Failed to get QR code', error);
        setStatus('ERROR');
        setErrorMessage('A aguardar criação da instância. Tentando novamente...');
      }
    };

    // Check immediately
    checkStatus();

    // Set up polling every 5 seconds
    intervalId = setInterval(checkStatus, 5000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [tenantId]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6 flex flex-col w-full max-w-sm mx-auto relative overflow-hidden">
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
            <QrCode className="w-5 h-5 text-blue-500" />
          )}
          WhatsApp Evolution
        </h3>
        <p className="text-zinc-400 text-sm">
          {status === 'CONNECTED' 
            ? 'Instância conectada e ativa.' 
            : `Conectando tenant: ${tenantId}`}
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center min-h-[220px]">
        {status === 'LOADING' && (
          <div className="flex flex-col items-center justify-center space-y-4 text-zinc-400">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            <p className="text-sm">Gerando QR Code...</p>
          </div>
        )}

        {status === 'SCAN_QR' && qrCode && (
          <div className="flex flex-col items-center space-y-5">
            <div className="bg-white p-3 rounded-xl shadow-lg ring-4 ring-zinc-800/50">
              <img 
                src={qrCode.startsWith('data:image') ? qrCode : `data:image/png;base64,${qrCode}`} 
                alt="WhatsApp QR Code" 
                className="w-48 h-auto"
              />
            </div>
            <p className="text-xs text-zinc-500 font-medium tracking-wide pb-2">
              ESCANEIE O QR CODE COM O SEU WHATSAPP
            </p>
          </div>
        )}

        {status === 'CONNECTED' && (
          <div className="flex flex-col items-center justify-center space-y-4 text-emerald-500">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center ring-4 ring-emerald-500/10">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <p className="text-base font-semibold text-emerald-400 tracking-wide mt-2">
              Conectado com Sucesso
            </p>
          </div>
        )}

        {status === 'ERROR' && (
          <div className="flex flex-col items-center justify-center space-y-4 text-zinc-400 text-center px-4">
            <div className="w-16 h-16 bg-zinc-800/50 rounded-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin opacity-50" />
            </div>
            <p className="text-sm text-zinc-500">{errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}
