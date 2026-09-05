/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { motion } from 'motion/react';
import { Volume2, ScanLine, WifiOff, ShieldCheck } from 'lucide-react';

interface HubProps {
  onSelectSound: () => void;
  onSelectQR: () => void;
  onSelectAirVault: () => void;
}

export function Hub({ onSelectSound, onSelectQR, onSelectAirVault }: HubProps) {
  return (
    <div className="w-full min-h-[100dvh] bg-[#020408] text-slate-200 flex flex-col items-center justify-center px-4 sm:px-6 py-16 relative overflow-hidden font-sans">
      <div className="fixed inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#3b82f6 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }}></div>
      <div className="fixed -top-40 -left-40 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="fixed -bottom-40 -right-40 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="relative z-10 text-center max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs sm:text-sm font-medium text-blue-400 mb-6"
        >
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline, device-to-device transfer</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-4xl sm:text-6xl font-black tracking-tighter text-white mb-4"
        >
          BEYOND<span className="text-blue-400">MESH</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-slate-400 text-base sm:text-lg mb-12"
        >
          Three ways to move data between nearby devices without a network — with optional
          end-to-end encryption and downloads you can send through any app. Pick a channel.
        </motion.p>
      </div>

      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-3 gap-5 w-full max-w-5xl">
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          onClick={onSelectSound}
          className="group text-left p-6 sm:p-8 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-blue-500/50 hover:bg-white/[0.05] transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center mb-5 shadow-lg shadow-blue-500/20">
            <Volume2 className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">SoundMesh</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Transmit short text messages as audible tones using speakers and microphones.
          </p>
          <span className="inline-block mt-5 text-xs font-mono uppercase tracking-widest text-blue-400 group-hover:translate-x-1 transition-transform">
            Open channel →
          </span>
        </motion.button>

        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          onClick={onSelectQR}
          className="group text-left p-6 sm:p-8 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-yellow-500/50 hover:bg-white/[0.05] transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-[#FFD500] flex items-center justify-center mb-5 shadow-lg shadow-yellow-500/10">
            <ScanLine className="w-6 h-6 text-[#2B2B2B]" strokeWidth={2.5} />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">QRMesh</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Send images and audio clips as a scrolling sequence of QR codes, scanned by camera.
          </p>
          <span className="inline-block mt-5 text-xs font-mono uppercase tracking-widest text-yellow-400 group-hover:translate-x-1 transition-transform">
            Open channel →
          </span>
        </motion.button>

        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          onClick={onSelectAirVault}
          className="group text-left p-6 sm:p-8 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-emerald-500/50 hover:bg-white/[0.05] transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center mb-5 shadow-lg shadow-emerald-500/20">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">AirVault</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Encode any file into a lossless PNG image — send it through any app, decode it back byte-for-byte.
          </p>
          <span className="inline-block mt-5 text-xs font-mono uppercase tracking-widest text-emerald-400 group-hover:translate-x-1 transition-transform">
            Open channel →
          </span>
        </motion.button>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 1 }}
        className="relative z-10 mt-16 text-[11px] sm:text-xs text-slate-600 tracking-wide"
      >
        Made with ❤️ by AiR
      </motion.p>
    </div>
  );
}
