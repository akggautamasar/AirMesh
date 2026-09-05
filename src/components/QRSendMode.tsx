import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import { compressAndChunkFile, compressAndChunkFileLossless, compressAndChunkText } from '../utils/dataUtils';
import { encodeGIF } from '../utils/gif';
import { downloadBlob, downloadDataUrl } from '../utils/download';
import { uploadShare, bytesToBase64 } from '../utils/share';
import { UploadCloud, X, RotateCcw, Zap, Lock, Type, FileUp, Download, Loader2, ShieldCheck, Link2, Copy, Check, AlertCircle } from 'lucide-react';
import { cn } from '../utils/cn';

type InputMode = 'file' | 'text';

// QR rendering — shared by live preview, per-frame download, zip export, and GIF export
// so every path produces byte-identical images.
const QR_OPTS = {
  errorCorrectionLevel: 'M' as const,
  margin: 1,
  width: 400,
  color: { dark: '#2B2B2B', light: '#FFFFFF' },
};

export default function SendMode() {
  const [inputMode, setInputMode] = useState<InputMode>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [password, setPassword] = useState('');
  const [useEncryption, setUseEncryption] = useState(false);
  const [lossless, setLossless] = useState(true);

  const [chunks, setChunks] = useState<string[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isZipping, setIsZipping] = useState(false);
  const [isGifing, setIsGifing] = useState(false);

  // Share-link state — uploads the full chunk sequence so it can be decoded
  // remotely via a link instead of scanning QR frames.
  const [shareStatus, setShareStatus] = useState<'idle' | 'uploading' | 'ready' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const [shareError, setShareError] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  const [prepProgress, setPrepProgress] = useState(0);
  const [prepStatus, setPrepStatus] = useState('');
  const [fps, setFps] = useState(3); // Slower default for reliability

  const frameRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);

  const startPrep = () => {
    setPrepProgress(0);
    setPrepStatus('Initializing...');
    setChunks([]);
    setCurrentChunkIndex(0);
    setIsTransmitting(false);

    const pw = useEncryption && password ? password : undefined;
    const onProgress = (p: number, s: string) => {
      setPrepProgress(p);
      setPrepStatus(s);
    };

    const promise = inputMode === 'file' && file
      ? (lossless ? compressAndChunkFileLossless(file, pw, onProgress) : compressAndChunkFile(file, pw, onProgress))
      : compressAndChunkText(text.trim(), pw, onProgress);

    promise.then((c) => {
      setChunks(c);
      setCurrentChunkIndex(0);
      setIsTransmitting(false);
    });
  };

  useEffect(() => {
    if (file) startPrep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    if (!isTransmitting || chunks.length === 0) return;

    const intervalMs = 1000 / fps;

    const updateLoop = (timestamp: number) => {
      if (timestamp - lastUpdateRef.current > intervalMs) {
        setCurrentChunkIndex((prev) => (prev + 1) % chunks.length);
        lastUpdateRef.current = timestamp;
      }
      frameRef.current = requestAnimationFrame(updateLoop);
    };

    frameRef.current = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(frameRef.current);
  }, [isTransmitting, chunks.length, fps]);

  useEffect(() => {
    if (chunks.length > 0) {
      QRCode.toDataURL(chunks[currentChunkIndex], QR_OPTS).then(url => setQrDataUrl(url));
    }
  }, [currentChunkIndex, chunks]);

  const handleDownloadCurrentFrame = () => {
    if (!qrDataUrl) return;
    downloadDataUrl(qrDataUrl, `beyondmesh-qr-${currentChunkIndex + 1}of${chunks.length}.png`);
  };

  const handleDownloadAllFrames = async () => {
    if (chunks.length === 0 || isZipping) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < chunks.length; i++) {
        const url = await QRCode.toDataURL(chunks[i], QR_OPTS);
        const base64 = url.split(',')[1];
        zip.file(`frame-${String(i + 1).padStart(3, '0')}.png`, base64, { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, 'beyondmesh-qr-frames.zip');
    } finally {
      setIsZipping(false);
    }
  };

  const handleDownloadGif = async () => {
    if (chunks.length === 0 || isGifing) return;
    setIsGifing(true);
    try {
      const canvas = document.createElement('canvas');
      const frames = [];
      for (let i = 0; i < chunks.length; i++) {
        await QRCode.toCanvas(canvas, chunks[i], QR_OPTS);
        const ctx = canvas.getContext('2d')!;
        frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      }
      const delayMs = Math.max(80, Math.round(1000 / fps));
      const blob = encodeGIF(frames, delayMs);
      downloadBlob(blob, 'beyondmesh-qr-frames.gif');
    } finally {
      setIsGifing(false);
    }
  };

  const resetAll = () => {
    setFile(null);
    setText('');
    setChunks([]);
    setIsTransmitting(false);
    setShareStatus('idle');
    setShareUrl('');
    setShareError('');
    setLinkCopied(false);
  };

  const handleCreateShareLink = async () => {
    if (chunks.length === 0 || shareStatus === 'uploading') return;
    setShareStatus('uploading');
    setShareError('');
    try {
      // The whole QR sequence (all chunk strings, in order) is what a
      // receiver needs to reconstruct the payload — same data that would
      // otherwise be gathered by scanning every frame.
      const payload = JSON.stringify(chunks);
      const dataBase64 = bytesToBase64(new TextEncoder().encode(payload));
      const baseName = inputMode === 'file' && file ? file.name : 'qrmesh-message';
      const result = await uploadShare('qr', `${baseName}.qrmesh.json`, 'application/json', dataBase64);
      setShareUrl(result.url);
      setShareStatus('ready');
    } catch (e: any) {
      setShareError(e.message || 'Failed to create share link');
      setShareStatus('error');
    }
  };

  const handleCopyShareLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col items-center justify-start w-full max-w-2xl mx-auto py-4">

      {/* Mode toggle: File vs Text */}
      {!file && chunks.length === 0 && (
        <div className="flex gap-3 mb-6">
          <button
            onClick={() => setInputMode('file')}
            className={cn(
              "px-6 py-2.5 rounded-xl font-bold uppercase tracking-wide text-sm border-4 flex items-center gap-2 transition-all",
              inputMode === 'file'
                ? "bg-[#0057A6] border-[#003B73] text-white"
                : "bg-[var(--lego-card)] border-[var(--lego-border)] text-[var(--lego-text)]"
            )}
          >
            <FileUp className="w-4 h-4" strokeWidth={2.5} /> File
          </button>
          <button
            onClick={() => setInputMode('text')}
            className={cn(
              "px-6 py-2.5 rounded-xl font-bold uppercase tracking-wide text-sm border-4 flex items-center gap-2 transition-all",
              inputMode === 'text'
                ? "bg-[#0057A6] border-[#003B73] text-white"
                : "bg-[var(--lego-card)] border-[var(--lego-border)] text-[var(--lego-text)]"
            )}
          >
            <Type className="w-4 h-4" strokeWidth={2.5} /> Text
          </button>
        </div>
      )}

      {/* Lossless toggle — only matters for File mode */}
      {inputMode === 'file' && chunks.length === 0 && (
        <div className="w-full max-w-md mb-4 bg-[var(--lego-card)] border-4 border-[var(--lego-border)] rounded-xl p-4 shadow-[4px_4px_0px_var(--lego-border)] transition-colors duration-300">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="font-black text-[var(--lego-text)] flex items-center gap-2 uppercase text-sm">
              <ShieldCheck className="w-4 h-4" strokeWidth={2.5} />
              Lossless
            </span>
            <input
              type="checkbox"
              checked={lossless}
              onChange={(e) => setLossless(e.target.checked)}
              className="w-5 h-5 accent-[#00A650]"
            />
          </label>
          <p className="text-[10px] font-bold text-[var(--lego-muted)] mt-2 uppercase tracking-wide">
            {lossless
              ? 'Exact original bytes — best for SoundMesh WAVs and full-quality photos. More frames for large files.'
              : 'Fast mode — downsizes images/audio for a short scan sequence, with some quality loss.'}
          </p>
        </div>
      )}

      {/* Optional encryption controls, shown before transmission starts */}
      {chunks.length === 0 && (
        <div className="w-full max-w-md mb-6 bg-[var(--lego-card)] border-4 border-[var(--lego-border)] rounded-xl p-4 shadow-[4px_4px_0px_var(--lego-border)] transition-colors duration-300">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="font-black text-[var(--lego-text)] flex items-center gap-2 uppercase text-sm">
              <Lock className="w-4 h-4" strokeWidth={2.5} />
              Encrypt (optional)
            </span>
            <input
              type="checkbox"
              checked={useEncryption}
              onChange={(e) => setUseEncryption(e.target.checked)}
              className="w-5 h-5 accent-[#D01012]"
            />
          </label>
          {useEncryption && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password anyone scanning it will need"
              className="mt-3 w-full bg-[var(--lego-bg)] border-2 border-[var(--lego-border)] rounded-lg px-3 py-2 text-sm font-medium text-[var(--lego-text)] outline-none"
            />
          )}
          <p className="text-[10px] font-bold text-[var(--lego-muted)] mt-2 uppercase tracking-wide">
            Anyone can scan it — only someone with the password can read it.
          </p>
        </div>
      )}

      {inputMode === 'text' && !file && chunks.length === 0 && (
        <div className="w-full max-w-md">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type the message to beam across as QR codes..."
            className="w-full min-h-[140px] bg-[var(--lego-card)] border-4 border-[var(--lego-border)] rounded-2xl p-4 text-[var(--lego-text)] font-medium outline-none resize-none shadow-[4px_4px_0px_var(--lego-border)]"
          />
          <button
            onClick={() => text.trim() && startPrep()}
            disabled={!text.trim()}
            className="mt-4 w-full px-8 py-3 rounded-xl bg-[#00A650] border-4 border-[#007036] text-white font-black uppercase tracking-wide shadow-[4px_4px_0px_#007036] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all disabled:opacity-50"
          >
            Generate QR Sequence
          </button>
        </div>
      )}

      {inputMode === 'file' && !file ? (
        <div
          className="w-full max-w-md aspect-square bg-[var(--lego-card)] rounded-2xl border-4 border-[var(--lego-border)] shadow-[8px_8px_0px_var(--lego-border)] flex flex-col items-center justify-center p-8 text-center cursor-pointer hover:-translate-y-1 hover:shadow-[10px_10px_0px_var(--lego-border)] active:translate-y-2 active:shadow-none transition-all group"
          onClick={() => document.getElementById('file-upload')?.click()}
        >
          <input
            id="file-upload"
            type="file"
            accept={lossless ? undefined : 'image/*, audio/*'}
            className="hidden"
            onChange={(e) => {
              const selectedFile = e.target.files?.[0];
              if (selectedFile) {
                if (!lossless && selectedFile.type.startsWith('audio') && selectedFile.size > 1024 * 1024 * 5) {
                  alert("Audio file too large for Fast mode. Please keep it under 5MB, or switch to Lossless mode.");
                  return;
                }
                setFile(selectedFile);
              }
            }}
          />
          <div className="bg-[#FFD500] p-6 rounded-full border-4 border-[var(--lego-border)] shadow-[4px_4px_0px_var(--lego-border)] mb-6 group-hover:rotate-12 transition-transform duration-300">
            <UploadCloud className="w-10 h-10 text-[#2B2B2B]" strokeWidth={2.5} />
          </div>
          <h3 className="text-2xl font-black text-[var(--lego-text)] mb-2 uppercase">Select File</h3>
          <p className="font-medium text-[var(--lego-muted)]">
            {lossless ? 'Any file — photo, audio, doc, anything.' : 'Pick a photo or short audio to beam across.'}
          </p>
        </div>
      ) : (chunks.length > 0 || file) ? (
        <div className="flex flex-col items-center w-full max-w-md">
          {/* LEGO Style Display Card */}
          <div className="relative w-full bg-[var(--lego-card)] rounded-2xl border-4 border-[var(--lego-border)] shadow-[8px_8px_0px_var(--lego-border)] p-4 flex flex-col items-center overflow-visible transition-colors duration-300">
            {/* Stud Decoration Header */}
            <div className="absolute -top-3 left-4 right-4 flex justify-around">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="w-6 h-4 bg-[var(--lego-card)] border-4 border-[var(--lego-border)] border-b-0 rounded-t-md transition-colors duration-300" />
              ))}
            </div>

            <div className="relative mt-4 bg-[var(--lego-bg)] rounded-xl border-4 border-[var(--lego-border)] flex items-center justify-center min-h-[320px] min-w-[320px] w-full aspect-square overflow-hidden shadow-inner transition-colors duration-300">
              {chunks.length > 0 ? (
                <img
                  src={qrDataUrl}
                  alt="QR Data"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full max-w-[240px] flex flex-col items-center text-[var(--lego-text)]">
                  <div className="w-12 h-12 border-8 border-slate-200 border-t-[#D01012] rounded-full animate-spin mb-6"></div>
                  <div className="font-black uppercase tracking-wide mb-3">{prepStatus}</div>
                  <div className="w-full h-4 bg-slate-200 rounded-full overflow-hidden border-2 border-[var(--lego-border)] shadow-inner">
                    <div
                      className="h-full bg-[#00A650] transition-all duration-300 ease-out"
                      style={{ width: `${prepProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Status indicator */}
            {chunks.length > 0 && (
              <div className="mt-4 w-full flex items-center justify-between bg-[var(--lego-bg)] border-2 border-[var(--lego-border)] p-2 rounded-lg transition-colors duration-300">
                <div className="flex items-center gap-2 font-bold text-[var(--lego-text)] px-2">
                  <span className={cn("w-3 h-3 rounded-full border-2 border-[var(--lego-border)]", isTransmitting ? "bg-[#D01012] animate-pulse" : "bg-slate-400")} />
                  {isTransmitting ? 'LIVE' : 'READY'}
                  {useEncryption && password && <Lock className="w-3 h-3 ml-1 text-[#D01012]" strokeWidth={3} />}
                </div>
                <div className="font-black text-xl text-[#0057A6]">
                  {currentChunkIndex + 1} / {chunks.length}
                </div>
              </div>
            )}
          </div>

          {/* Speed Controls */}
          {chunks.length > 0 && (
             <div className="w-full mt-8 bg-[var(--lego-card)] border-4 border-[var(--lego-border)] rounded-xl p-4 shadow-[4px_4px_0px_var(--lego-border)] transition-colors duration-300">
                <div className="flex justify-between items-center mb-2">
                  <label className="font-black text-[var(--lego-text)] flex items-center gap-2 uppercase">
                     <Zap className="w-5 h-5 text-[#FFD500]" fill="#FFD500" strokeWidth={2} />
                     Speed
                  </label>
                  <span className="font-black text-[#0057A6]">{fps} FPS</span>
                </div>
                <input
                  type="range"
                  min="1" max="10" step="1"
                  value={fps}
                  onChange={(e) => setFps(parseInt(e.target.value))}
                  className="w-full h-3 bg-slate-200 rounded-full appearance-none cursor-pointer outline-none border-2 border-[var(--lego-border)] accent-[#D01012]"
                />
                <p className="text-xs font-bold text-[var(--lego-muted)] mt-2 text-center uppercase">
                  Slower = Better Camera Reliability
                </p>
             </div>
          )}

          <div className="mt-8 flex flex-wrap justify-center gap-4 w-full">
            <button
              onClick={() => {
                if (!isTransmitting && currentChunkIndex !== 0) {
                  setCurrentChunkIndex(0);
                }
                setIsTransmitting(!isTransmitting);
              }}
              disabled={chunks.length === 0}
              className={cn(
                "px-8 py-3 rounded-xl text-lg font-bold transition-all border-4 flex items-center gap-2 uppercase tracking-wide flex-1 justify-center min-w-[200px]",
                isTransmitting
                  ? "bg-[#D01012] border-[#8C0000] text-white shadow-none translate-y-1"
                  : "bg-[#00A650] border-[#007036] text-white shadow-[4px_4px_0px_#007036] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isTransmitting ? 'Stop' : 'Play'}
            </button>

            {chunks.length > 0 && (
              <button
                onClick={() => {
                  setCurrentChunkIndex(0);
                  setIsTransmitting(true);
                }}
                className="p-3 rounded-xl bg-[#FFD500] border-4 border-[#B29500] text-[#2B2B2B] shadow-[4px_4px_0px_#B29500] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all flex items-center justify-center"
                title="Restart Loop"
              >
                <RotateCcw className="w-6 h-6" strokeWidth={2.5} />
              </button>
            )}

            <button
              onClick={resetAll}
              className="p-3 rounded-xl bg-[var(--lego-card)] border-4 border-[var(--lego-border)] text-[var(--lego-text)] shadow-[4px_4px_0px_var(--lego-border)] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all flex items-center justify-center"
              title="Clear"
            >
              <X className="w-6 h-6" strokeWidth={3} />
            </button>
          </div>

          {/* Download options — so the QR (or the whole sequence) can be sent through
              WhatsApp / Telegram / email instead of only being scanned live. */}
          {chunks.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-3 w-full">
              <button
                onClick={handleDownloadCurrentFrame}
                className="px-5 py-2.5 rounded-xl bg-[var(--lego-card)] border-4 border-[var(--lego-border)] text-[var(--lego-text)] font-bold uppercase text-xs tracking-wide shadow-[3px_3px_0px_var(--lego-border)] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all flex items-center gap-2"
              >
                <Download className="w-4 h-4" strokeWidth={2.5} /> Download This Frame
              </button>
              {chunks.length > 1 && (
                <>
                  <button
                    onClick={handleDownloadAllFrames}
                    disabled={isZipping}
                    className="px-5 py-2.5 rounded-xl bg-[var(--lego-card)] border-4 border-[var(--lego-border)] text-[var(--lego-text)] font-bold uppercase text-xs tracking-wide shadow-[3px_3px_0px_var(--lego-border)] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all flex items-center gap-2 disabled:opacity-60"
                  >
                    {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" strokeWidth={2.5} />}
                    {isZipping ? 'Zipping...' : `All ${chunks.length} Frames (.zip)`}
                  </button>
                  <button
                    onClick={handleDownloadGif}
                    disabled={isGifing}
                    className="px-5 py-2.5 rounded-xl bg-[var(--lego-card)] border-4 border-[var(--lego-border)] text-[var(--lego-text)] font-bold uppercase text-xs tracking-wide shadow-[3px_3px_0px_var(--lego-border)] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all flex items-center gap-2 disabled:opacity-60"
                  >
                    {isGifing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" strokeWidth={2.5} />}
                    {isGifing ? 'Building GIF...' : 'As Animated GIF'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Share via link — uploads the sequence so it can be decoded remotely,
              instead of only being scanned live or sent as image/zip files. */}
          {chunks.length > 0 && (
            <div className="mt-4 w-full max-w-md bg-[var(--lego-card)] border-4 border-[var(--lego-border)] rounded-xl p-4 shadow-[4px_4px_0px_var(--lego-border)] transition-colors duration-300">
              <div className="font-black text-[var(--lego-text)] flex items-center gap-2 uppercase text-sm mb-3">
                <Link2 className="w-4 h-4" strokeWidth={2.5} />
                Share via Link
              </div>
              {shareStatus === 'ready' && shareUrl ? (
                <div className="flex flex-col gap-2">
                  <div className="w-full bg-[var(--lego-bg)] border-2 border-[var(--lego-border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--lego-text)] break-all">
                    {shareUrl}
                  </div>
                  <button
                    onClick={handleCopyShareLink}
                    className="w-full px-4 py-2.5 rounded-lg bg-[#00A650] border-2 border-[#007036] text-white font-black uppercase text-xs tracking-wide flex items-center justify-center gap-2 hover:-translate-y-0.5 active:translate-y-0.5 transition-all"
                  >
                    {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {linkCopied ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleCreateShareLink}
                  disabled={shareStatus === 'uploading'}
                  className="w-full px-4 py-2.5 rounded-lg bg-[#0057A6] border-2 border-[#003B73] text-white font-black uppercase text-xs tracking-wide flex items-center justify-center gap-2 hover:-translate-y-0.5 active:translate-y-0.5 transition-all disabled:opacity-60"
                >
                  {shareStatus === 'uploading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  {shareStatus === 'uploading' ? 'Uploading...' : 'Generate Share Link'}
                </button>
              )}
              {shareStatus === 'error' && shareError && (
                <div className="mt-2 flex items-start gap-2 text-[#D01012] text-xs font-bold">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {shareError}
                </div>
              )}
              <p className="text-[10px] font-bold text-[var(--lego-muted)] mt-2 uppercase tracking-wide">
                Send this link through any app — the receiver pastes it into QRMesh's Scan tab to decode, no camera needed.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
