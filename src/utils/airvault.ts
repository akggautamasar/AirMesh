/**
 * AirVault — losslessly encode any file into PNG image(s) and back.
 *
 * Ported from AiR's original Python "AirVault" tool (airvault_core.py) to run
 * 100% client-side in the browser via <canvas>, matching BeyondMesh's
 * offline, no-server design. This is the third BeyondMesh channel: instead
 * of scanning QR frames or listening for tones, you get one (or a few)
 * plain PNG images that carry your file's exact bytes in their pixels —
 * lossless, because PNG itself is a lossless format and we never resize,
 * recompress, or resample anything.
 *
 * Wire format (big-endian), stored as the first bytes of the "blob" that
 * gets packed into pixels:
 *   magic       4 B   "AVTS"
 *   version     1 B   = 1
 *   flags       1 B   bit0 = AES-256-GCM encrypted
 *   name_len    2 B
 *   filename    N B   (utf-8, original file name)
 *   mime_len    2 B
 *   mime        M B   (utf-8, original MIME type, may be empty)
 *   part_no     4 B
 *   part_total  4 B
 *   chunk_len   4 B   byte length of the stored (possibly encrypted) chunk
 *   chunk_sha  32 B   sha256 of the stored chunk bytes
 *   file_sha   32 B   sha256 of the complete ORIGINAL (plaintext) file
 *   payload     …
 */

import { encryptBytes, decryptBytes } from './crypto';

const MAGIC = 'AVTS';
const VERSION = 1;
const DEFAULT_CHUNK_BYTES = 6 * 1024 * 1024; // 6MB of source data per PNG part

export interface AirVaultPart {
  name: string;
  blob: Blob;
}

export interface AirVaultDecoded {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

// ── small binary helpers ─────────────────────────────────────────────────

class ByteWriter {
  private chunks: Uint8Array[] = [];
  u8(v: number) { this.chunks.push(new Uint8Array([v & 0xff])); }
  u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, false); this.chunks.push(b); }
  u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, false); this.chunks.push(b); }
  bytes(v: Uint8Array) { this.chunks.push(v); }
  str(v: string) { this.bytes(new TextEncoder().encode(v)); }
  finish(): Uint8Array {
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) { out.set(c, off); off += c.length; }
    return out;
  }
}

class ByteReader {
  private off = 0;
  constructor(private data: Uint8Array) {}
  u8(): number { return this.data[this.off++]; }
  u16(): number { const v = new DataView(this.data.buffer, this.data.byteOffset + this.off, 2).getUint16(0, false); this.off += 2; return v; }
  u32(): number { const v = new DataView(this.data.buffer, this.data.byteOffset + this.off, 4).getUint32(0, false); this.off += 4; return v; }
  bytes(n: number): Uint8Array { const v = this.data.subarray(this.off, this.off + n); this.off += n; return v; }
  str(n: number): string { return new TextDecoder().decode(this.bytes(n)); }
  get pos() { return this.off; }
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  return new Uint8Array(digest);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── header ────────────────────────────────────────────────────────────────

interface Header {
  version: number;
  encrypted: boolean;
  filename: string;
  mime: string;
  partNo: number;
  partTotal: number;
  chunkLen: number;
  chunkSha: Uint8Array;
  fileSha: Uint8Array;
  headerSize: number;
}

async function buildHeader(
  filename: string, mime: string, partNo: number, partTotal: number,
  chunkBytes: Uint8Array, fileSha: Uint8Array, encrypted: boolean
): Promise<Uint8Array> {
  const w = new ByteWriter();
  const chunkSha = await sha256(chunkBytes);
  w.str(MAGIC);
  w.u8(VERSION);
  w.u8(encrypted ? 1 : 0);
  const nameBytes = new TextEncoder().encode(filename);
  w.u16(nameBytes.length);
  w.bytes(nameBytes);
  const mimeBytes = new TextEncoder().encode(mime);
  w.u16(mimeBytes.length);
  w.bytes(mimeBytes);
  w.u32(partNo);
  w.u32(partTotal);
  w.u32(chunkBytes.length);
  w.bytes(chunkSha);
  w.bytes(fileSha);
  return w.finish();
}

function parseHeader(data: Uint8Array): Header {
  if (data.length < 8 || new TextDecoder().decode(data.subarray(0, 4)) !== MAGIC) {
    throw new Error('Not an AirVault image (bad magic)');
  }
  const r = new ByteReader(data);
  r.str(4); // magic
  const version = r.u8();
  const flags = r.u8();
  const nameLen = r.u16();
  const filename = r.str(nameLen);
  const mimeLen = r.u16();
  const mime = r.str(mimeLen);
  const partNo = r.u32();
  const partTotal = r.u32();
  const chunkLen = r.u32();
  const chunkSha = r.bytes(32);
  const fileSha = r.bytes(32);
  return {
    version, encrypted: !!(flags & 1), filename, mime,
    partNo, partTotal, chunkLen,
    chunkSha: new Uint8Array(chunkSha), fileSha: new Uint8Array(fileSha),
    headerSize: r.pos,
  };
}

// ── bytes ⇄ PNG (lossless, via canvas) ───────────────────────────────────

async function bytesToPng(blob: Uint8Array): Promise<Blob> {
  const n = blob.length;
  const px = Math.ceil(n / 3);
  const side = Math.max(1, Math.ceil(Math.sqrt(px)));
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const imgData = ctx.createImageData(side, side);
  const out = imgData.data; // RGBA
  for (let i = 0; i < side * side; i++) {
    const bi = i * 3;
    out[i * 4] = bi < n ? blob[bi] : 0;
    out[i * 4 + 1] = bi + 1 < n ? blob[bi + 1] : 0;
    out[i * 4 + 2] = bi + 2 < n ? blob[bi + 2] : 0;
    out[i * 4 + 3] = 255; // opaque — keeps PNG encoding raw, no premultiplication surprises
  }
  ctx.putImageData(imgData, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  });
}

async function pngToBytes(pngBlob: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(pngBlob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const src = imgData.data;
  const total = canvas.width * canvas.height;
  const out = new Uint8Array(total * 3);
  for (let i = 0; i < total; i++) {
    out[i * 3] = src[i * 4];
    out[i * 3 + 1] = src[i * 4 + 1];
    out[i * 3 + 2] = src[i * 4 + 2];
  }
  return out;
}

async function readOne(pngBlob: Blob): Promise<Header & { payload: Uint8Array }> {
  const raw = await pngToBytes(pngBlob);
  const header = parseHeader(raw);
  const payload = raw.subarray(header.headerSize, header.headerSize + header.chunkLen);
  const gotSha = await sha256(payload);
  if (!bytesEqual(gotSha, header.chunkSha)) {
    throw new Error('Chunk checksum failed — image is corrupted or was recompressed by an app (send as a file/document, not a photo)');
  }
  return { ...header, payload };
}

// ── public API ───────────────────────────────────────────────────────────

export async function encodeToImages(
  data: Uint8Array,
  filename: string,
  mime: string,
  password?: string,
  onProgress?: (pct: number, status: string) => void,
  chunkBytes: number = DEFAULT_CHUNK_BYTES,
): Promise<AirVaultPart[]> {
  onProgress?.(5, 'Hashing file...');
  const fileSha = await sha256(data);
  const partTotal = Math.max(1, Math.ceil(data.length / chunkBytes));
  const encrypted = !!password;
  const parts: AirVaultPart[] = [];

  for (let i = 0; i < partTotal; i++) {
    onProgress?.(10 + Math.round((i / partTotal) * 80), `Encoding image ${i + 1} of ${partTotal}...`);
    const chunk = data.subarray(i * chunkBytes, (i + 1) * chunkBytes);
    const stored = encrypted ? await encryptBytes(chunk, password!) : chunk;
    const header = await buildHeader(filename, mime, i + 1, partTotal, stored, fileSha, encrypted);
    const blobBytes = new Uint8Array(header.length + stored.length);
    blobBytes.set(header, 0);
    blobBytes.set(stored, header.length);
    const png = await bytesToPng(blobBytes);
    const name = partTotal === 1 ? `${filename}.avlt` : `${filename}.part${i + 1}of${partTotal}.avlt`;
    parts.push({ name, blob: png });
  }

  onProgress?.(100, 'Done');
  return parts;
}

export async function decodeFromImages(
  pngBlobs: Blob[],
  password?: string,
  onProgress?: (pct: number, status: string) => void,
): Promise<AirVaultDecoded> {
  const groups = new Map<string, {
    parts: Map<number, { payload: Uint8Array; encrypted: boolean }>;
    total: number; sha: Uint8Array; mime: string;
  }>();

  for (let i = 0; i < pngBlobs.length; i++) {
    onProgress?.(Math.round((i / pngBlobs.length) * 60), `Reading image ${i + 1} of ${pngBlobs.length}...`);
    const info = await readOne(pngBlobs[i]);
    const key = `${info.filename}::${Array.from(info.fileSha).join(',')}`;
    let g = groups.get(key);
    if (!g) {
      g = { parts: new Map(), total: info.partTotal, sha: info.fileSha, mime: info.mime };
      groups.set(key, g);
    }
    g.parts.set(info.partNo, { payload: info.payload, encrypted: info.encrypted });
  }

  if (groups.size === 0) throw new Error('No valid AirVault images found');

  for (const [key, g] of groups) {
    const missing: number[] = [];
    for (let i = 1; i <= g.total; i++) if (!g.parts.has(i)) missing.push(i);
    if (missing.length > 0) {
      throw new Error(`Missing part(s) ${missing.join(', ')} of ${g.total}. Upload all parts together.`);
    }

    const filename = key.split('::')[0];
    const chunks: Uint8Array[] = [];
    for (let i = 1; i <= g.total; i++) {
      onProgress?.(60 + Math.round((i / g.total) * 35), `Assembling part ${i} of ${g.total}...`);
      const part = g.parts.get(i)!;
      let payload = part.payload;
      if (part.encrypted) {
        if (!password) throw new Error(`'${filename}' is password-protected. Enter the password to decode.`);
        payload = await decryptBytes(payload, password);
      }
      chunks.push(payload);
    }

    const total = chunks.reduce((a, c) => a + c.length, 0);
    const assembled = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { assembled.set(c, off); off += c.length; }

    const gotSha = await sha256(assembled);
    if (!bytesEqual(gotSha, g.sha)) {
      throw new Error(`Full-file checksum mismatch for '${filename}' — data is corrupted`);
    }

    onProgress?.(100, 'Done');
    return { filename, mime: g.mime || 'application/octet-stream', bytes: assembled };
  }

  throw new Error('No complete file found in the provided images');
}
