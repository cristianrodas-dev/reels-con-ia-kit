/**
 * Lógica de las herramientas de Instagram.
 * Este archivo se recarga automáticamente cuando cambia (sin reiniciar Claude).
 */

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

type Ctx = { userId: string; token: string; apiVersion: string };

let ctx: Ctx;

export function configure(c: Ctx) {
  ctx = c;
}

async function igRequest(endpoint: string, method = "GET", body?: object) {
  const base = `https://graph.instagram.com/${ctx.apiVersion}`;
  const url = endpoint.startsWith("http") ? endpoint : `${base}${endpoint}`;
  const separator = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${separator}access_token=${ctx.token}`;

  const res = await fetch(fullUrl, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json()) as any;
  if (data.error) throw new Error(`Instagram API: ${data.error.message}`);
  return data;
}

async function pollContainerStatus(containerId: string, maxWait = 180): Promise<void> {
  for (let i = 0; i < maxWait; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const { status_code } = await igRequest(`/${containerId}?fields=status_code`);
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR") throw new Error("Instagram no pudo procesar el video (formato/duración/URL inaccesible)");
  }
  throw new Error("Timeout esperando que Instagram procese el video");
}

/** Métricas por tipo de media (API v22). follows/profile_visits NO aplican a Reels. */
const REEL_METRICS = [
  "views", "reach", "likes", "comments", "shares", "saved", "total_interactions",
  "ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate",
];
const FEED_METRICS = [
  "views", "reach", "likes", "comments", "shares", "saved", "total_interactions",
  "follows", "profile_visits",
];

/** Pide insights; si Instagram rechaza alguna métrica, la quita y reintenta. */
async function fetchInsights(mediaId: string, metrics: string[]): Promise<any[]> {
  try {
    const data = await igRequest(`/${mediaId}/insights?metric=${metrics.join(",")}`);
    return data.data ?? [];
  } catch (e: any) {
    const msg: string = e.message ?? "";
    const bad = metrics.filter((m) => new RegExp(`\\b${m}\\b`).test(msg));
    if (bad.length && bad.length < metrics.length) {
      return fetchInsights(mediaId, metrics.filter((m) => !bad.includes(m)));
    }
    throw e;
  }
}

export async function getMediaInsights(mediaId: string): Promise<Record<string, number | string>> {
  const media = await igRequest(`/${mediaId}?fields=media_type,media_product_type`);
  const isReel = media.media_product_type === "REELS" || media.media_type === "VIDEO";
  const rows = await fetchInsights(mediaId, isReel ? REEL_METRICS : FEED_METRICS);

  const out: Record<string, number | string> = {};
  for (const m of rows) {
    const v = m.values?.[0]?.value ?? m.total_value?.value ?? "N/A";
    out[m.name] = m.name === "ig_reels_avg_watch_time" && typeof v === "number"
      ? `${(v / 1000).toFixed(1)}s`
      : v;
  }
  return out;
}

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

const horaAR = (ts: string) =>
  new Date(ts).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });

// ───────────────────────────── HANDLERS ─────────────────────────────

export async function handleTool(name: string, args: any): Promise<ToolResult> {
  switch (name) {
    case "publish_reel": return publishReel(args);
    case "upload_video": return uploadVideoTool(args);
    case "delete_video": return deleteVideoTool(args);
    case "get_media_insights": return mediaInsights(args);
    case "list_recent_media": return listRecent(args);
    case "get_account_insights": return accountInsights(args);
    case "analyze_viral_patterns": return analyzeViral();
    default: throw new Error(`Herramienta desconocida: ${name}`);
  }
}

// ───────────────────── Almacenamiento (Supabase Storage) ─────────────────────
// Instagram descarga el video desde una URL pública. Subimos el MP4 al bucket
// `reels` con la clave secreta (solo en .env); la lectura del bucket es pública.

function supabaseCfg() {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  const bucket = process.env.SUPABASE_BUCKET ?? "reels";
  if (!url || !key) throw new Error("Faltan SUPABASE_URL / SUPABASE_SECRET_KEY en el .env");
  return { url, key, bucket };
}

function safeName(p: string): string {
  const base = p.replace(/\\/g, "/").split("/").pop() ?? "reel.mp4";
  const ext = (base.match(/\.(mp4|png|jpe?g)$/i)?.[1] ?? "mp4").toLowerCase();
  const stem = base.replace(/\.(mp4|png|jpe?g)$/i, "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "reel";
  const stamp = new Date().toISOString().slice(0, 10);
  return `${stamp}-${stem}.${ext}`;
}

/** Tipo MIME según la extensión (el bucket acepta mp4, png y jpg). */
function mimeFor(name: string): string {
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  return "video/mp4";
}

export async function uploadVideo(localPath: string, name?: string): Promise<{ publicUrl: string; object: string }> {
  const fs = await import("fs");
  const { url, key, bucket } = supabaseCfg();
  if (!fs.existsSync(localPath)) throw new Error(`No existe el archivo: ${localPath}`);
  const object = name ?? safeName(localPath);
  const body = fs.readFileSync(localPath);
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${object}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": mimeFor(object), "x-upsert": "true" },
    body,
  });
  if (!res.ok) throw new Error(`Supabase upload ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { publicUrl: `${url}/storage/v1/object/public/${bucket}/${object}`, object };
}

export async function deleteVideo(object: string): Promise<void> {
  const { url, key, bucket } = supabaseCfg();
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${object}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (!res.ok) throw new Error(`Supabase delete ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function uploadVideoTool({ video_path, name }: any): Promise<ToolResult> {
  const { publicUrl, object } = await uploadVideo(video_path, name);
  return text(`☁️ Video subido.\nObjeto: ${object}\nURL pública: ${publicUrl}\n\nPara publicar: publish_reel con esa URL (o con la ruta local directamente).`);
}

async function deleteVideoTool({ object }: any): Promise<ToolResult> {
  await deleteVideo(object);
  return text(`🗑️ Eliminado del almacenamiento: ${object}`);
}

async function publishReel({ video_url, caption, cover_url, share_to_feed = true, keep_in_storage = false }: any): Promise<ToolResult> {
  // Acepta una URL pública o una ruta local: si es local, la sube primero.
  let uploaded: { publicUrl: string; object: string } | null = null;
  if (video_url && !/^https?:\/\//i.test(video_url)) {
    uploaded = await uploadVideo(video_url);
    video_url = uploaded.publicUrl;
  }
  const params: any = { media_type: "REELS", video_url, caption, share_to_feed };
  if (cover_url) params.cover_url = cover_url;

  const { id: containerId } = await igRequest(`/${ctx.userId}/media`, "POST", params);
  await pollContainerStatus(containerId);
  const { id: mediaId } = await igRequest(`/${ctx.userId}/media_publish`, "POST", { creation_id: containerId });

  const { permalink } = await igRequest(`/${mediaId}?fields=permalink`);

  // Instagram ya copió el video: lo sacamos del almacenamiento salvo que se pida conservarlo.
  let cleanup = "";
  if (uploaded && !keep_in_storage) {
    try { await deleteVideo(uploaded.object); cleanup = `\n🗑️ Copia temporal eliminada del almacenamiento (${uploaded.object}).`; }
    catch (e: any) { cleanup = `\n⚠️ No pude borrar la copia temporal: ${e.message}`; }
  }
  return text(`✅ Reel publicado!\nMedia ID: ${mediaId}\n🔗 ${permalink}${cleanup}`);
}

async function mediaInsights({ media_id }: any): Promise<ToolResult> {
  const ins = await getMediaInsights(media_id);
  const lines = Object.entries(ins).map(([k, v]) => `${k}: ${v}`);
  return text(`📊 Insights de ${media_id}:\n${lines.join("\n")}`);
}

async function listRecent({ limit = 10 }: any): Promise<ToolResult> {
  const data = await igRequest(
    `/${ctx.userId}/media?fields=id,media_type,media_product_type,timestamp,caption,like_count,comments_count,permalink&limit=${limit}`
  );
  const full = limit <= 5; // con pocos posts, mostrar el caption completo
  const lines = (data.data ?? []).map((m: any) => {
    const kind = m.media_product_type === "REELS" ? "REEL" : m.media_type;
    const cap = full ? (m.caption ?? "").slice(0, 1500) : (m.caption ?? "").split("\n")[0].slice(0, 90);
    return `📌 ${m.id} | ${kind} | ${m.timestamp?.slice(0, 10)} ${horaAR(m.timestamp)}\n` +
      `   ❤️ ${m.like_count ?? 0} · 💬 ${m.comments_count ?? 0}\n` +
      `   🔗 ${m.permalink}\n` +
      (full ? `   📝 CAPTION:\n${cap.split("\n").map((l: string) => "      " + l).join("\n")}` : `   ${cap}`);
  });
  return text(lines.join("\n\n") || "No hay publicaciones.");
}

async function accountInsights({ period = "week" }: any): Promise<ToolResult> {
  const days = period === "day" ? 1 : period === "week" ? 7 : 28;
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;

  const lines: string[] = [];
  try {
    const totals = await igRequest(
      `/${ctx.userId}/insights?metric=views,reach,profile_views,accounts_engaged,total_interactions,likes,comments,shares,saves,follows_and_unfollows&period=day&metric_type=total_value&since=${since}&until=${until}`
    );
    for (const m of totals.data ?? []) lines.push(`${m.name}: ${m.total_value?.value ?? "N/A"}`);
  } catch (e: any) {
    lines.push(`(insights de cuenta no disponibles: ${e.message})`);
  }

  const me = await igRequest(`/me?fields=username,name,biography,website,followers_count,follows_count,media_count`);
  lines.push(`followers_count: ${me.followers_count}`, `following: ${me.follows_count}`, `media_count: ${me.media_count}`);
  lines.push("", "PERFIL", `nombre: ${me.name ?? ""}`, `bio: ${(me.biography ?? "").replace(/\n/g, " / ")}`, `web: ${me.website ?? ""}`);

  return text(`📈 @${me.username} — últimos ${days} días:\n${lines.join("\n")}`);
}

type Enriched = {
  id: string; timestamp: string; caption: string; permalink: string;
  views: number; reach: number; shares: number; saved: number; likes: number;
  comments: number; avgWatch: string; skip: string; score: number; engagementRate: number;
  insightsError?: string;
};

async function analyzeViral(): Promise<ToolResult> {
  const media = await igRequest(
    `/${ctx.userId}/media?fields=id,media_type,media_product_type,timestamp,caption,like_count,comments_count,permalink&limit=20`
  );
  const posts = (media.data ?? []).filter(
    (m: any) => m.media_product_type === "REELS" || m.media_type === "VIDEO"
  );
  if (posts.length === 0) return text("No hay Reels publicados todavía.");

  const enriched: Enriched[] = [];
  for (const p of posts) {
    let ins: Record<string, any> = {};
    let insightsError: string | undefined;
    try { ins = await getMediaInsights(p.id); } catch (e: any) { insightsError = e.message; }

    const n = (k: string, fb = 0) => Number(ins[k] ?? fb) || 0;
    const views = n("views"), reach = n("reach"), shares = n("shares"), saved = n("saved");
    const likes = n("likes", p.like_count), comments = n("comments", p.comments_count);
    const score = views + shares * 20 + saved * 15 + comments * 5 + likes * 2;
    const engagementRate = reach > 0 ? ((likes + comments + shares + saved) / reach) * 100 : 0;

    enriched.push({
      id: p.id, timestamp: p.timestamp, caption: p.caption ?? "", permalink: p.permalink ?? "",
      views, reach, shares, saved, likes, comments,
      avgWatch: String(ins.ig_reels_avg_watch_time ?? "N/A"),
      skip: ins.reels_skip_rate != null ? `${Number(ins.reels_skip_rate).toFixed(1)}%` : "N/A",
      score, engagementRate, insightsError,
    });
  }

  enriched.sort((a, b) => b.score - a.score);

  const ranking = enriched.map((p, i) =>
    `#${i + 1} — score ${p.score}  |  ${p.timestamp.slice(0, 10)} ${horaAR(p.timestamp)}\n` +
    `   👁 ${p.views} vistas · 📡 ${p.reach} alcance · ❤️ ${p.likes} · 💬 ${p.comments} · 🔁 ${p.shares} shares · 🔖 ${p.saved} guardados\n` +
    `   ⏱ ${p.avgWatch} promedio · skip ${p.skip} · engagement ${p.engagementRate.toFixed(1)}%\n` +
    `   📝 ${p.caption.split("\n")[0].slice(0, 100)}\n   🔗 ${p.permalink}` +
    (p.insightsError ? `\n   ⚠️ ${p.insightsError}` : "")
  ).join("\n\n");

  const N = enriched.length;
  const avg = (k: keyof Enriched) => (enriched.reduce((a, p) => a + Number(p[k] || 0), 0) / N).toFixed(1);
  const top = enriched[0];
  const hook = top.caption.split("\n")[0];

  const hints: string[] = [];
  if (top.shares > top.saved) hints.push("Tu mejor Reel se COMPARTE más que se guarda → el gancho funciona por identificación/alarma. Repetí ese tipo de apertura.");
  else if (top.saved > top.shares) hints.push("Tu mejor Reel se GUARDA más que se comparte → funciona como referencia/tutorial. Hacé más contenido de pasos y checklists.");
  if (top.comments >= 5) hints.push(`El #1 generó ${top.comments} comentarios → la CTA de "escribime X" está convirtiendo. Mantenela.`);
  if (top.reach > 0 && top.views / top.reach > 1.3) hints.push("La gente ve el #1 más de una vez (vistas/alcance alto) → contenido con pasos que se vuelve a mirar.");
  hints.push(`Hook ganador: "${hook.slice(0, 90)}"`);

  return text(
    `🔥 RANKING DE REELS (${N} analizados)\n\n${ranking}\n\n` +
    `📊 PROMEDIOS: ${avg("views")} vistas · ${avg("reach")} alcance · ${avg("shares")} shares · ${avg("saved")} guardados · ${avg("engagementRate")}% engagement\n\n` +
    `💡 PATRONES DETECTADOS:\n${hints.map((h) => `• ${h}`).join("\n")}`
  );
}
