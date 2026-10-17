/**
 * Endpoint de salud — sin autenticación.
 * GET /api/health → { ok: true, version: "1.0.0", ts: "..." }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, version: "1.0.0", ts: new Date().toISOString() });
}
