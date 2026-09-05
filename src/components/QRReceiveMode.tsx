import { useState, useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import JSZip from 'jszip';
import { reassembleAndDecompress, reassembleAndDecompressText, reassembleLosslessFile } from '../utils/dataUtils';
import { decodeGIF } from '../utils/gif';
import { downloadDataUrl, downloadBlob } from '../utils/download';
import { fetchShare, base64ToBytes, getShareParamsFromLocation, clearShareParamsFromLocation } from '../utils/share';
import { Camera, RefreshCw, CheckCircle2, Lock, Download, AlertCircle, UploadCloud, Loader2, Link2 } from 'lucide-react';
import { cn } from '../utils/cn';
import { motion } from 'motion/react';

type DataType = 'image' | 'audio' | 'text' | 'file';

export default function ReceiveMode() {
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [chunks, setChunks] = useState<Record<number, string>>({});
  const [totalExpected, setTotalExpected] = useState<number>(0);
  const [dataType, setDataType] = useState<DataType>('image');
  const [isEncrypted, setIsEncrypted] = useState(false);

  const [resultData, setResultData] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [resultFile, setResultFile] = useState<{ filename: string; mime: string; url: string } | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  // Paste-a-link decode path — resolves a share link into the same chunk
  // sequence the camera/upload paths produce, then feeds it through the
  // same ingestChunkString/attemptDecode pipeline.
  const [linkInput, setLinkInput] = useState('');
  const [isLoadingLink, setIsLoadingLink] = useState(false);
  const [linkError, setLinkError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Stats
  const collectedCount = Object.keys(chunks).length;
  const allChunksIn = totalExpected > 0 && collectedCount === totalExpected;

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 720 } }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true'); // Required for iOS
        videoRef.current.play();
        setHasCamera(true);
        setIsScanning(true);
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      setHasCamera(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      setIsScanning(false);
    }
  };

  /** Parses a decoded QR payload string and folds it into the chunk map. Shared by the
   *  live camera scanner and every upload-based decode path (images / zip / gif).
   *  `metaLockRef` tracks "have we already locked in total/type/encryption from the first
   *  chunk we saw" synchronously — state alone isn't safe here since many frames from an
   *  uploaded zip/gif get ingested back-to-back before React re-renders. */
  const metaLockRef = useRef(false);

  const ingestChunkString = (raw: string) => {
    // Chunk format: index|total|<type><enc>|base64data
    // type: i=image, a=audio, t=text, f=generic lossless file · enc: 1=password-encrypted, 0=plain
    const parts = raw.split('|');
    if (parts.length < 4) return false;
    const index = parseInt(parts[0], 10);
    const total = parseInt(parts[1], 10);
    const meta = parts[2];
    const typeChar = meta[0];
    const encChar = meta[1];
    const data = raw.substring(parts[0].length + parts[1].length + parts[2].length + 3);

    if (isNaN(index) || isNaN(total)) return false;

    if (!metaLockRef.current) {
      metaLockRef.current = true;
      setTotalExpected(total);
      setDataType(typeChar === 'a' ? 'audio' : typeChar === 't' ? 'text' : typeChar === 'f' ? 'file' : 'image');
      setIsEncrypted(encChar === '1');
    }
    setChunks((prev) => {
      if (prev[index]) return prev;
      return { ...prev, [index]: data };
    });
    return true;
  };

  const attemptDecode = (pw?: string) => {
    if (!allChunksIn) return;
    const sortedChunks: string[] = [];
    for (let i = 0; i < totalExpected; i++) sortedChunks.push(chunks[i]);

    setDecodeError(null);

    const finish = () => stopCamera();

    if (dataType === 'text') {
      reassembleAndDecompressText(sortedChunks, isEncrypted, pw)
        .then((txt) => {
          setResultText(txt);
          finish();
        })
        .catch((err) => setDecodeError(err.message || 'Failed to decode'));
    } else if (dataType === 'file') {
      reassembleLosslessFile(sortedChunks, isEncrypted, pw)
        .then(({ filename, mime, bytes }) => {
          const blob = new Blob([bytes as BlobPart], { type: mime });
          const url = URL.createObjectURL(blob);
          setResultFile({ filename, mime, url });
          finish();
        })
        .catch((err) => setDecodeError(err.message || 'Failed to decode'));
    } else {
      reassembleAndDecompress(sortedChunks, dataType, isEncrypted, pw)
        .then((dataUrl) => {
          setResultData(dataUrl);
          finish();
        })
        .catch((err) => setDecodeError(err.message || 'Failed to decode'));
    }
  };

  useEffect(() => {
    // Auto-attempt as soon as all chunks are in, for unencrypted payloads.
    if (allChunksIn && !resultData && !resultText && !resultFile && !isEncrypted && !decodeError) {
      attemptDecode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks, totalExpected, collectedCount, resultData, resultText, resultFile, dataType, isEncrypted]);

  useEffect(() => {
    const tick = () => {
      if (isScanning && videoRef.current && canvasRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code && code.data) {
            ingestChunkString(code.data);
          }
        }
      }
      requestRef.current = requestAnimationFrame(tick);
    };

    if (isScanning && !resultData && !resultText && !resultFile) {
      requestRef.current = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(requestRef.current);
    };
  }, [isScanning, totalExpected, resultData, resultText, resultFile]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  // ── upload-based decode: images, a .zip of frames, or an animated .gif ──

  const scanImageDataForChunk = (imageData: ImageData) => {
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) return ingestChunkString(code.data);
    return false;
  };

  const loadImageAsImageData = (blob: Blob): Promise<ImageData> =>
    createImageBitmap(blob).then((bitmap) => {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    });

  const handleUploadFiles = async (files: File[]) => {
    setIsImportingFiles(true);
    setDecodeError(null);
    try {
      let found = 0, scanned = 0;
      for (const file of files) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.gif') || file.type === 'image/gif') {
          setImportStatus(`Reading GIF ${file.name}...`);
          const { frames } = await decodeGIF(file);
          for (const frame of frames) {
            scanned++;
            if (scanImageDataForChunk(frame)) found++;
            setImportStatus(`Scanned ${scanned} frame(s), found ${found} chunk(s)...`);
          }
        } else if (lower.endsWith('.zip') || file.type === 'application/zip') {
          setImportStatus(`Reading zip ${file.name}...`);
          const zip = await JSZip.loadAsync(file);
          const entries = Object.values(zip.files).filter((e) => !e.dir);
          for (const entry of entries) {
            const blob = await entry.async('blob');
            try {
              const imgData = await loadImageAsImageData(blob);
              scanned++;
              if (scanImageDataForChunk(imgData)) found++;
              setImportStatus(`Scanned ${scanned} frame(s), found ${found} chunk(s)...`);
            } catch {
              // not an image entry — skip
            }
          }
        } else {
          setImportStatus(`Reading ${file.name}...`);
          const imgData = await loadImageAsImageData(file);
          scanned++;
          if (scanImageDataForChunk(imgData)) found++;
        }
      }
      if (found === 0) {
        setDecodeError('No QR chunks found in the uploaded file(s).');
      } else {
        setImportStatus(`Found ${found} chunk(s) from ${scanned} frame(s).`);
      }
    } catch (e: any) {
      console.error(e);
      setDecodeError(e.message || 'Failed to read uploaded file(s)');
    } finally {
      setIsImportingFiles(false);
    }
  };

  const handleLoadShareLink = async (idOrUrl: string) => {
    if (!idOrUrl.trim() || isLoadingLink) return;
    setLinkError('');
    setDecodeError(null);
    setIsLoadingLink(true);
    try {
      const shared = await fetchShare(idOrUrl);
      if (shared.module !== 'qr') {
        throw new Error('This link was created by a different BeyondMesh module.');
      }
      const bytes = base64ToBytes(shared.data);
      const json = new TextDecoder().decode(bytes);
      const chunkList: string[] = JSON.parse(json);
      for (const raw of chunkList) ingestChunkString(raw);
      setImportStatus(`Loaded ${chunkList.length} chunk(s) from link.`);
    } catch (e: any) {
      console.error(e);
      setLinkError(e.message || 'Failed to load share link');
    } finally {
      setIsLoadingLink(false);
    }
  };

  // Auto-decode when opened via a share link (?share=...&m=qr).
  useEffect(() => {
    const shareParams = getShareParamsFromLocation();
    if (shareParams && (shareParams.module === 'qr' || shareParams.module === null)) {
      clearShareParamsFromLocation();
      void handleLoadShareLink(shareParams.share);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReset = () => {
    setChunks({});
    metaLockRef.current = false;
    setTotalExpected(0);
    setResultData(null);
    setResultText(null);
    if (resultFile) URL.revokeObjectURL(resultFile.url);
    setResultFile(null);
    setDecodeError(null);
    setPassword('');
    setIsEncrypted(false);
    setImportStatus('');
    setLinkInput('');
    setLinkError('');
    startCamera();
  };

  const handleDownloadResult = () => {
    if (resultFile) {
      fetch(resultFile.url).then(r => r.blob()).then(b => downloadBlob(b, resultFile.filename));
    } else if (resultData) {
      const ext = dataType === 'audio' ? 'wav' : 'jpg';
      downloadDataUrl(resultData, `beyondmesh-received.${ext}`);
    } else if (resultText) {
      const blob = new Blob([resultText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      downloadDataUrl(url, 'beyondmesh-message.txt');
    }
  };

  const needsPasswordPrompt = allChunksIn && isEncrypted && !resultData && !resultText && !resultFile;
  const fileIsImage = resultFile?.mime.startsWith('image/');
  const fileIsAudio = resultFile?.mime.startsWith('audio/');
  const fileIsVideo = resultFile?.mime.startsWith('video/');

  return (
    <div className="flex flex-col items-center justify-start w-full max-w-2xl mx-auto py-4">

      {!resultData && !resultText && !resultFile ? (
        <div className="w-full relative flex flex-col items-center">

          {/* Camera Viewfinder */}
          <div className="relative w-full max-w-md aspect-square rounded-2xl overflow-hidden bg-[#2B2B2B] border-[12px] border-[#0057A6] shadow-[8px_8px_0px_var(--lego-border)] flex items-center justify-center transition-shadow duration-300">
            {hasCamera === false && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 bg-[var(--lego-bg)]">
                <Camera className="w-16 h-16 text-[#D01012] mb-4" strokeWidth={2.5} />
                <p className="text-[#D01012] font-black uppercase text-xl">Camera Blocked</p>
                <p className="font-bold text-[var(--lego-muted)] mt-2">Please allow camera permissions.</p>
              </div>
            )}

            <video
              ref={videoRef}
              className={cn("w-full h-full object-cover", !isScanning && "hidden")}
              muted playsInline
            />

            {/* Hidden canvas for image processing */}
            <canvas ref={canvasRef} className="hidden" />

            {!isScanning && hasCamera !== false && (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--lego-bg)] z-10 transition-colors duration-300">
                <button
                  onClick={startCamera}
                  className="px-8 py-4 rounded-xl bg-[#00A650] border-4 border-[#007036] text-white font-black text-xl hover:-translate-y-1 shadow-[4px_4px_0px_#007036] hover:shadow-[6px_6px_0px_#007036] active:translate-y-1 active:shadow-none transition-all flex items-center gap-3 uppercase tracking-wide"
                >
                  <Camera className="w-8 h-8" strokeWidth={3} />
                  Start Scanner
                </button>
              </div>
            )}
          </div>

          {/* Upload alternative — decode from images / a zip of frames / a GIF instead of live scanning */}
          {!isScanning && !needsPasswordPrompt && (
            <div className="mt-6 w-full max-w-md flex flex-col items-center">
              <div className="flex items-center gap-3 w-full my-1">
                <div className="h-px flex-1 bg-[var(--lego-border)] opacity-30" />
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--lego-muted)]">or</span>
                <div className="h-px flex-1 bg-[var(--lego-border)] opacity-30" />
              </div>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*,.zip,.gif"
                multiple
                className="hidden"
                onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) handleUploadFiles(fs); }}
              />
              <button
                onClick={() => uploadInputRef.current?.click()}
                disabled={isImportingFiles}
                className="w-full py-4 rounded-xl bg-[var(--lego-card)] border-4 border-[var(--lego-border)] text-[var(--lego-text)] font-bold uppercase text-xs tracking-widest shadow-[3px_3px_0px_var(--lego-border)] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {isImportingFiles ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" strokeWidth={2.5} />}
                {isImportingFiles ? (importStatus || 'Reading...') : 'Upload QR Image(s), .zip, or .gif'}
              </button>

              {/* Paste share link — decode remotely instead of scanning/uploading frames */}
              <div className="flex items-center gap-3 w-full my-3">
                <div className="h-px flex-1 bg-[var(--lego-border)] opacity-30" />
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--lego-muted)]">or</span>
                <div className="h-px flex-1 bg-[var(--lego-border)] opacity-30" />
              </div>
              <div className="w-full flex gap-2">
                <input
                  type="text"
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  placeholder="Paste a BeyondMesh share link"
                  className="flex-1 min-w-0 bg-[var(--lego-bg)] border-2 border-[var(--lego-border)] rounded-lg px-3 py-2 text-xs font-medium text-[var(--lego-text)] outline-none"
                />
                <button
                  onClick={() => handleLoadShareLink(linkInput)}
                  disabled={isLoadingLink || !linkInput.trim()}
                  className="px-4 py-2 rounded-lg bg-[#0057A6] border-2 border-[#003B73] text-white font-black uppercase text-xs tracking-wide flex items-center justify-center gap-2 disabled:opacity-60 shrink-0"
                >
                  {isLoadingLink ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  {isLoadingLink ? '' : 'Load'}
                </button>
              </div>
              {linkError && (
                <div className="mt-2 w-full flex items-start gap-2 text-[#D01012] text-xs font-bold">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {linkError}
                </div>
              )}
            </div>
          )}

          {/* Progress Indicators */}
          {(isScanning || collectedCount > 0) && !needsPasswordPrompt && (
            <div className="mt-8 w-full max-w-md bg-[var(--lego-card)] border-4 border-[var(--lego-border)] rounded-2xl p-6 shadow-[8px_8px_0px_var(--lego-border)] transition-colors duration-300">
              <div className="flex justify-between items-center mb-4">
                <span className="font-black text-[var(--lego-text)] uppercase flex items-center gap-2">
                  Building {dataType === 'audio' ? 'Audio' : dataType === 'text' ? 'Message' : dataType === 'file' ? 'File' : 'Image'}
                  {isEncrypted && <Lock className="w-4 h-4 text-[#D01012]" strokeWidth={3} />}
                </span>
                <span className="font-black text-[#0057A6]">
                  {totalExpected > 0 ? `${collectedCount} / ${totalExpected}` : 'WAITING...'}
                </span>
              </div>

              {/* Chunk visualizer grid (LEGO blocks style) */}
              <div className="w-full flex flex-wrap gap-1 p-2 bg-[var(--lego-bg)] border-2 border-[var(--lego-border)] rounded-xl min-h-[60px] content-start transition-colors duration-300">
                {totalExpected > 0 ? (
                  Array.from({ length: totalExpected }).map((_, i) => (
                    <motion.div
                      key={i}
                      initial={{ scale: 0 }}
                      animate={{ scale: chunks[i] ? 1 : 0 }}
                      className="w-4 h-4 bg-[#FFD500] border-2 border-[#B29500] rounded-sm shadow-sm"
                    />
                  ))
                ) : (
                  <div className="w-full text-center text-sm font-bold text-[var(--lego-muted)] uppercase py-2">
                    Point camera at sender, or upload frames
                  </div>
                )}
              </div>
            </div>
          )}

          {decodeError && !needsPasswordPrompt && (
            <div className="mt-4 w-full max-w-md flex items-start gap-2 text-[#D01012] text-sm font-bold bg-red-500/10 border-2 border-[#D01012]/30 rounded-xl p-4">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {decodeError}
            </div>
          )}

          {/* Password prompt for encrypted payloads */}
          {needsPasswordPrompt && (
            <div className="mt-8 w-full max-w-md bg-[var(--lego-card)] border-4 border-[var(--lego-border)] rounded-2xl p-6 shadow-[8px_8px_0px_var(--lego-border)] transition-colors duration-300">
              <div className="flex items-center gap-2 font-black text-[var(--lego-text)] uppercase mb-3">
                <Lock className="w-5 h-5 text-[#D01012]" strokeWidth={3} />
                Password protected
              </div>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password to decode"
                className="w-full bg-[var(--lego-bg)] border-2 border-[var(--lego-border)] rounded-lg px-3 py-2 text-sm font-medium text-[var(--lego-text)] outline-none"
              />
              {decodeError && (
                <div className="mt-2 flex items-center gap-2 text-[#D01012] text-xs font-bold">
                  <AlertCircle className="w-4 h-4" /> {decodeError}
                </div>
              )}
              <button
                onClick={() => attemptDecode(password)}
                disabled={!password}
                className="mt-4 w-full px-6 py-3 rounded-xl bg-[#0057A6] border-4 border-[#003B73] text-white font-black uppercase tracking-wide shadow-[4px_4px_0px_#003B73] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all disabled:opacity-50"
              >
                Decrypt
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Reveal Animation State */
        <motion.div
          className="w-full flex flex-col items-center"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, type: "spring", bounce: 0.5 }}
        >
          <div className="relative w-full max-w-md p-4 rounded-2xl bg-[var(--lego-card)] border-4 border-[var(--lego-border)] shadow-[10px_10px_0px_var(--lego-border)] mb-10 flex flex-col items-center transition-colors duration-300">
            {/* Stud Decoration Header */}
            <div className="absolute -top-3 left-4 right-4 flex justify-around">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="w-6 h-4 bg-[var(--lego-card)] border-4 border-[var(--lego-border)] border-b-0 rounded-t-md transition-colors duration-300" />
              ))}
            </div>

            <div className="relative rounded-xl overflow-hidden bg-[var(--lego-bg)] border-4 border-[var(--lego-border)] w-full p-2 mt-2 transition-colors duration-300">
              {dataType === 'audio' && resultData ? (
                <div className="flex flex-col items-center justify-center p-8 bg-[#FFD500] rounded-lg">
                  <audio src={resultData} controls autoPlay className="w-full max-w-xs outline-none" />
                </div>
              ) : dataType === 'text' && resultText !== null ? (
                <div className="p-6 bg-[#FFD500] rounded-lg min-h-[120px] flex items-center justify-center">
                  <p className="text-[#2B2B2B] font-bold text-lg text-center break-words">{resultText}</p>
                </div>
              ) : resultFile ? (
                <div className="flex flex-col items-center justify-center p-6 bg-[#FFD500] rounded-lg gap-3">
                  {fileIsImage ? (
                    <img src={resultFile.url} alt={resultFile.filename} className="w-full h-auto object-contain rounded-lg max-h-72" />
                  ) : fileIsAudio ? (
                    <audio src={resultFile.url} controls autoPlay className="w-full max-w-xs outline-none" />
                  ) : fileIsVideo ? (
                    <video src={resultFile.url} controls className="w-full max-h-72 rounded-lg" />
                  ) : (
                    <div className="text-[#2B2B2B] font-bold text-center">No preview available</div>
                  )}
                  <p className="text-[#2B2B2B] font-bold text-sm text-center break-all">{resultFile.filename}</p>
                </div>
              ) : resultData ? (
                <img
                  src={resultData}
                  alt="Received data"
                  className="w-full h-auto object-contain rounded-lg"
                />
              ) : null}
            </div>

            {/* Success Badge */}
            <motion.div
              className="absolute -bottom-6 bg-[#00A650] border-4 border-[#007036] text-white px-6 py-3 rounded-xl shadow-[4px_4px_0px_#007036] flex items-center gap-2 font-black uppercase tracking-wide text-lg"
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: -5 }}
              transition={{ delay: 0.4, type: 'spring', bounce: 0.6 }}
            >
              <CheckCircle2 className="w-6 h-6" strokeWidth={3} />
              Built!
            </motion.div>
          </div>

          <div className="flex flex-wrap justify-center gap-4">
            <button
              onClick={handleDownloadResult}
              className="px-6 py-3 rounded-xl bg-[var(--lego-card)] border-4 border-[var(--lego-border)] text-[var(--lego-text)] shadow-[4px_4px_0px_var(--lego-border)] hover:-translate-y-1 hover:shadow-[6px_6px_0px_var(--lego-border)] active:translate-y-1 active:shadow-none transition-all flex items-center gap-3 uppercase font-black tracking-wide"
            >
              <Download className="w-5 h-5" strokeWidth={3} />
              Download
            </button>
            <button
              onClick={handleReset}
              className="px-8 py-3 rounded-xl bg-[#0057A6] border-4 border-[#003B73] text-white shadow-[4px_4px_0px_#003B73] hover:-translate-y-1 hover:shadow-[6px_6px_0px_#003B73] active:translate-y-1 active:shadow-none transition-all flex items-center gap-3 uppercase font-black tracking-wide"
            >
              <RefreshCw className="w-5 h-5" strokeWidth={3} />
              Receive Another
            </button>
          </div>
        </motion.div>
      )}

    </div>
  );
}
