export type ShareModule = 'qr' | 'sound' | 'vault';

export interface ShareUploadResult {
  id: string;
  url: string;
}

export interface ShareFetchResult {
  module: ShareModule;
  filename: string;
  mime: string;
  /** Base64-encoded payload bytes. */
  data: string;
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const j = await res.json();
    if (j && j.error) return j.error;
  } catch {
    // ignore — not JSON
  }
  return fallback;
}

/** Uploads a payload (already base64-encoded) and returns a shareable link. */
export async function uploadShare(
  module: ShareModule,
  filename: string,
  mime: string,
  dataBase64: string
): Promise<ShareUploadResult> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module, filename, mime, data: dataBase64 }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, `Failed to create share link (${res.status}).`));
  }
  return res.json();
}

/** Pulls a share id out of a pasted full URL, or returns the input unchanged if it's already a bare id. */
export function extractShareId(input: string): string {
  const trimmed = input.trim();
  const queryMatch = trimmed.match(/[?&]share=([^&]+)/);
  if (queryMatch) return decodeURIComponent(queryMatch[1]);

  try {
    const u = new URL(trimmed);
    const fromQuery = u.searchParams.get('share');
    if (fromQuery) return fromQuery;
  } catch {
    // not a full URL — treat as a bare id
  }
  return trimmed;
}

/** Resolves a share link (or bare id) back into its payload. */
export async function fetchShare(idOrUrl: string): Promise<ShareFetchResult> {
  const id = extractShareId(idOrUrl);
  if (!id) throw new Error('Enter a share link first.');
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Share link not found or expired.'));
  }
  return res.json();
}

/** Reads `?share=` (and optionally `&m=`) from the current URL, for auto-decode-on-open. */
export function getShareParamsFromLocation(): { share: string; module: ShareModule | null } | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const share = params.get('share');
  if (!share) return null;
  const m = params.get('m');
  const module: ShareModule | null = m === 'qr' || m === 'sound' || m === 'vault' ? m : null;
  return { share, module };
}

/** Removes ?share=&m= from the address bar without a navigation/reload, so refreshing doesn't re-trigger it. */
export function clearShareParamsFromLocation() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('share');
  url.searchParams.delete('m');
  window.history.replaceState({}, '', url.toString());
}

// ── base64 helpers (module-agnostic, mirrors utils/dataUtils.ts) ──────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
