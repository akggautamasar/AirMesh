import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Mic, MicOff, AlertCircle, CheckCircle2, Lock, UploadCloud, Loader2, Link2 } from 'lucide-react';
import { motion } from 'motion/react';
import { startListening, stopListening, decodeAudioFile } from '../audio/ggwaveDecoder';
import { AudioWaveform } from '../components/AudioWaveform';
import { decryptText } from '../utils/crypto';
import { fetchShare, base64ToBytes, getShareParamsFromLocation, clearShareParamsFromLocation } from '../utils/share';

interface ReceivePageProps {
  onBack: () => void;
}

export function ReceivePage({ onBack }: ReceivePageProps) {
  const [isListening, setIsListening] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [rawPayload, setRawPayload] = useState('');
  const [finalMessage, setFinalMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'listening' | 'decoding' | 'success' | 'error'>('idle');
  const [audioData, setAudioData] = useState<Float32Array | undefined>();

  // Encrypted-message handling
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [encryptedPayload, setEncryptedPayload] = useState('');
  const [decryptError, setDecryptError] = useState('');

  // Throttle waveform updates to 30fps
  const lastUpdateTime = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDecodingFile, setIsDecodingFile] = useState(false);
  const [fileProgress, setFileProgress] = useState(0);

  const [linkInput, setLinkInput] = useState('');
  const [isLoadingLink, setIsLoadingLink] = useState(false);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  const saveHistory = (message: string | null, encrypted: boolean) => {
    const history = JSON.parse(localStorage.getItem('soundmesh_history') || '[]');
    history.push({ type: 'received', message, encrypted, timestamp: new Date().toISOString() });
    localStorage.setItem('soundmesh_history', JSON.stringify(history));
  };

  /** Shared by both the live mic path and the "upload audio file" path. */
  const handleDecodedString = (decodedString: string) => {
    // Parse protocol wrapper. Two shapes are supported:
    //   SM1|<flag P|E>|<id>|<payload>   (current)
    //   SM1|<id>|<payload>               (legacy plaintext-only)
    let flag = 'P';
    let payload = decodedString;

    if (decodedString.startsWith('SM1|')) {
      const parts = decodedString.split('|');
      if (parts.length >= 4 && (parts[1] === 'P' || parts[1] === 'E')) {
        flag = parts[1];
        payload = parts.slice(3).join('|');
      } else if (parts.length >= 3) {
        payload = parts.slice(2).join('|');
      }
    }

    setRawPayload(payload);

    if (flag === 'E') {
      setEncryptedPayload(payload);
      setNeedsPassword(true);
      setStatus('idle');
      return;
    }

    setFinalMessage(payload);
    setStatus('success');
    saveHistory(payload, false);
  };

  const handleStartListening = async () => {
    setErrorMsg('');
    setRawPayload('');
    setFinalMessage('');
    setNeedsPassword(false);
    setDecryptError('');
    setPassword('');
    setLinkError('');
    setStatus('listening');
    setIsListening(true);

    await startListening(
      () => {
        // on signal detected - not easily hooked in current GGwave wrapper without modifying C++ code,
        // but we get the payload once done.
      },
      (decodedString) => {
        setIsListening(false);
        stopListening();
        handleDecodedString(decodedString);
      },
      (data) => {
        const now = performance.now();
        if (now - lastUpdateTime.current > 33) { // ~30fps
          setAudioData(data);
          lastUpdateTime.current = now;
        }
      },
      (err) => {
        setIsListening(false);
        setStatus('error');
        setErrorMsg(err.message || 'Microphone access denied or error occurred.');
      }
    );
  };

  const handleUploadFile = async (file: File) => {
    setErrorMsg('');
    setRawPayload('');
    setFinalMessage('');
    setNeedsPassword(false);
    setDecryptError('');
    setPassword('');
    setIsDecodingFile(true);
    setFileProgress(0);
    setStatus('decoding');

    await decodeAudioFile(
      file,
      (decodedString) => {
        setIsDecodingFile(false);
        handleDecodedString(decodedString);
      },
      (err) => {
        setIsDecodingFile(false);
        setStatus('error');
        setErrorMsg(err.message || 'Could not find a SoundMesh signal in that file.');
      },
      (pct) => setFileProgress(pct)
    );
  };

  const handleLoadShareLink = async (idOrUrl: string) => {
    if (!idOrUrl.trim() || isLoadingLink) return;
    setLinkError('');
    setErrorMsg('');
    setIsLoadingLink(true);
    try {
      const shared = await fetchShare(idOrUrl);
      if (shared.module !== 'sound') {
        throw new Error('This link was created by a different BeyondMesh module.');
      }
      const bytes = base64ToBytes(shared.data);
      const packetString = new TextDecoder().decode(bytes);
      handleDecodedString(packetString);
    } catch (e: any) {
      console.error(e);
      setLinkError(e.message || 'Failed to load share link');
    } finally {
      setIsLoadingLink(false);
    }
  };

  // Auto-decode when opened via a share link (?share=...&m=sound).
  useEffect(() => {
    const shareParams = getShareParamsFromLocation();
    if (shareParams && (shareParams.module === 'sound' || shareParams.module === null)) {
      clearShareParamsFromLocation();
      void handleLoadShareLink(shareParams.share);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDecrypt = async () => {
    setDecryptError('');
    try {
      const plain = await decryptText(encryptedPayload, password);
      setFinalMessage(plain);
      setStatus('success');
      setNeedsPassword(false);
      saveHistory(plain, true);
    } catch (err: any) {
      setDecryptError(err.message || 'Wrong password or corrupted data');
    }
  };

  const handleStopListening = () => {
    stopListening();
    setIsListening(false);
    setStatus('idle');
  };

  const handleBack = () => {
    stopListening();
    onBack();
  };

  return (
    <div className="flex flex-col flex-1 h-[100dvh] relative overflow-hidden">
      <header className="flex items-center justify-between px-4 sm:px-6 py-4 sm:py-6 border-b border-white/5 bg-black/40 backdrop-blur-xl sticky top-0 z-20 w-full">
        <button onClick={handleBack} className="p-2 -ml-2 text-gray-400 hover:text-white transition-colors bg-white/5 rounded-full hover:bg-white/10">
          <ArrowLeft size={20} />
        </button>
        <div className="font-bold tracking-widest uppercase text-[11px] sm:text-sm text-gray-300">Receive Data</div>
        <div className="w-9"></div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-8 pb-32 w-full max-w-2xl mx-auto flex flex-col items-center justify-center min-h-0">

        <div className="w-full flex flex-col items-center justify-center space-y-6 sm:space-y-8 h-full">

          {status !== 'success' && !needsPassword && (
            <div className="flex flex-col items-center justify-center space-y-6 flex-1 w-full">
              <div className="relative">
                {isListening && (
                  <>
                    <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl animate-pulse"></div>
                    <div className="absolute inset-0 bg-blue-500/10 rounded-full scale-150 animate-ping" style={{ animationDuration: '3s' }}></div>
                  </>
                )}
                <div className={`w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center transition-all duration-500 relative z-10 ${isListening ? 'bg-blue-600 shadow-[0_0_50px_rgba(59,130,246,0.6)]' : 'bg-white/5 border border-white/10'}`}>
                  <Mic size={48} className={isListening ? 'text-white' : 'text-gray-500'} />
                </div>
              </div>

              <div className="text-center space-y-2">
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                  {status === 'idle' && 'Ready to receive'}
                  {status === 'listening' && 'Listening...'}
                  {status === 'decoding' && 'Reading file...'}
                  {status === 'error' && 'Error'}
                </h2>
                <p className="text-sm text-gray-400 max-w-[250px] mx-auto leading-relaxed">
                  {status === 'listening'
                    ? 'Keep devices close together and ensure volume is up.'
                    : status === 'decoding'
                    ? 'Scanning the audio file for a SoundMesh signal.'
                    : 'Use microphone, or upload an audio file, to capture SoundMesh data.'}
                </p>
              </div>

              {status === 'error' && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start space-x-3 text-red-400 backdrop-blur-sm mt-4 w-full">
                  <AlertCircle size={20} className="shrink-0 mt-0.5" />
                  <span className="text-sm">{errorMsg}</span>
                </div>
              )}

              <div className="w-full mt-8 bg-white/5 border border-white/10 rounded-3xl p-4 backdrop-blur-xl">
                <AudioWaveform isListening={isListening} audioData={audioData} />
              </div>

              {!isListening && status !== 'decoding' && (
                <div className="w-full flex flex-col items-center">
                  <div className="flex items-center gap-3 w-full my-1">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-[10px] uppercase tracking-widest text-gray-600">or</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-gray-300 font-bold text-xs tracking-widest uppercase hover:bg-white/10 hover:text-white transition-all flex items-center justify-center gap-2"
                  >
                    <UploadCloud size={18} />
                    Upload Audio File
                  </button>
                  <p className="text-[10px] text-gray-600 mt-2 text-center max-w-[280px]">
                    Decode a SoundMesh WAV you already have, instead of playing it out loud.
                  </p>

                  <div className="flex items-center gap-3 w-full my-4">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-[10px] uppercase tracking-widest text-gray-600">or</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                  <div className="w-full flex gap-2">
                    <input
                      type="text"
                      value={linkInput}
                      onChange={(e) => setLinkInput(e.target.value)}
                      placeholder="Paste a BeyondMesh share link"
                      className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-2xl px-4 py-3 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => handleLoadShareLink(linkInput)}
                      disabled={isLoadingLink || !linkInput.trim()}
                      className="px-4 rounded-2xl bg-blue-600 text-white font-bold text-xs uppercase tracking-widest hover:bg-blue-500 transition-all disabled:opacity-50 flex items-center justify-center shrink-0"
                    >
                      {isLoadingLink ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                    </button>
                  </div>
                  {linkError && (
                    <div className="w-full mt-2 flex items-start gap-2 text-red-400 text-[10px] font-bold">
                      <AlertCircle size={12} className="shrink-0 mt-0.5" /> {linkError}
                    </div>
                  )}
                </div>
              )}

              {status === 'decoding' && (
                <div className="w-full bg-white/5 border border-white/10 rounded-3xl p-6 text-center backdrop-blur-md">
                  <Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-3" />
                  <div className="text-sm text-gray-300 font-medium">Scanning file... {fileProgress}%</div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mt-3">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${fileProgress}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {needsPassword && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full bg-blue-900/20 border border-blue-500/30 rounded-3xl p-6 sm:p-8 space-y-5 backdrop-blur-xl">
              <div className="flex flex-col items-center text-blue-300 space-y-3">
                <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center">
                  <Lock size={28} />
                </div>
                <span className="text-xs sm:text-sm font-bold uppercase tracking-widest text-center">Password Protected Message</span>
              </div>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password to decode"
                className="w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/50"
              />
              {decryptError && (
                <div className="text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle size={14} /> {decryptError}
                </div>
              )}
              <button
                onClick={handleDecrypt}
                disabled={!password}
                className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-sm tracking-widest uppercase hover:bg-blue-500 transition-all disabled:opacity-50"
              >
                Decrypt Message
              </button>
            </motion.div>
          )}

          {status === 'success' && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full bg-blue-900/20 border border-blue-500/30 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-xl">
              <div className="flex flex-col items-center justify-center text-green-400 pb-6 border-b border-white/5 space-y-3">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center">
                  <CheckCircle2 size={32} className="text-green-400" />
                </div>
                <span className="text-xs sm:text-sm font-bold uppercase tracking-widest text-center">Decoded Successfully</span>
              </div>

              <div className="py-2 text-center">
                <div className="text-[10px] sm:text-xs text-gray-500 font-bold tracking-widest uppercase mb-4">Message Content</div>
                <div className="text-2xl sm:text-3xl font-medium leading-tight text-white">{finalMessage}</div>
              </div>

              <div className="pt-6 border-t border-white/5">
                <div className="text-[10px] text-gray-600 font-bold tracking-widest uppercase mb-2">Raw Payload Signature</div>
                <div className="font-mono text-[10px] sm:text-xs text-blue-400/60 break-all bg-black/40 p-3 rounded-xl border border-white/5">{rawPayload}</div>
              </div>
            </motion.div>
          )}

        </div>
      </main>

      {/* Fixed Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-t from-[#020408] via-[#020408]/90 to-transparent z-20">
        <div className="max-w-2xl mx-auto w-full">
          {isListening ? (
            <button
              onClick={handleStopListening}
              className="w-full py-5 rounded-3xl bg-white/10 text-white font-bold text-[15px] sm:text-sm tracking-widest uppercase border border-white/20 transition-all hover:bg-white/20 active:scale-[0.98] flex items-center justify-center space-x-3 backdrop-blur-md"
            >
              <MicOff size={22} />
              <span>Stop Listening</span>
            </button>
          ) : status === 'success' ? (
            <button
              onClick={handleStartListening}
              className="w-full py-5 rounded-3xl bg-blue-600 text-white font-bold text-[15px] sm:text-sm tracking-widest uppercase shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-500 active:scale-[0.98] flex items-center justify-center space-x-3"
            >
              <Mic size={22} />
              <span>Listen Again</span>
            </button>
          ) : !needsPassword ? (
            <button
              onClick={handleStartListening}
              className="w-full py-5 rounded-3xl bg-blue-600 text-white font-bold text-[15px] sm:text-sm tracking-widest uppercase shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-500 active:scale-[0.98] flex items-center justify-center space-x-3"
            >
              <Mic size={22} />
              <span>Start Listening</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
