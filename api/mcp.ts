/**
 * Instagram MCP — Vercel Serverless Endpoint
 * Protocolo: JSON-RPC 2.0 (MCP over HTTP)
 * Autenticación (una de las dos):
 *   - Header  Authorization: Bearer <MCP_SECRET>      (clientes que permiten headers)
 *   - URL     https://<proyecto>.vercel.app/mcp/<MCP_SECRET>  (conector de la app de Claude,
 *             que no deja agregar headers; vercel.json reescribe esa ruta a /api/mcp)
 *   La clave se compara a tiempo constante y nunca se devuelve ni se registra.
 *
 * Herramientas disponibles:
 *   list_recent_media · get_media_insights · get_account_insights
 *   analyze_viral_patterns · submit_reel · finalize_reel
 *
 * Publicar un Reel (dos pasos para respetar el timeout de 10s de Vercel Hobby):
 *   1. submit_reel(video_url, caption)  → devuelve container_id
 *   2. finalize_reel(container_id)       → esperar 30-60s antes de llamarlo
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, timingSafeEqual } from "node:crypto";

// ─── Entorno ──────────────────────────────────────────────────────────────────
const IG_USER_ID = process.env.IG_USER_ID!;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN!;
const IG_API_VERSION = process.env.IG_API_VERSION ?? "v22.0";
const MCP_SECRET = process.env.MCP_SECRET!;
const BASE = `https://graph.instagram.com/${IG_API_VERSION}`;

// ─── Seguridad ────────────────────────────────────────────────────────────────
/** Error de la API de Instagram: su mensaje es seguro de mostrar (sin token). */
class IgError extends Error {}

/** Borra el token de cualquier texto antes de mostrarlo o registrarlo. */
const scrub = (t: string) => (IG_ACCESS_TOKEN ? t.split(IG_ACCESS_TOKEN).join("***") : t);

/** Compara dos claves a tiempo constante (hash previo: mismo largo siempre). */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Los IDs de Instagram son solo dígitos: evita que un argumento cambie la ruta pedida. */
function igId(v: unknown, campo: string): string {
  const s = String(v ?? "").trim();
  if (!/^\d{5,25}$/.test(s)) throw new IgError(`${campo} inválido: debe ser un ID numérico de Instagram.`);
  return s;
}

/** Solo URLs https públicas para videos y portadas. */
function httpsUrl(v: unknown, campo: string): string {
  let u: URL;
  try { u = new URL(String(v ?? "")); } catch { throw new IgError(`${campo} inválido.`); }
  if (u.protocol !== "https:") throw new IgError(`${campo} debe empezar con https://`);
  return u.toString();
}

// ─── Instagram API ─────────────────────────────────────────────────────────────
async function ig(path: string, method = "GET", body?: object): Promise<any> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const sep = url.includes("?") ? "&" : "?";
  const full = `${url}${sep}access_token=${IG_ACCESS_TOKEN}`;

  const res = await fetch(full, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000), // margen antes del corte de 10s de Vercel
  });

  const data = (await res.json()) as any;
  if (data?.error) throw new IgError(`Instagram: ${data.error.message} (code ${data.error.code})`);
  return data;
}

const horaAR = (ts: string) =>
  new Date(ts).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// ─── Insights helpers ─────────────────────────────────────────────────────────
const REEL_METRICS = [
  "views", "reach", "likes", "comments", "shares", "saved", "total_interactions",
  "ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate",
].join(",");
const FEED_METRICS = [
  "views", "reach", "likes", "comments", "shares", "saved", "total_interactions",
  "follows", "profile_visits",
].join(",");

async function fetchInsightsFor(mediaId: string): Promise<Record<string, any>> {
  const media = await ig(`/${mediaId}?fields=media_type,media_product_type`);
  const isReel = media.media_product_type === "REELS" || media.media_type === "VIDEO";
  try {
    const data = await ig(`/${mediaId}/insights?metric=${isReel ? REEL_METRICS : FEED_METRICS}`);
    const out: Record<string, any> = {};
    for (const m of data.data ?? []) {
      const v = m.values?.[0]?.value ?? m.total_value?.value ?? "N/A";
      out[m.name] =
        m.name === "ig_reels_avg_watch_time" && typeof v === "number"
          ? `${(v / 1000).toFixed(1)}s`
          : v;
    }
    return out;
  } catch {
    // Fallback: métricas básicas si las avanzadas fallan
    const data = await ig(`/${mediaId}/insights?metric=views,reach,likes,comments,shares,saved`);
    const out: Record<string, any> = {};
    for (const m of data.data ?? []) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? "N/A";
    return out;
  }
}

// ─── Definición de herramientas (schema MCP) ──────────────────────────────────
const TOOLS = [
  {
    name: "list_recent_media",
    description: "Lista los últimos posts publicados con likes, comentarios y link.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Cantidad de posts (máx 20)", default: 10 },
      },
    },
  },
  {
    name: "get_media_insights",
    description:
      "Estadísticas de un post o Reel: vistas, alcance, shares, guardados, tiempo de visualización.",
    inputSchema: {
      type: "object",
      properties: { media_id: { type: "string", description: "ID del post de Instagram" } },
      required: ["media_id"],
    },
  },
  {
    name: "get_account_insights",
    description: "Estadísticas generales de la cuenta: alcance, vistas, seguidores, interacciones.",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["day", "week", "days_28"],
          description: "Período de tiempo",
          default: "week",
        },
      },
    },
  },
  {
    name: "analyze_viral_patterns",
    description:
      "Rankea los últimos 8 Reels por rendimiento real (vistas, shares, guardados, retención) y detecta patrones.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "submit_reel",
    description:
      "Envía un Reel a Instagram para procesamiento. Requiere URL pública del MP4. " +
      "Devuelve container_id para completar la publicación con finalize_reel 30-60s después.",
    inputSchema: {
      type: "object",
      properties: {
        video_url: { type: "string", description: "URL pública del MP4 (9:16, máx 90s)" },
        caption: { type: "string", description: "Texto del post con hashtags" },
        cover_url: { type: "string", description: "URL de la imagen de portada (opcional)" },
        share_to_feed: {
          type: "boolean",
          description: "Mostrar también en el feed (default true)",
          default: true,
        },
      },
      required: ["video_url", "caption"],
    },
  },
  {
    name: "finalize_reel",
    description:
      "Verifica si el video terminó de procesar y lo publica. Llamar 30-60s después de submit_reel.",
    inputSchema: {
      type: "object",
      properties: {
        container_id: { type: "string", description: "ID devuelto por submit_reel" },
      },
      required: ["container_id"],
    },
  },
];

// ─── Handlers de cada herramienta ────────────────────────────────────────────
async function handleListRecentMedia({ limit = 10 }: any): Promise<string> {
  const data = await ig(
    `/${IG_USER_ID}/media?fields=id,media_type,media_product_type,timestamp,caption,like_count,comments_count,permalink&limit=${Math.max(1, Math.min(Math.floor(Number(limit)) || 10, 20))}`
  );
  const lines = (data.data ?? []).map((m: any) => {
    const kind = m.media_product_type === "REELS" ? "REEL" : m.media_type;
    const cap = (m.caption ?? "").split("\n")[0].slice(0, 90);
    return (
      `📌 ${m.id} | ${kind} | ${m.timestamp?.slice(0, 10)} ${horaAR(m.timestamp)}\n` +
      `   ❤️ ${m.like_count ?? 0} · 💬 ${m.comments_count ?? 0}\n` +
      `   🔗 ${m.permalink}\n   ${cap}`
    );
  });
  return lines.join("\n\n") || "No hay publicaciones.";
}

async function handleGetMediaInsights({ media_id: raw }: any): Promise<string> {
  const media_id = igId(raw, "media_id");
  const ins = await fetchInsightsFor(media_id);
  const lines = Object.entries(ins).map(([k, v]) => `${k}: ${v}`);
  return `📊 Insights de ${media_id}:\n${lines.join("\n")}`;
}

async function handleGetAccountInsights({ period = "week" }: any): Promise<string> {
  const days = period === "day" ? 1 : period === "week" ? 7 : 28;
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  const lines: string[] = [];

  try {
    const totals = await ig(
      `/${IG_USER_ID}/insights?metric=views,reach,profile_views,accounts_engaged,total_interactions,likes,comments,shares,saves,follows_and_unfollows&period=day&metric_type=total_value&since=${since}&until=${until}`
    );
    for (const m of totals.data ?? []) lines.push(`${m.name}: ${m.total_value?.value ?? "N/A"}`);
  } catch (e: any) {
    lines.push(`(insights de cuenta no disponibles: ${e.message})`);
  }

  const me = await ig(
    `/me?fields=username,name,biography,website,followers_count,follows_count,media_count`
  );
  lines.push(
    `followers_count: ${me.followers_count}`,
    `following: ${me.follows_count}`,
    `media_count: ${me.media_count}`,
    "",
    "PERFIL",
    `nombre: ${me.name ?? ""}`,
    `bio: ${(me.biography ?? "").replace(/\n/g, " / ")}`,
    `web: ${me.website ?? ""}`
  );
  return `📈 @${me.username} — últimos ${days} días:\n${lines.join("\n")}`;
}

async function handleAnalyzeViral(): Promise<string> {
  const media = await ig(
    `/${IG_USER_ID}/media?fields=id,media_type,media_product_type,timestamp,caption,like_count,comments_count,permalink&limit=20`
  );
  const reels = (media.data ?? [])
    .filter((m: any) => m.media_product_type === "REELS" || m.media_type === "VIDEO")
    .slice(0, 8); // Limitar a 8 para el timeout de 10s de Vercel Hobby

  if (reels.length === 0) return "No hay Reels publicados todavía.";

  // Insights en paralelo (máx 4 simultáneos)
  const BATCH = 4;
  const insResults: any[] = [];
  for (let i = 0; i < reels.length; i += BATCH) {
    const batch = reels.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((p: any) => fetchInsightsFor(p.id)));
    insResults.push(...results);
  }

  const enriched = reels
    .map((p: any, i: number) => {
      const ins = insResults[i]?.status === "fulfilled" ? insResults[i].value : {};
      const n = (k: string, fb = 0) => Number(ins[k] ?? fb) || 0;
      const views = n("views"),
        reach = n("reach"),
        shares = n("shares"),
        saved = n("saved");
      const likes = n("likes", p.like_count),
        comments = n("comments", p.comments_count);
      const score = views + shares * 20 + saved * 15 + comments * 5 + likes * 2;
      const engRate = reach > 0 ? ((likes + comments + shares + saved) / reach) * 100 : 0;
      return {
        id: p.id,
        timestamp: p.timestamp,
        caption: p.caption ?? "",
        permalink: p.permalink ?? "",
        views, reach, shares, saved, likes, comments,
        avgWatch: String(ins.ig_reels_avg_watch_time ?? "N/A"),
        skip: ins.reels_skip_rate != null ? `${Number(ins.reels_skip_rate).toFixed(1)}%` : "N/A",
        score, engRate,
      };
    })
    .sort((a, b) => b.score - a.score);

  const ranking = enriched
    .map(
      (p, i) =>
        `#${i + 1} — score ${p.score}  |  ${p.timestamp.slice(0, 10)} ${horaAR(p.timestamp)}\n` +
        `   👁 ${p.views} · 📡 ${p.reach} · ❤️ ${p.likes} · 💬 ${p.comments} · 🔁 ${p.shares} · 🔖 ${p.saved}\n` +
        `   ⏱ ${p.avgWatch} promedio · skip ${p.skip} · engagement ${p.engRate.toFixed(1)}%\n` +
        `   📝 ${p.caption.split("\n")[0].slice(0, 100)}\n   🔗 ${p.permalink}`
    )
    .join("\n\n");

  const N = enriched.length;
  const avg = (k: keyof typeof enriched[0]) =>
    (enriched.reduce((a, p) => a + Number(p[k] || 0), 0) / N).toFixed(1);
  const top = enriched[0];

  const hints: string[] = [];
  if (top.shares > top.saved) hints.push("Tu mejor Reel se COMPARTE más → gancho por identificación/alarma. Repetí esa apertura.");
  else if (top.saved > top.shares) hints.push("Tu mejor Reel se GUARDA más → funciona como referencia. Hacé más tutoriales/pasos.");
  if (top.comments >= 5) hints.push(`El #1 generó ${top.comments} comentarios → la CTA está convirtiendo. Mantenela.`);
  if (top.reach > 0 && top.views / top.reach > 1.3) hints.push("La gente ve el #1 más de una vez → contenido tipo pasos/checklist.");
  hints.push(`Hook ganador: "${top.caption.split("\n")[0].slice(0, 90)}"`);

  return (
    `🔥 RANKING DE REELS (${N} analizados)\n\n${ranking}\n\n` +
    `📊 PROMEDIOS: ${avg("views")} vistas · ${avg("reach")} alcance · ${avg("shares")} shares · ${avg("saved")} guardados · ${avg("engRate")}% engagement\n\n` +
    `💡 PATRONES:\n${hints.map((h) => `• ${h}`).join("\n")}`
  );
}

async function handleSubmitReel({
  video_url,
  caption,
  cover_url,
  share_to_feed = true,
}: any): Promise<string> {
  const params: any = {
    media_type: "REELS",
    video_url: httpsUrl(video_url, "video_url"),
    caption: String(caption ?? "").slice(0, 2200), // límite de Instagram
    share_to_feed: share_to_feed !== false,
  };
  if (cover_url) params.cover_url = httpsUrl(cover_url, "cover_url");

  const { id: containerId } = await ig(`/${IG_USER_ID}/media`, "POST", params);
  return (
    `🎬 Reel enviado a Instagram para procesar.\n` +
    `Container ID: ${containerId}\n\n` +
    `⏳ Esperá 30-60 segundos y llamá:\n  finalize_reel("${containerId}")`
  );
}

async function handleFinalizeReel({ container_id: raw }: any): Promise<string> {
  const container_id = igId(raw, "container_id");
  const { status_code } = await ig(`/${container_id}?fields=status_code`);

  if (status_code === "IN_PROGRESS") {
    return `⏳ Aún procesando… Reintentá en 15-30 segundos:\n  finalize_reel("${container_id}")`;
  }
  if (status_code === "ERROR") {
    return `❌ Error al procesar. Verificá: URL pública accesible, formato MP4, relación 9:16, máx 90s.`;
  }
  if (status_code !== "FINISHED") {
    return `⚠️ Estado desconocido: ${status_code}. Esperá y reintentá.`;
  }

  const { id: mediaId } = await ig(`/${IG_USER_ID}/media_publish`, "POST", {
    creation_id: container_id,
  });
  const { permalink } = await ig(`/${mediaId}?fields=permalink`);
  return `✅ Reel publicado!\nMedia ID: ${mediaId}\n🔗 ${permalink}`;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────
async function callTool(name: string, args: any): Promise<string> {
  switch (name) {
    case "list_recent_media":      return handleListRecentMedia(args);
    case "get_media_insights":     return handleGetMediaInsights(args);
    case "get_account_insights":   return handleGetAccountInsights(args);
    case "analyze_viral_patterns": return handleAnalyzeViral();
    case "submit_reel":            return handleSubmitReel(args);
    case "finalize_reel":          return handleFinalizeReel(args);
    default: throw new IgError("Herramienta desconocida.");
  }
}

// ─── Handler principal de Vercel ─────────────────────────────────────────────
const PROTOCOLOS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Sin CORS: lo llaman servidores (app de Claude), no páginas web en un navegador.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Autenticación: header Bearer o clave en la ruta /mcp/<clave>
  const header = String(req.headers["authorization"] ?? "");
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const fromPath = typeof req.query.key === "string" ? req.query.key : "";
  const given = bearer || fromPath;
  if (!MCP_SECRET || MCP_SECRET.length < 32 || !given || !sameSecret(given, MCP_SECRET)) {
    return res
      .status(401)
      .json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } });
  }

  const { method, params, id } = (req.body as any) ?? {};

  try {
    if (method === "initialize") {
      const pedido = params?.protocolVersion;
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: PROTOCOLOS.includes(pedido) ? pedido : PROTOCOLOS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "instagram-mcp-cloud", version: "1.1.0" },
        },
      });
    }

    // Notificaciones: no llevan respuesta
    if (typeof method === "string" && method.startsWith("notifications/")) return res.status(202).end();

    if (method === "ping") return res.json({ jsonrpc: "2.0", id, result: {} });

    if (method === "tools/list") {
      return res.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    }

    if (method === "tools/call") {
      const { name: toolName, arguments: args } = params ?? {};
      const text = await callTool(toolName, args ?? {});
      return res.json({
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text }] },
      });
    }

    return res.status(400).json({
      jsonrpc: "2.0", id,
      error: { code: -32601, message: "Método no soportado" },
    });
  } catch (e: any) {
    // Errores de Instagram o de validación: se muestran (sin token).
    // Cualquier otro: mensaje genérico, detalle solo en los logs privados de Vercel.
    const publico = e instanceof IgError;
    if (!publico) console.error("mcp error:", scrub(String(e?.stack ?? e)));
    const text = publico
      ? `❌ ${scrub(e.message)}`
      : e?.name === "TimeoutError"
        ? "❌ Instagram tardó demasiado en responder. Prueba de nuevo en un momento."
        : "❌ Error interno del servidor. Prueba de nuevo en un momento.";
    return res.json({
      jsonrpc: "2.0", id,
      result: { content: [{ type: "text", text }], isError: true },
    });
  }
}
