import { useState, useRef } from 'react';
import JSZip from 'jszip';
import { UploadCloud, Lock, Download, Loader2, CheckCircle2, Image as ImageIcon, X, AlertCircle, Link2, Copy, Check } from 'lucide-react';
import { encodeToImages, AirVaultPart } from '../utils/airvault';
import { downloadBlob } from '../utils/download';
import { uploadShare, bytesToBase64 } from '../utils/share';

export default function AirVaultSendMode() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [useEncryption, setUseEncryption] = useState(false);
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [parts, setParts] = useState<AirVaultPart[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const [shareStatus, setShareStatus] = useState<'idle' | 'uploading' | 'ready' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const [shareError, setShareError] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  const reset = () => {
    setFile(null);
    setStatus('idle');
    setProgress(0);
    setParts([]);
    setErrorMsg('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setShareStatus('idle');
    setShareUrl('');
    setShareError('');
    setLinkCopied(false);
  };

  const handleFile = (f: File) => {
    reset();
    setFile(f);
  };

  const handleEncode = async () => {
    if (!file) return;
    try {
      setStatus('working');
      setErrorMsg('');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const outParts = await encodeToImages(
        bytes,
        file.name,
        file.type || 'application/octet-stream',
        useEncryption && password ? password : undefined,
        (p, s) => { setProgress(p); setProgressLabel(s); }
      );
      setParts(outParts);
      if (outParts.length === 1) {
        setPreviewUrl(URL.createObjectURL(outParts[0].blob));
      }
      setStatus('done');
    } catch (e: any) {
      console.error(e);
      setStatus('error');
      setErrorMsg(e.message || 'Failed to encode file');
    }
  };

  const handleDownload = async () => {
    if (parts.length === 0) return;
    if (parts.length === 1) {
      downloadBlob(parts[0].blob, parts[0].name);
      return;
    }
    const zip = new JSZip();
    for (const p of parts) zip.file(p.name, p.blob);
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${file?.name || 'airvault'}.airvault.zip`);
  };

  const handleCreateShareLink = async () => {
    if (parts.length === 0 || shareStatus === 'uploading') return;
    setShareStatus('uploading');
    setShareError('');
    try {
      let blob: Blob;
      let filename: string;
      let mime: string;
      if (parts.length === 1) {
        blob = parts[0].blob;
        filename = parts[0].name;
        mime = 'image/png';
      } else {
        const zip = new JSZip();
        for (const p of parts) zip.file(p.name, p.blob);
        blob = await zip.generateAsync({ type: 'blob' });
        filename = `${file?.name || 'airvault'}.airvault.zip`;
        mime = 'application/zip';
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const dataBase64 = bytesToBase64(bytes);
      const result = await uploadShare('vault', filename, mime, dataBase64);
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
    <div className="w-full max-w-2xl mx-auto flex flex-col items-center py-4">
      {status === 'idle' && !file ? (
        <div
          className="w-full max-w-md aspect-square rounded-3xl border-2 border-dashed border-white/15 bg-white/5 flex flex-col items-center justify-center p-8 text-center cursor-pointer hover:border-emerald-500/50 hover:bg-white/[0.07] transition-all backdrop-blur-md"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <div className="bg-emerald-500/20 p-6 rounded-full mb-6">
            <UploadCloud className="w-10 h-10 text-emerald-400" />
          </div>
          <h3 className="text-xl font-black text-white mb-2 uppercase">Select any file</h3>
          <p className="text-sm text-gray-400">Photos, docs, audio, video, zips — any file, any size. Encoded pixel-for-pixel, byte-for-byte.</p>
        </div>
      ) : (
        <div className="w-full max-w-md flex flex-col items-center">
          <div className="w-full bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-white font-bold truncate">{file?.name}</div>
                <div className="text-xs text-gray-500">{file ? formatSize(file.size) : ''}</div>
              </div>
              <button onClick={reset} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {(status === 'idle' || status === 'error') && (
            <div className="w-full mt-4 bg-white/5 border border-white/10 rounded-3xl p-4 backdrop-blur-md">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                  <Lock size={16} className="text-emerald-400" />
                  Encrypt with password (optional)
                </span>
                <input
                  type="checkbox"
                  checked={useEncryption}
                  onChange={(e) => setUseEncryption(e.target.checked)}
                  className="w-5 h-5 accent-emerald-500"
                />
              </label>
              {useEncryption && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password the recipient will need to decode it"
                  className="mt-3 w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50"
                />
              )}
            </div>
          )}

          {errorMsg && (
            <div className="w-full mt-4 flex items-start gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
              <AlertCircle size={16} className="shrink-0 mt-0.5" /> {errorMsg}
            </div>
          )}

          {status === 'working' && (
            <div className="w-full mt-4 bg-white/5 border border-white/10 rounded-3xl p-6 text-center backdrop-blur-md">
              <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-3" />
              <div className="text-sm text-gray-300 font-medium">{progressLabel}</div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mt-3">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {status === 'done' && (
            <div className="w-full mt-4 bg-emerald-900/20 border border-emerald-500/30 rounded-3xl p-6 backdrop-blur-md flex flex-col items-center text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
              <div className="text-white font-bold mb-1">
                {parts.length === 1 ? 'Encoded to 1 image' : `Encoded to ${parts.length} images`}
              </div>
              <p className="text-xs text-gray-400 mb-4">
                Lossless — pixel-perfect. Send the {parts.length === 1 ? 'file' : 'zip'} as a <b>document/file attachment</b>, not a "photo" —
                some apps recompress photos, which would corrupt the hidden data.
              </p>
              {previewUrl && (
                <img src={previewUrl} alt="Encoded preview" className="max-w-[180px] max-h-[180px] rounded-xl border border-white/10 mb-4 object-contain" />
              )}
              <button
                onClick={handleDownload}
                className="w-full py-4 rounded-2xl bg-emerald-600 text-white font-bold text-sm tracking-widest uppercase hover:bg-emerald-500 transition-all flex items-center justify-center gap-2"
              >
                <Download size={18} />
                Download {parts.length > 1 ? '.zip' : (previewUrl ? 'PNG' : 'file')}
              </button>

              <div className="w-full mt-3 bg-black/20 border border-white/10 rounded-2xl p-4">
                {shareStatus === 'ready' && shareUrl ? (
                  <div className="flex flex-col gap-2">
                    <div className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-[10px] font-mono text-emerald-200 break-all">
                      {shareUrl}
                    </div>
                    <button
                      onClick={handleCopyShareLink}
                      className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-500 transition-all flex items-center justify-center gap-2"
                    >
                      {linkCopied ? <Check size={14} /> : <Copy size={14} />}
                      {linkCopied ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleCreateShareLink}
                    disabled={shareStatus === 'uploading'}
                    className="w-full py-2.5 rounded-xl bg-white/10 text-gray-200 text-xs font-bold uppercase tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {shareStatus === 'uploading' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                    {shareStatus === 'uploading' ? 'Uploading...' : 'Generate Share Link'}
                  </button>
                )}
                {shareStatus === 'error' && shareError && (
                  <div className="mt-2 flex items-start gap-2 text-red-400 text-[10px] font-bold">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" /> {shareError}
                  </div>
                )}
                <p className="text-[10px] text-gray-500 mt-2 text-center">
                  Or send this link instead — the receiver pastes it into AirVault's Decode screen.
                </p>
              </div>
            </div>
          )}

          {(status === 'idle' || status === 'error') && (
            <button
              onClick={handleEncode}
              className="w-full mt-6 py-5 rounded-3xl bg-emerald-600 text-white font-bold text-sm tracking-widest uppercase shadow-lg shadow-emerald-600/30 hover:bg-emerald-500 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
            >
              <ImageIcon size={20} />
              Encode to Image
            </button>
          )}

          {status === 'done' && (
            <button
              onClick={reset}
              className="w-full mt-3 py-4 rounded-2xl bg-white/10 text-white font-bold text-xs tracking-widest uppercase hover:bg-white/20 transition-all"
            >
              Encode Another File
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let b = bytes;
  let u = 0;
  while (b >= 1024 && u < units.length - 1) { b /= 1024; u++; }
  return `${b.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}
