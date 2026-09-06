import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchShare } from '../../server/shareStore.js';

// Node.js is the default runtime for /api functions (unless this exported
// config sets `runtime: 'edge'`), so no config export is needed here — the
// share backend uses Node's crypto/Buffer and must stay off Edge anyway.
// Runtime version + maxDuration are already set project-wide in vercel.json.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!rawId) {
      res.status(400).json({ error: 'Missing share id.' });
      return;
    }

    const result = await fetchShare(rawId);
    res.status(200).json(result);
  } catch (err: unknown) {
    console.error('share download error:', err);
    const status = typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : 500;
    const message = err instanceof Error ? err.message : 'Failed to fetch share.';
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  }
}
