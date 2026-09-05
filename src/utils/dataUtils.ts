import * as pako from 'pako';
import { encryptBytes, decryptBytes } from './crypto';

// Encode array buffer to base64
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Decode base64 to array buffer
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// Max payload size (base64 chars) per QR frame. Bumped up from the original 60 —
// modern phone cameras handle a denser QR fine, and this cuts the frame count
// (and therefore transmission time / scan effort) roughly 6-7x for the same data.
export const CHUNK_SIZE = 400;

function encode8BitWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length);
  const view = new DataView(buffer);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // ByteRate
  view.setUint16(32, 1, true); // BlockAlign
  view.setUint16(34, 8, true); // BitsPerSample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length, true);

  // Write 8-bit samples (0-255, center 128)
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    let val = Math.round((s + 1) * 127.5);
    view.setUint8(44 + i, val);
  }
  return buffer;
}

// ── lossless file packing (filename + mime header, then raw bytes) ────────
//
// Used by QRMesh's "Lossless" mode: instead of downscaling/recompressing
// images or resampling audio to 8-bit/8kHz (which is what made images look
// bad and made SoundMesh WAVs round-tripped through QRMesh undecodable),
// this preserves the exact original bytes of ANY file type. It costs more
// QR frames for large files, but is byte-for-byte perfect.

function packFileWithHeader(bytes: Uint8Array, filename: string, mime: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(filename);
  const mimeBytes = new TextEncoder().encode(mime);
  const out = new Uint8Array(2 + nameBytes.length + 2 + mimeBytes.length + bytes.length);
  const view = new DataView(out.buffer);
  let off = 0;
  view.setUint16(off, nameBytes.length, false); off += 2;
  out.set(nameBytes, off); off += nameBytes.length;
  view.setUint16(off, mimeBytes.length, false); off += 2;
  out.set(mimeBytes, off); off += mimeBytes.length;
  out.set(bytes, off);
  return out;
}

function unpackFileWithHeader(data: Uint8Array): { filename: string; mime: string; bytes: Uint8Array } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 0;
  const nameLen = view.getUint16(off, false); off += 2;
  const filename = new TextDecoder().decode(data.subarray(off, off + nameLen)); off += nameLen;
  const mimeLen = view.getUint16(off, false); off += 2;
  const mime = new TextDecoder().decode(data.subarray(off, off + mimeLen)); off += mimeLen;
  const bytes = data.subarray(off);
  return { filename, mime, bytes };
}

/** Lossless QRMesh file pipeline: original bytes in, deflated + optionally encrypted chunks out. */
export async function compressAndChunkFileLossless(
  file: File,
  password?: string,
  onProgress?: (progress: number, status: string) => void
): Promise<string[]> {
  const wait = () => new Promise(r => setTimeout(r, 20));

  onProgress?.(10, 'Reading file...');
  await wait();
  const bytes = new Uint8Array(await file.arrayBuffer());

  onProgress?.(35, 'Packing metadata...');
  await wait();
  const withHeader = packFileWithHeader(bytes, file.name, file.type || 'application/octet-stream');

  onProgress?.(55, 'Compressing (lossless)...');
  await wait();
  let payload: Uint8Array = pako.deflate(withHeader);
  const encFlag = password ? '1' : '0';

  if (password) {
    onProgress?.(75, 'Encrypting...');
    await wait();
    payload = await encryptBytes(payload, password);
  }

  onProgress?.(90, 'Generating Chunks...');
  await wait();

  const payloadBase64 = arrayBufferToBase64(payload.buffer as ArrayBuffer);
  const chunks: string[] = [];
  const totalChunks = Math.ceil(payloadBase64.length / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const chunkData = payloadBase64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    // 'f' = generic lossless file (filename/mime carried inside the payload header)
    chunks.push(`${i}|${totalChunks}|f${encFlag}|${chunkData}`);
  }

  onProgress?.(100, 'Ready to Transmit');
  await wait();

  return chunks;
}

/** Reassembles a lossless 'f'-type QRMesh sequence back into the original file bytes + name/mime. */
export async function reassembleLosslessFile(
  chunksData: string[],
  encrypted: boolean,
  password?: string
): Promise<{ filename: string; mime: string; bytes: Uint8Array }> {
  const decompressed = await reassembleBytes(chunksData, encrypted, password);
  return unpackFileWithHeader(decompressed);
}

export async function compressAndChunkFile(
  file: File,
  password?: string,
  onProgress?: (progress: number, status: string) => void
): Promise<string[]> {
  const wait = () => new Promise(r => setTimeout(r, 30));

  let bytes: Uint8Array;
  let typeFlag = 'i';

  if (file.type.startsWith('audio')) {
    typeFlag = 'a';
    onProgress?.(10, "Loading Audio...");
    await wait();

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    onProgress?.(30, "Decoding Audio...");
    await wait();
    
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    onProgress?.(50, "Compressing (8kHz Mono)...");
    await wait();

    // Fast mode heavily downsamples — fine for speech, but this is exactly what corrupts
    // tone-based audio like a SoundMesh WAV (its signal lives above 4kHz, so 8kHz sampling
    // aliases it into noise). Use Lossless mode for anything ggwave-encoded.
    const TARGET_SAMPLE_RATE = 8000;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    const renderedBuffer = await offlineCtx.startRendering();
    
    onProgress?.(70, "Encoding WAV...");
    await wait();
    const wavBuffer = encode8BitWAV(renderedBuffer.getChannelData(0), TARGET_SAMPLE_RATE);
    bytes = new Uint8Array(wavBuffer);
  } else {
    onProgress?.(10, "Loading Image...");
    await wait();

    // Downscale image
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    onProgress?.(30, "Resizing & Formatting...");
    await wait();

    const canvas = document.createElement('canvas');
    // "Fast" mode still downscales for a small frame count — use Lossless mode
    // (see AirVault or QRMesh's Lossless toggle) for full, untouched quality.
    const MAX_WIDTH = 260;
    const MAX_HEIGHT = 260;
    let width = img.width;
    let height = img.height;

    if (width > height) {
      if (width > MAX_WIDTH) {
        height *= MAX_WIDTH / width;
        width = MAX_WIDTH;
      }
    } else {
      if (height > MAX_HEIGHT) {
        width *= MAX_HEIGHT / height;
        height = MAX_HEIGHT;
      }
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, width, height);
    
    onProgress?.(50, "Extracting Bytes...");
    await wait();

    // Output as compressed JPEG (Fast mode — use Lossless for pixel-perfect output)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
    // Extract base64 part
    const base64Data = dataUrl.split(',')[1];
    
    // Convert base64 to binary string then to Uint8Array
    const binStr = window.atob(base64Data);
    bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
  }

  onProgress?.(80, "Compressing Data...");
  await wait();

  // Compress using pako
  let payload: Uint8Array = pako.deflate(bytes);
  const encFlag = password ? '1' : '0';

  if (password) {
    onProgress?.(85, "Encrypting...");
    await wait();
    payload = await encryptBytes(payload, password);
  }

  onProgress?.(90, "Generating Chunks...");
  await wait();

  // Convert to base64
  const payloadBase64 = arrayBufferToBase64(payload.buffer as ArrayBuffer);

  // Chunking
  const chunks: string[] = [];
  const totalChunks = Math.ceil(payloadBase64.length / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const chunkData = payloadBase64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    chunks.push(`${i}|${totalChunks}|${typeFlag}${encFlag}|${chunkData}`);
  }

  onProgress?.(100, "Ready to Transmit");
  await wait();

  return chunks;
}

/** Same pipeline as compressAndChunkFile, but for a plain text message (BeyondMesh "Text" mode). */
export async function compressAndChunkText(
  text: string,
  password?: string,
  onProgress?: (progress: number, status: string) => void
): Promise<string[]> {
  const wait = () => new Promise(r => setTimeout(r, 20));
  onProgress?.(20, "Encoding Text...");
  await wait();

  const bytes = new TextEncoder().encode(text);
  let payload: Uint8Array = pako.deflate(bytes);
  const encFlag = password ? '1' : '0';

  if (password) {
    onProgress?.(60, "Encrypting...");
    await wait();
    payload = await encryptBytes(payload, password);
  }

  onProgress?.(80, "Generating Chunks...");
  await wait();

  const payloadBase64 = arrayBufferToBase64(payload.buffer as ArrayBuffer);
  const chunks: string[] = [];
  const totalChunks = Math.ceil(payloadBase64.length / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const chunkData = payloadBase64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    chunks.push(`${i}|${totalChunks}|t${encFlag}|${chunkData}`);
  }

  onProgress?.(100, "Ready to Transmit");
  await wait();

  return chunks;
}

/**
 * Reassembles chunked, base64 QRMesh payload data back into the original bytes.
 * If the payload was encrypted, pass the password — throws if missing/wrong.
 */
export async function reassembleBytes(
  chunksData: string[],
  encrypted: boolean,
  password?: string
): Promise<Uint8Array> {
  const payloadBase64 = chunksData.join('');
  let payload = new Uint8Array(base64ToArrayBuffer(payloadBase64));

  if (encrypted) {
    if (!password) {
      throw new Error('This message is password-protected. Enter the password to decode.');
    }
    payload = await decryptBytes(payload, password);
  }

  return pako.inflate(payload);
}

export async function reassembleAndDecompress(
  chunksData: string[],
  dataType: 'image' | 'audio',
  encrypted: boolean = false,
  password?: string
): Promise<string> {
  const decompressed = await reassembleBytes(chunksData, encrypted, password);

  // Convert decompressed Uint8Array back to binary string
  let binaryString = '';
  for (let i = 0; i < decompressed.length; i++) {
    binaryString += String.fromCharCode(decompressed[i]);
  }

  const base64 = window.btoa(binaryString);
  const mime = dataType === 'audio' ? 'audio/wav' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

export async function reassembleAndDecompressText(
  chunksData: string[],
  encrypted: boolean = false,
  password?: string
): Promise<string> {
  const decompressed = await reassembleBytes(chunksData, encrypted, password);
  return new TextDecoder().decode(decompressed);
}
