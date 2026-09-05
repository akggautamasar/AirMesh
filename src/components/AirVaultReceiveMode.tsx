import { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { UploadCloud, Lock, Download, Loader2, CheckCircle2, X, AlertCircle, RefreshCw, Link2 } from 'lucide-react';
import { decodeFromImages, AirVaultDecoded } from '../utils/airvault';
import { downloadBlob } from '../utils/download';
import { fetchShare, base64ToBytes, getShareParamsFromLocation, clearShareParamsFromLocation } from '../utils/share';

export default function AirVaultReceiveMode() {
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [pendingBlobs, setPendingBlobs] = useState<Blob[]>([]);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'needs-password' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<AirVaultDecoded | null>(null);
  const [resultUrl, setResultUrl] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const [linkInput, setLinkInput] = useState('');
  const [isLoadingLink, setIsLoadingLink] = useState(false);
  const [linkError, setLinkError] = useState('');

  const reset = () => {
    setFileNames([]);
    setPendingBlobs([]);
    setStatus('idle');
    setProgress(0);
    setErrorMsg('');
    setResult(null);
    setPassword('');
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl('');
  };

  /** Expand any uploaded .zip into its member images; pass everything else through as-is. */
  const expandFiles = async (files: File[]): Promise<Blob[]> => {
    const out: Blob[] = [];
    for (const f of files) {
      if (f.name.toLowerCase().endsWith('.zip')) {
        const zip = await JSZip.loadAsync(f);
        const entries = Object.values(zip.files).filter((e) => !e.dir);
        for (const entry of entries) {
          out.push(await entry.async('blob'));
        }
      } else {
        out.push(f);
      }
    }
    return out;
  };

  const handleFiles = async (files: File[]) => {
    reset();
    setFileNames(files.map((f) => f.name));
    const blobs = await expandFiles(files);
    setPendingBlobs(blobs);
    void attemptDecode(blobs);
  };

  const attemptDecode = async (blobs: Blob[], pw?: string) => {
    if (blobs.length === 0) return;
    setStatus('working');
    setErrorMsg('');
    try {
      const decoded = await decodeFromImages(blobs, pw, (p, s) => { setProgress(p); setProgressLabel(s); });
      setResult(decoded);
      const blob = new Blob([decoded.bytes as BlobPart], { type: decoded.mime });
      setResultUrl(URL.createObjectURL(blob));
      setStatus('done');
    } catch (e: any) {
      console.error(e);
      if (e.message && e.message.toLowerCase().includes('password')) {
        setStatus('needs-password');
      } else {
        setStatus('error');
        setErrorMsg(e.message || 'Failed to decode');
      }
    }
  };

  const handleLoadShareLink = async (idOrUrl: string) => {
    if (!idOrUrl.trim() || isLoadingLink) return;
    setLinkError('');
    reset();
    setIsLoadingLink(true);
    try {
      const shared = await fetchShare(idOrUrl);
      if (shared.module !== 'vault') {
        throw new Error('This link was created by a different BeyondMesh module.');
      }
      const bytes = base64ToBytes(shared.data);
      const blob = new Blob([bytes as BlobPart], { type: shared.mime });
      let blobs: Blob[];
      if (shared.mime === 'application/zip' || shared.filename.toLowerCase().endsWith('.zip')) {
        const zip = await JSZip.loadAsync(blob);
        const entries = Object.values(zip.files).filter((e) => !e.dir);
        blobs = await Promise.all(entries.map((entry) => entry.async('blob')));
      } else {
        blobs = [blob];
      }
      setFileNames([shared.filename]);
      setPendingBlobs(blobs);
      await attemptDecode(blobs);
    } catch (e: any) {
      console.error(e);
      setLinkError(e.message || 'Failed to load share link');
    } finally {
      setIsLoadingLink(false);
    }
  };

  // Auto-decode when opened via a share link (?share=...&m=vault).
  useEffect(() => {
    const shareParams = getShareParamsFromLocation();
    if (shareParams && (shareParams.module === 'vault' || shareParams.module === null)) {
      clearShareParamsFromLocation();
      void handleLoadShareLink(shareParams.share);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result.bytes as BlobPart], { type: result.mime });
    downloadBlob(blob, result.filename);
  };

  const isImage = result?.mime.startsWith('image/');
  const isAudio = result?.mime.startsWith('audio/');
  const isVideo = result?.mime.startsWith('video/');

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col items-center py-4">
      {status === 'idle' && fileNames.length === 0 ? (
        <div
          className="w-full max-w-md aspect-square rounded-3xl border-2 border-dashed border-white/15 bg-white/5 flex flex-col items-center justify-center p-8 text-center cursor-pointer hover:border-emerald-500/50 hover:bg-white/[0.07] transition-all backdrop-blur-md"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files || []); if (fs.length) handleFiles(fs); }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) handleFiles(fs); }}
          />
          <div className="bg-emerald-500/20 p-6 rounded-full mb-6">
            <UploadCloud className="w-10 h-10 text-emerald-400" />
          </div>
          <h3 className="text-xl font-black text-white mb-2 uppercase">Upload image(s)</h3>
          <p className="text-sm text-gray-400">One PNG, several parts, or a .zip of parts — pick whatever you were sent.</p>
        </div>
      ) : null}

      {status === 'idle' && fileNames.length === 0 && (
        <div className="w-full max-w-md flex flex-col items-center mt-4">
          <div className="flex items-center gap-3 w-full my-1">
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
              className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-2xl px-4 py-3 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={() => handleLoadShareLink(linkInput)}
              disabled={isLoadingLink || !linkInput.trim()}
              className="px-4 rounded-2xl bg-emerald-600 text-white font-bold text-xs uppercase tracking-widest hover:bg-emerald-500 transition-all disabled:opacity-50 flex items-center justify-center shrink-0"
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

      {fileNames.length > 0 && (
        <div className="w-full max-w-md flex flex-col items-center">
          <div className="w-full bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-white font-bold truncate">{fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files selected`}</div>
              </div>
              <button onClick={reset} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {status === 'working' && (
            <div className="w-full mt-4 bg-white/5 border border-white/10 rounded-3xl p-6 text-center backdrop-blur-md">
              <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-3" />
              <div className="text-sm text-gray-300 font-medium">{progressLabel}</div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mt-3">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {status === 'needs-password' && (
            <div className="w-full mt-4 bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-md">
              <div className="flex flex-col items-center text-emerald-300 mb-4">
                <Lock size={24} />
                <span className="text-xs font-bold uppercase tracking-widest mt-2">Password protected</span>
              </div>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password to decode"
                className="w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50"
              />
              {errorMsg && (
                <div className="mt-2 flex items-center gap-2 text-red-400 text-xs">
                  <AlertCircle size={14} /> {errorMsg}
                </div>
              )}
              <button
                onClick={() => attemptDecode(pendingBlobs, password)}
                disabled={!password}
                className="mt-4 w-full py-4 rounded-2xl bg-emerald-600 text-white font-bold text-xs tracking-widest uppercase hover:bg-emerald-500 transition-all disabled:opacity-50"
              >
                Decrypt
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="w-full mt-4 flex items-start gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
              <AlertCircle size={16} className="shrink-0 mt-0.5" /> {errorMsg}
            </div>
          )}

          {status === 'done' && result && (
            <div className="w-full mt-4 bg-emerald-900/20 border border-emerald-500/30 rounded-3xl p-6 backdrop-blur-md flex flex-col items-center text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
              <div className="text-white font-bold mb-1 break-all">{result.filename}</div>
              <p className="text-xs text-gray-400 mb-4">Reconstructed byte-for-byte — checksum verified.</p>

              {isImage && resultUrl && (
                <img src={resultUrl} alt={result.filename} className="max-w-full max-h-64 rounded-xl border border-white/10 mb-4 object-contain" />
              )}
              {isAudio && resultUrl && (
                <audio src={resultUrl} controls className="w-full mb-4" />
              )}
              {isVideo && resultUrl && (
                <video src={resultUrl} controls className="w-full max-h-64 rounded-xl mb-4" />
              )}

              <button
                onClick={handleDownload}
                className="w-full py-4 rounded-2xl bg-emerald-600 text-white font-bold text-sm tracking-widest uppercase hover:bg-emerald-500 transition-all flex items-center justify-center gap-2"
              >
                <Download size={18} />
                Download
              </button>
            </div>
          )}

          {status === 'done' && (
            <button
              onClick={reset}
              className="w-full mt-3 py-4 rounded-2xl bg-white/10 text-white font-bold text-xs tracking-widest uppercase hover:bg-white/20 transition-all flex items-center justify-center gap-2"
            >
              <RefreshCw size={16} />
              Decode Another
            </button>
          )}
        </div>
      )}
    </div>
  );
}
