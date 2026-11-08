/**
 * Endpoint de salud — sin autenticación.
 * GET /api/health → { ok: true, version: "x.y.z", ts: "..." }
 */
import type { VercelRequest, VercelResponse } from "./_types.js";
import { VERSION } from "./_version.js";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, version: VERSION, ts: new Date().toISOString() });
}
