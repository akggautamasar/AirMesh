/**
 * Minimal, dependency-free GIF89a encoder/decoder.
 *
 * QRMesh QR frames are near-monochrome (a couple of colors), so a simple
 * global-palette + standard LZW encoder is both small and effective — no
 * need to pull in an external GIF library. Used for:
 *   - "Download as GIF": packaging a whole QR sequence into one animated
 *     GIF (instead of a zip of separate PNGs) that can be shared as a
 *     single file.
 *   - Decoding: an uploaded GIF is split back into its frames and each
 *     frame is run through the normal QR decode pipeline.
 */

// ── palette ─────────────────────────────────────────────────────────────

interface Quantized {
  palette: [number, number, number][];
  frameIndices: Uint8Array[]; // one Uint8Array of palette indices per frame
}

function quantizeFrames(frames: ImageData[]): Quantized {
  const colorToIndex = new Map<number, number>();
  const palette: [number, number, number][] = [];

  const keyOf = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

  const nearestIndex = (r: number, g: number, b: number): number => {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const [pr, pg, pb] = palette[i];
      const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  };

  const frameIndices: Uint8Array[] = frames.map((frame) => {
    const { data, width, height } = frame;
    const indices = new Uint8Array(width * height);
    for (let p = 0; p < width * height; p++) {
      const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
      const key = keyOf(r, g, b);
      let idx = colorToIndex.get(key);
      if (idx === undefined) {
        if (palette.length < 256) {
          idx = palette.length;
          palette.push([r, g, b]);
          colorToIndex.set(key, idx);
        } else {
          idx = nearestIndex(r, g, b);
        }
      }
      indices[p] = idx;
    }
    return indices;
  });

  if (palette.length === 0) palette.push([0, 0, 0]);
  return { palette, frameIndices };
}

// ── LZW (GIF variant) ──────────────────────────────────────────────────

function lzwEncode(minCodeSize: number, indices: Uint8Array): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  const out: number[] = [];
  let bitBuf = 0, bitCount = 0;
  const emit = (code: number, codeSize: number) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCount -= 8;
    }
  };

  let dict!: Map<string, number>;
  let nextCode!: number;
  let codeSize!: number;
  const resetDict = () => {
    dict = new Map();
    for (let c = 0; c < clearCode; c++) dict.set(String(c), c);
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  };
  resetDict();
  emit(clearCode, codeSize);

  let w: string | null = null;
  for (let i = 0; i < indices.length; i++) {
    const k = indices[i];
    const wk: string = w === null ? String(k) : w + ',' + k;
    if (dict.has(wk)) {
      w = wk;
    } else {
      emit(dict.get(w!)!, codeSize);
      if (nextCode < 4096) {
        dict.set(wk, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(clearCode, codeSize);
        resetDict();
        emit(clearCode, codeSize);
      }
      w = String(k);
    }
  }
  if (w !== null) emit(dict.get(w)!, codeSize);
  emit(eoiCode, codeSize);
  if (bitCount > 0) out.push(bitBuf & 0xff);

  return new Uint8Array(out);
}

function lzwDecode(minCodeSize: number, data: Uint8Array, expectedPixels: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let bitPos = 0;
  const readCode = (codeSize: number): number => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIndex = bitPos >> 3;
      const bit = byteIndex < data.length ? (data[byteIndex] >> (bitPos & 7)) & 1 : 0;
      code |= bit << i;
      bitPos++;
    }
    return code;
  };

  const out = new Uint8Array(expectedPixels);
  let outPos = 0;

  let dict!: number[][];
  let nextCode!: number;
  let codeSize!: number;
  const resetDict = () => {
    dict = [];
    for (let c = 0; c < clearCode; c++) dict.push([c]);
    dict.push([]); // clearCode placeholder
    dict.push([]); // eoiCode placeholder
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  };
  resetDict();

  let prevEntry: number[] | null = null;
  while (outPos < expectedPixels) {
    const code = readCode(codeSize);
    if (code === clearCode) { resetDict(); prevEntry = null; continue; }
    if (code === eoiCode) break;

    let entry: number[];
    if (code < dict.length && dict[code] && dict[code].length > 0) {
      entry = dict[code];
    } else if (code === nextCode && prevEntry) {
      entry = [...prevEntry, prevEntry[0]];
    } else {
      break; // corrupt stream — stop gracefully with whatever we have
    }

    for (let i = 0; i < entry.length && outPos < expectedPixels; i++) out[outPos++] = entry[i];

    if (prevEntry && nextCode < 4096) {
      dict[nextCode] = [...prevEntry, entry[0]];
      nextCode++;
      // "Early change": the decoder's dictionary always trails the encoder's by exactly
      // one insertion (the encoder adds an entry right after its very first emitted code;
      // the decoder can't — it has no "previous" entry yet on its first code). To keep the
      // two code-size clocks in sync, the decoder must bump one code sooner than the naive
      // "table is full" threshold.
      if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    }
    prevEntry = entry;
  }

  return out;
}

// sub-block helpers (GIF splits data payloads into <=255-byte chunks)
function writeSubBlocks(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const len = Math.min(255, bytes.length - i);
    out.push(len);
    for (let j = 0; j < len; j++) out.push(bytes[i + j]);
  }
  out.push(0);
  return out;
}

// ── encoder ─────────────────────────────────────────────────────────────

export function encodeGIF(frames: ImageData[], delayMs: number): Blob {
  if (frames.length === 0) throw new Error('No frames to encode');
  const width = frames[0].width;
  const height = frames[0].height;

  const { palette, frameIndices } = quantizeFrames(frames);
  const gctSizeExp = Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.length))) - 1); // 2^(n+1) colors
  const gctColors = 1 << (gctSizeExp + 1);
  const minCodeSize = Math.max(2, gctSizeExp + 1);

  const bytes: number[] = [];
  const pushStr = (s: string) => { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); };
  const push16 = (v: number) => { bytes.push(v & 0xff, (v >> 8) & 0xff); };

  pushStr('GIF89a');
  push16(width);
  push16(height);
  bytes.push(0x80 | (gctSizeExp)); // global color table flag=1, color res=0, sort=0, size=gctSizeExp
  bytes.push(0); // background color index
  bytes.push(0); // pixel aspect ratio

  for (let i = 0; i < gctColors; i++) {
    const c = palette[i] || [0, 0, 0];
    bytes.push(c[0], c[1], c[2]);
  }

  // Netscape extension: loop forever
  pushStr('!\xFF\x0BNETSCAPE2.0');
  bytes.push(3, 1, 0, 0, 0);

  const delayCs = Math.max(2, Math.round(delayMs / 10));

  for (let f = 0; f < frames.length; f++) {
    // Graphic Control Extension
    bytes.push(0x21, 0xf9, 4, 0x04); // disposal=1 (do not dispose), no transparency
    push16(delayCs);
    bytes.push(0, 0);

    // Image Descriptor
    bytes.push(0x2c);
    push16(0); push16(0); push16(width); push16(height);
    bytes.push(0); // no local color table, not interlaced

    bytes.push(minCodeSize);
    const compressed = lzwEncode(minCodeSize, frameIndices[f]);
    for (const b of writeSubBlocks(compressed)) bytes.push(b);
  }

  bytes.push(0x3b); // trailer
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}

// ── decoder ─────────────────────────────────────────────────────────────

export async function decodeGIF(source: Blob): Promise<{ width: number; height: number; frames: ImageData[] }> {
  const buf = new Uint8Array(await source.arrayBuffer());
  let pos = 0;
  const u8 = () => buf[pos++];
  const u16 = () => { const v = buf[pos] | (buf[pos + 1] << 8); pos += 2; return v; };

  const sig = new TextDecoder().decode(buf.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('Not a GIF file');
  pos = 6;

  const width = u16();
  const height = u16();
  const packed = u8();
  const gctFlag = (packed & 0x80) !== 0;
  const gctSize = 2 << (packed & 0x07);
  pos += 2; // bg color index, pixel aspect

  let globalPalette: [number, number, number][] = [];
  if (gctFlag) {
    globalPalette = [];
    for (let i = 0; i < gctSize; i++) {
      globalPalette.push([buf[pos], buf[pos + 1], buf[pos + 2]]);
      pos += 3;
    }
  }

  const readSubBlocks = (): Uint8Array => {
    const chunks: number[] = [];
    while (true) {
      const len = u8();
      if (len === 0) break;
      for (let i = 0; i < len; i++) chunks.push(buf[pos++]);
    }
    return new Uint8Array(chunks);
  };

  const frames: ImageData[] = [];
  // running canvas we composite frames onto (disposal handling)
  const canvasBuf = new Uint8ClampedArray(width * height * 4);

  let gceDelay = 100;
  let gceTransparentIndex = -1;
  let gceTransparent = false;
  let gceDisposal = 0;

  while (pos < buf.length) {
    const blockType = u8();

    if (blockType === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        const blockSize = u8(); // should be 4
        const flags = u8();
        gceDisposal = (flags >> 2) & 0x07;
        gceTransparent = (flags & 0x01) !== 0;
        gceDelay = u16() * 10;
        gceTransparentIndex = u8();
        pos += Math.max(0, blockSize - 4); // safety
        u8(); // block terminator
      } else {
        readSubBlocks();
      }
    } else if (blockType === 0x2c) {
      const left = u16();
      const top = u16();
      const w = u16();
      const h = u16();
      const imgPacked = u8();
      const localFlag = (imgPacked & 0x80) !== 0;
      const interlaced = (imgPacked & 0x40) !== 0;
      const localSize = 2 << (imgPacked & 0x07);

      let palette = globalPalette;
      if (localFlag) {
        palette = [];
        for (let i = 0; i < localSize; i++) {
          palette.push([buf[pos], buf[pos + 1], buf[pos + 2]]);
          pos += 3;
        }
      }

      const minCodeSize = u8();
      const compressed = readSubBlocks();
      const indices = lzwDecode(minCodeSize, compressed, w * h);

      // de-interlace if needed
      const rowOrder: number[] = [];
      if (interlaced) {
        for (let r = 0; r < h; r += 8) rowOrder.push(r);
        for (let r = 4; r < h; r += 8) rowOrder.push(r);
        for (let r = 2; r < h; r += 4) rowOrder.push(r);
        for (let r = 1; r < h; r += 2) rowOrder.push(r);
      } else {
        for (let r = 0; r < h; r++) rowOrder.push(r);
      }

      // disposal: 2 = restore to background (clear this frame's rect first)
      if (gceDisposal === 2) {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const cIdx = ((top + y) * width + (left + x)) * 4;
            canvasBuf[cIdx] = 0; canvasBuf[cIdx + 1] = 0; canvasBuf[cIdx + 2] = 0; canvasBuf[cIdx + 3] = 0;
          }
        }
      }

      let srcRow = 0;
      for (const destRow of rowOrder) {
        for (let x = 0; x < w; x++) {
          const idx = indices[srcRow * w + x];
          if (gceTransparent && idx === gceTransparentIndex) continue;
          const c = palette[idx] || [0, 0, 0];
          const cIdx = ((top + destRow) * width + (left + x)) * 4;
          canvasBuf[cIdx] = c[0]; canvasBuf[cIdx + 1] = c[1]; canvasBuf[cIdx + 2] = c[2]; canvasBuf[cIdx + 3] = 255;
        }
        srcRow++;
      }

      frames.push(new ImageData(new Uint8ClampedArray(canvasBuf), width, height));
      gceTransparent = false;
      gceDisposal = 0;
    } else if (blockType === 0x3b) {
      break; // trailer
    } else {
      break; // unknown/corrupt — stop gracefully with whatever frames we decoded
    }
  }

  return { width, height, frames };
}
