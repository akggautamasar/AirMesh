import { useState } from 'react';
import { ArrowLeft, Send, Download as DownloadIcon, ShieldCheck } from 'lucide-react';
import AirVaultSendMode from '../components/AirVaultSendMode';
import AirVaultReceiveMode from '../components/AirVaultReceiveMode';
import { AppMode } from '../types';
import { getShareParamsFromLocation } from '../utils/share';

interface AirVaultAppProps {
  onExit: () => void;
}

export function AirVaultApp({ onExit }: AirVaultAppProps) {
  const [mode, setMode] = useState<AppMode>(() =>
    getShareParamsFromLocation()?.module === 'vault' ? 'receive' : 'send'
  );

  return (
    <div className="w-full min-h-[100dvh] bg-[#020408] text-slate-200 flex flex-col font-sans overflow-x-hidden relative">
      <div className="fixed inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#10b981 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }}></div>
      <div className="fixed -top-40 -left-40 w-96 h-96 bg-emerald-600/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="fixed -bottom-40 -right-40 w-96 h-96 bg-emerald-400/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="relative z-10 flex flex-col flex-1">
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 sm:py-6 border-b border-white/5 bg-black/40 backdrop-blur-xl sticky top-0 z-20 w-full">
          <button onClick={onExit} className="p-2 -ml-2 text-gray-400 hover:text-white transition-colors bg-white/5 rounded-full hover:bg-white/10">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2 font-bold tracking-widest uppercase text-[11px] sm:text-sm text-gray-300">
            <ShieldCheck size={16} className="text-emerald-400" />
            AirVault
          </div>
          <div className="w-9"></div>
        </header>

        <div className="flex justify-center pt-6">
          <p className="text-slate-400 text-xs sm:text-sm max-w-md text-center px-4">
            Encode any file into a lossless PNG image — send it through any app, decode it back byte-for-byte.
          </p>
        </div>

        <div className="flex justify-center mt-6 gap-4">
          <button
            onClick={() => setMode('send')}
            className={`px-6 py-2.5 rounded-xl font-bold uppercase tracking-wide text-sm flex items-center gap-2 transition-all ${
              mode === 'send' ? 'bg-emerald-600 text-white' : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
            }`}
          >
            <Send className="w-4 h-4" /> Encode
          </button>
          <button
            onClick={() => setMode('receive')}
            className={`px-6 py-2.5 rounded-xl font-bold uppercase tracking-wide text-sm flex items-center gap-2 transition-all ${
              mode === 'receive' ? 'bg-emerald-600 text-white' : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
            }`}
          >
            <DownloadIcon className="w-4 h-4" /> Decode
          </button>
        </div>

        <main className="flex-1 flex flex-col items-center justify-start p-4 md:p-8">
          {mode === 'send' ? <AirVaultSendMode /> : <AirVaultReceiveMode />}
        </main>

        <footer className="py-6 text-center text-xs font-bold text-slate-600 uppercase tracking-widest space-y-1">
          <p>No internet • No servers • Pixel-perfect</p>
        </footer>
      </div>
    </div>
  );
}
