/**
 * Optional end-to-end payload encryption for BeyondMesh.
 *
 * Ported from AirVault's Python AES-256-GCM + PBKDF2 scheme so both
 * channels (SoundMesh audio packets and QRMesh chunk sequences) can
 * carry an optionally password-protected payload.
 *
 * Wire format (all binary, then base64-encoded for transport):
 *   salt   16 bytes   PBKDF2 salt
 *   iv     12 bytes   AES-GCM nonce
 *   ct      N bytes   ciphertext + 16-byte GCM auth tag
 *
 * Anyone without the password only ever sees random-looking base64 —
 * the sender can share it with "anyone" and only someone with the
 * password can recover the original text.
 */

const PBKDF2_ITERATIONS = 260_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encrypt UTF-8 text with a password. Returns a base64 blob safe to embed in a packet. */
export async function encryptText(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const ctBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const ct = new Uint8Array(ctBuffer);
  const out = new Uint8Array(salt.length + iv.length + ct.length);
  out.set(salt, 0);
  out.set(iv, salt.length);
  out.set(ct, salt.length + iv.length);
  return bytesToBase64(out);
}

/** Decrypt a base64 blob produced by encryptText. Throws on wrong password / corruption. */
export async function decryptText(blobBase64: string, password: string): Promise<string> {
  const raw = base64ToBytes(blobBase64);
  if (raw.length < SALT_BYTES + IV_BYTES + 16) {
    throw new Error('Encrypted payload is too short — corrupted data');
  }
  const salt = raw.slice(0, SALT_BYTES);
  const iv = raw.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ct = raw.slice(SALT_BYTES + IV_BYTES);
  const key = await deriveKey(password, salt);
  try {
    const ptBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(ptBuffer);
  } catch {
    throw new Error('Wrong password or corrupted data');
  }
}

/** Raw bytes variant, used by QRMesh for encrypting arbitrary chunked payloads. */
export async function encryptBytes(data: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const ctBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const ct = new Uint8Array(ctBuffer);
  const out = new Uint8Array(salt.length + iv.length + ct.length);
  out.set(salt, 0);
  out.set(iv, salt.length);
  out.set(ct, salt.length + iv.length);
  return out;
}

export async function decryptBytes(data: Uint8Array, password: string): Promise<Uint8Array> {
  if (data.length < SALT_BYTES + IV_BYTES + 16) {
    throw new Error('Encrypted payload is too short — corrupted data');
  }
  const salt = data.slice(0, SALT_BYTES);
  const iv = data.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ct = data.slice(SALT_BYTES + IV_BYTES);
  const key = await deriveKey(password, salt);
  try {
    const ptBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new Uint8Array(ptBuffer);
  } catch {
    throw new Error('Wrong password or corrupted data');
  }
}
