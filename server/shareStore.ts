/**
 * BeyondMesh share links — stateless, Telegram-backed blob storage.
 *
 * There is no database. The "link" itself is a self-contained, HMAC-signed
 * token that carries the Telegram file_id of the uploaded blob. To fetch a
 * share, we just verify the signature and ask Telegram for the file back —
 * so this works identically on a long-running Express server (Render/Koyeb)
 * or a stateless Vercel serverless function, since nothing is kept on disk
 * or in memory between requests.
 *
 * Wire format of a share id: `${base64url(json)}.${hmac-sha256-hex[0:16]}`
 * json = { m: module, fn: filename, mi: mime, id: telegram file_id }
 */

import crypto from 'node:crypto';

export type ShareModule = 'qr' | 'sound' | 'vault';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '';
// Falls back to the bot token so this works out of the box, but set a
// dedicated SHARE_SECRET in production so rotating the bot token doesn't
// invalidate every link that's already been sent out.
const SHARE_SECRET = process.env.SHARE_SECRET || BOT_TOKEN || 'beyondmesh-dev-secret';

export interface ShareTokenPayload {
  m: ShareModule;
  fn: string;
  mi: string;
  id: string; // telegram file_id
}

function sign(token: string): string {
  return crypto.createHmac('sha256', SHARE_SECRET).update(token).digest('hex').slice(0, 16);
}

function encodeToken(payload: ShareTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeToken(token: string): ShareTokenPayload {
  const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.m) {
    throw new Error('Malformed share link.');
  }
  return parsed;
}

async function telegramUpload(bytes: Buffer, filename: string, mime: string): Promise<string> {
  if (!BOT_TOKEN || !CHANNEL_ID) {
    throw new Error('Share links are not configured on the server (missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID).');
  }
  const form = new FormData();
  form.append('chat_id', CHANNEL_ID);
  form.append('document', new Blob([bytes], { type: mime || 'application/octet-stream' }), filename || 'file');

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: form as any,
  });
  const json: any = await res.json();
  if (!json.ok) throw new Error(json.description || 'Telegram upload failed.');
  return json.result.document.file_id as string;
}

async function telegramDownload(fileId: string): Promise<Buffer> {
  if (!BOT_TOKEN) {
    throw new Error('Share links are not configured on the server (missing TELEGRAM_BOT_TOKEN).');
  }
  const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const info: any = await infoRes.json();
  if (!info.ok) throw new Error(info.description || 'Could not locate the shared file — the link may be invalid.');

  const filePath = info.result.file_path as string;
  const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
  if (!fileRes.ok) throw new Error('Failed to download the shared file from storage.');
  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export interface CreateShareInput {
  module: ShareModule;
  filename?: string;
  mime?: string;
  /** Base64-encoded payload bytes. */
  data: string;
}

export interface CreateShareResult {
  id: string;
  url: string;
}

const VALID_MODULES: ShareModule[] = ['qr', 'sound', 'vault'];

/** Handles the POST /api/share body → uploads to Telegram → returns a share id + link. */
export async function createShare(input: CreateShareInput, appBaseUrl: string): Promise<CreateShareResult> {
  const { module, filename, mime, data } = input;
  if (!module || !VALID_MODULES.includes(module)) {
    throw Object.assign(new Error('Invalid or missing module.'), { status: 400 });
  }
  if (typeof data !== 'string' || !data) {
    throw Object.assign(new Error('Missing data to share.'), { status: 400 });
  }

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) {
    throw Object.assign(new Error('Empty payload.'), { status: 400 });
  }
  // Generous but bounded — actual platform limits (e.g. Vercel's request body
  // cap) may be lower than this and will reject the upload earlier.
  const MAX_BYTES = 45 * 1024 * 1024;
  if (bytes.length > MAX_BYTES) {
    throw Object.assign(new Error('File is too large to share via link (45MB limit).'), { status: 413 });
  }

  const safeFilename = (filename || 'beyondmesh-share').toString().slice(0, 200);
  const safeMime = (mime || 'application/octet-stream').toString().slice(0, 100);

  const fileId = await telegramUpload(bytes, safeFilename, safeMime);
  const token = encodeToken({ m: module, fn: safeFilename, mi: safeMime, id: fileId });
  const sig = sign(token);
  const shareId = `${token}.${sig}`;
  const base = appBaseUrl.replace(/\/$/, '');
  const url = `${base}/?share=${shareId}&m=${module}`;

  return { id: shareId, url };
}

export interface FetchShareResult {
  module: ShareModule;
  filename: string;
  mime: string;
  /** Base64-encoded payload bytes. */
  data: string;
}

/** Handles GET /api/share/:id → verifies signature → pulls the blob back from Telegram. */
export async function fetchShare(rawId: string): Promise<FetchShareResult> {
  const dot = rawId.lastIndexOf('.');
  if (dot <= 0) {
    throw Object.assign(new Error('Malformed share link.'), { status: 400 });
  }
  const token = rawId.slice(0, dot);
  const sig = rawId.slice(dot + 1);
  if (sign(token) !== sig) {
    throw Object.assign(new Error('Invalid or tampered share link.'), { status: 400 });
  }

  const { m, fn, mi, id: fileId } = decodeToken(token);
  const bytes = await telegramDownload(fileId);
  return { module: m, filename: fn, mime: mi, data: bytes.toString('base64') };
}
