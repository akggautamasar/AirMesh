import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createShare } from '../server/shareStore.js';

// Node.js is the default runtime for /api functions (unless this exported
// config sets `runtime: 'edge'`), so no config export is needed here — the
// share backend uses Node's crypto/Buffer and must stay off Edge anyway.
// Runtime version + maxDuration are already set project-wide in vercel.json.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const appUrl = process.env.APP_URL || `https://${req.headers.host || 'beyondmesh.vercel.app'}`;
    const result = await createShare(body as any, appUrl);
    res.status(200).json(result);
  } catch (err: unknown) {
    console.error('share upload error:', err);
    const status = typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : 500;
    const message = err instanceof Error ? err.message : 'Failed to create share link.';
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  }
}
