/**
 * Cinematic.tsx — capa "tráiler" para Reels (ejemplo de marca: Protocolo SOS).
 *
 * - Rayos + flash + sacudida de cámara en la apertura (con trueno).
 * - Glitch RGB en la entrada de cada tarjeta (con whoosh).
 * - Impacto grave en el cierre (CTA).
 * - Grano de película, viñeta y zoom lento del fondo.
 * - Marca: escudo + nombre de la marca arriba (prop `brandName`), tipografía Montserrat.
 *
 * Todo es determinístico (random con semilla): el mismo timeline da el mismo video.
 */
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  continueRender,
  delayRender,
  Img,
} from "remotion";

export const BRAND = {
  navy: "#0B1530",
  navy2: "#132A5E",
  orange: "#F06A3C",
  white: "#FFFFFF",
  font: "Montserrat, 'Helvetica Neue', Arial, sans-serif",
};

// ───────────────────────── Fuente local (sin internet) ─────────────────────────
let fontsRequested = false;
export const useBrandFonts = () => {
  if (fontsRequested || typeof document === "undefined") return;
  fontsRequested = true;
  const handle = delayRender("Cargando Montserrat");
  const faces = [700, 800, 900].map(
    (w) => new FontFace("Montserrat", `url(${staticFile(`fonts/montserrat-latin-${w}-normal.woff2`)}) format("woff2")`, { weight: String(w) }),
  );
  Promise.all(faces.map((f) => f.load()))
    .then((loaded) => {
      loaded.forEach((f) => (document as any).fonts.add(f));
      continueRender(handle);
    })
    .catch(() => continueRender(handle));
};

// ───────────────────────── Sacudida de cámara ─────────────────────────
/** Desplazamiento (px) para sacudir todo el cuadro en los primeros frames. */
export const shakeAt = (frame: number, start = 0, length = 14, strength = 22) => {
  const t = frame - start;
  if (t < 0 || t > length) return { x: 0, y: 0, r: 0 };
  const decay = 1 - t / length;
  return {
    x: (random(`sx${t}`) - 0.5) * 2 * strength * decay,
    y: (random(`sy${t}`) - 0.5) * 2 * strength * decay,
    r: (random(`sr${t}`) - 0.5) * 1.6 * decay,
  };
};

// ───────────────────────── Rayo ─────────────────────────
const boltPath = (seed: string, x0: number, y0: number, x1: number, y1: number, segments = 14, jitter = 70) => {
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const x = x0 + (x1 - x0) * t + (random(`${seed}x${i}`) - 0.5) * 2 * jitter;
    const y = y0 + (y1 - y0) * t + (random(`${seed}y${i}`) - 0.5) * jitter * 0.4;
    pts.push([x, y]);
  }
  pts.push([x1, y1]);
  return "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
};

const branchPath = (seed: string, from: [number, number], len: number, dir: number) => {
  const [x0, y0] = from;
  return boltPath(seed, x0, y0, x0 + dir * len * 0.6, y0 + len, 6, 30);
};

const Bolt: React.FC<{ seed: string; x0: number; x1: number; opacity: number }> = ({ seed, x0, x1, opacity }) => {
  const main = boltPath(seed, x0, -40, x1, 1250);
  const b1 = branchPath(`${seed}b1`, [x0 + (x1 - x0) * 0.35, 420], 260, 1);
  const b2 = branchPath(`${seed}b2`, [x0 + (x1 - x0) * 0.6, 700], 220, -1);
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", inset: 0, opacity }}>
      <defs>
        <filter id={`glow-${seed}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#glow-${seed})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={main} stroke={BRAND.orange} strokeWidth={16} opacity={0.75} />
        <path d={main} stroke="#FFF1E6" strokeWidth={5} />
        <path d={b1} stroke="#FFB08A" strokeWidth={3} opacity={0.9} />
        <path d={b2} stroke="#FFB08A" strokeWidth={3} opacity={0.9} />
      </g>
    </svg>
  );
};

/** Apertura con rayos: 2 descargas + flashes, ~0,5 s. */
export const LightningIntro: React.FC = () => {
  const f = useCurrentFrame();
  // Curvas de luz: flash fuerte al inicio, réplica en el frame 7.
  const flash = interpolate(f, [0, 1, 3, 6, 7, 9, 14], [0.7, 0.35, 0, 0, 0.45, 0, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bolt1 = interpolate(f, [0, 1, 4, 5], [1, 1, 0.6, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bolt2 = interpolate(f, [6, 7, 10, 12], [0, 1, 0.5, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (f > 16) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Bolt seed="r1" x0={760} x1={360} opacity={bolt1} />
      <Bolt seed="r2" x0={240} x1={720} opacity={bolt2} />
      <AbsoluteFill style={{ background: "#FFC8A8", opacity: flash, mixBlendMode: "screen" }} />
    </AbsoluteFill>
  );
};

/** Pequeño destello naranja para el impacto del CTA. */
export const ImpactFlash: React.FC = () => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 2, 8], [0.45, 0.2, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: BRAND.orange, opacity: o, mixBlendMode: "screen", pointerEvents: "none" }} />;
};

// ───────────────────────── Glitch RGB ─────────────────────────
/** text-shadow de separación de canales para los primeros `len` frames. */
export const glitchShadow = (frame: number, len = 5, strength = 10) => {
  if (frame > len) return "0 6px 30px rgba(0,0,0,0.6)";
  const k = (1 - frame / len) * strength;
  const dx = (random(`g${frame}`) - 0.5) * 2 * k;
  return `${dx.toFixed(1)}px 0 0 rgba(255,40,60,0.85), ${(-dx).toFixed(1)}px 0 0 rgba(0,220,255,0.85), 0 6px 30px rgba(0,0,0,0.6)`;
};

/** Barras horizontales de glitch que cortan la tarjeta al entrar. */
export const GlitchBars: React.FC<{ len?: number }> = ({ len = 4 }) => {
  const f = useCurrentFrame();
  if (f > len) return null;
  const bars = [0, 1, 2, 3].map((i) => ({
    top: 300 + random(`gb${f}-${i}`) * 1000,
    h: 6 + random(`gh${f}-${i}`) * 30,
    shift: (random(`gs${f}-${i}`) - 0.5) * 120,
  }));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {bars.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: b.top,
            left: 0,
            width: 1080,
            height: b.h,
            background: i % 2 ? "rgba(0,220,255,0.18)" : "rgba(255,60,80,0.18)",
            transform: `translateX(${b.shift}px)`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

// ───────────────────────── Fondo, viñeta, grano ─────────────────────────
export const CineBackground: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [0, durationInFrames], [1.0, 1.12]);
  const x = interpolate(f, [0, durationInFrames], [40, 60]);
  return (
    <AbsoluteFill style={{ background: BRAND.navy, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${zoom})`,
          background: `radial-gradient(ellipse at ${x}% 38%, ${BRAND.navy2} 0%, ${BRAND.navy} 55%, #050A18 100%)`,
        }}
      />
      {/* Rejilla tenue tipo "sistema de seguridad" */}
      <AbsoluteFill
        style={{
          opacity: 0.07,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "90px 90px",
          transform: `translateY(${(f * 0.6) % 90}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background: "radial-gradient(ellipse at 50% 45%, transparent 45%, rgba(0,0,0,0.55) 100%)",
    }}
  />
);

export const FilmGrain: React.FC = () => {
  const f = useCurrentFrame();
  const seed = Math.floor(f / 2) % 8; // el grano "titila" cada 2 frames
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.09, mixBlendMode: "overlay" }}>
      <svg width={1080} height={1920}>
        <filter id={`grain${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

// ───────────────────────── Marca ─────────────────────────
export const BrandMark: React.FC<{ name?: string }> = ({ name = "PROTOCOLO SOS" }) => (
  <div
    style={{
      position: "absolute",
      top: 250,
      left: 0,
      width: 1080,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      gap: 18,
    }}
  >
    <svg width={54} height={62} viewBox="0 0 54 62">
      <path d="M27 3 L50 11 V29 C50 44 40 54 27 59 C14 54 4 44 4 29 V11 Z" fill="none" stroke={BRAND.orange} strokeWidth={4} />
      <rect x={17} y={28} width={20} height={16} rx={3} fill={BRAND.orange} />
      <path d="M21 28 V23 a6 6 0 0 1 12 0 V28" fill="none" stroke={BRAND.orange} strokeWidth={3.5} />
    </svg>
    <div
      style={{
        fontFamily: BRAND.font,
        fontWeight: 800,
        fontSize: 34,
        letterSpacing: 9,
        color: "rgba(255,255,255,0.92)",
      }}
    >
      {name}
    </div>
  </div>
);

// ───────────────────────── Sonido ─────────────────────────
type SfxBeat = { from: number; label: string };

/** Trueno en la apertura, chisporroteo en las chispas, whoosh por tarjeta, impacto en el CTA. */
export const CineSfx: React.FC<{ beats: SfxBeat[]; intro?: number; sparksAt?: number }> = ({ beats, intro = 0, sparksAt }) => (
  <>
    <Sequence from={0} durationInFrames={90} name="SFX trueno 1">
      <Audio src={staticFile("sfx/trueno.wav")} volume={0.6} />
    </Sequence>
    {intro > 0 && (
      <Sequence from={16} durationInFrames={90} name="SFX trueno 2">
        <Audio src={staticFile("sfx/trueno.wav")} volume={0.45} />
      </Sequence>
    )}
    {intro > 0 && sparksAt !== undefined && (
      <Sequence from={sparksAt} durationInFrames={30} name="SFX chispas">
        <Audio src={staticFile("sfx/chispas.wav")} volume={0.55} />
      </Sequence>
    )}
    {beats.slice(intro > 0 ? 0 : 1).map((b, i) =>
      b.label.includes("CTA") ? (
        <Sequence key={i} from={b.from} durationInFrames={30} name="SFX impacto">
          <Audio src={staticFile("sfx/impacto.wav")} volume={0.7} />
        </Sequence>
      ) : (
        <Sequence key={i} from={Math.max(0, b.from - 4)} durationInFrames={15} name="SFX whoosh">
          <Audio src={staticFile("sfx/whoosh.wav")} volume={0.35} />
        </Sequence>
      ),
    )}
  </>
);

// ───────────────────────── Tormenta (apertura realista) ─────────────────────────
const STORM = { core: "#F4F8FF", glow: "#6FA8FF", glow2: "#3D6FD6", skyTop: "#04081A", skyMid: "#0C1A3E" };

/** Rayo con ramificaciones recursivas, en coordenadas absolutas. */
const forkedBolt = (seed: string, x0: number, y0: number, x1: number, y1: number, depth = 0): string[] => {
  const segs = depth === 0 ? 22 : 9;
  const jit = depth === 0 ? 46 : 22;
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    pts.push([
      x0 + (x1 - x0) * t + (random(`${seed}x${i}`) - 0.5) * 2 * jit,
      y0 + (y1 - y0) * t + (random(`${seed}y${i}`) - 0.5) * jit * 0.3,
    ]);
  }
  pts.push([x1, y1]);
  const paths = ["M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")];
  if (depth < 2) {
    const n = depth === 0 ? 5 : 2;
    for (let k = 0; k < n; k++) {
      const idx = 2 + Math.floor(random(`${seed}k${k}`) * (pts.length - 5));
      const [bx, by] = pts[idx];
      const dir = random(`${seed}d${k}`) > 0.5 ? 1 : -1;
      const len = (depth === 0 ? 260 : 120) * (0.6 + random(`${seed}l${k}`) * 0.6);
      paths.push(...forkedBolt(`${seed}-${k}`, bx, by, bx + dir * len * 0.7, by + len, depth + 1));
    }
  }
  return paths;
};

const StormBolt: React.FC<{ seed: string; x0: number; y0: number; x1: number; y1: number; o: number; reflect?: boolean }> = ({
  seed, x0, y0, x1, y1, o, reflect = true,
}) => {
  if (o <= 0.01) return null;
  const paths = forkedBolt(seed, x0, y0, x1, y1);
  const draw = (key: string) => (
    <g key={key} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, i) => (
        <path key={`g${i}`} d={d} stroke={STORM.glow} strokeWidth={i === 0 ? 18 : 7} opacity={0.5} filter="url(#stormGlow)" />
      ))}
      {paths.map((d, i) => (
        <path key={`c${i}`} d={d} stroke={STORM.core} strokeWidth={i === 0 ? 4.5 : 1.8} opacity={i === 0 ? 1 : 0.85} />
      ))}
    </g>
  );
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", inset: 0, opacity: o }}>
      <defs>
        <filter id="stormGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <filter id="reflBlur"><feGaussianBlur stdDeviation="10" /></filter>
      </defs>
      {draw("b")}
      {reflect && (
        <g transform={`translate(0 ${2 * y1}) scale(1 -1)`} opacity={0.28} filter="url(#reflBlur)">
          {draw("r")}
        </g>
      )}
    </svg>
  );
};

/** Nubes de tormenta (ruido fractal) iluminadas desde atrás por los rayos. */
const StormClouds: React.FC<{ light: number; lx: number }> = ({ light, lx }) => {
  const f = useCurrentFrame();
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <filter id="clouds" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0032 0.006" numOctaves={7} seed={9} />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.05  0 0 0 0 0.08  0 0 0 0 0.17  0 0 0 4.2 -1.75"
          />
        </filter>
        <radialGradient id="cloudLight" cx={lx / 1080} cy="0.32" r="0.55">
          <stop offset="0%" stopColor="#A9C8FF" stopOpacity={0.95} />
          <stop offset="45%" stopColor="#4C7BD8" stopOpacity={0.45} />
          <stop offset="100%" stopColor="#0C1A3E" stopOpacity={0} />
        </radialGradient>
        <mask id="cloudMask">
          <rect width="1080" height="1300" filter="url(#clouds)" transform={`translate(${-f * 0.8} 0)`} />
        </mask>
      </defs>
      <linearGradient id="cloudFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fff" stopOpacity={1} />
        <stop offset="70%" stopColor="#fff" stopOpacity={0.85} />
        <stop offset="100%" stopColor="#fff" stopOpacity={0} />
      </linearGradient>
      <mask id="cloudFadeMask"><rect width="1080" height="1300" fill="url(#cloudFade)" /></mask>
      {/* masa de nubes (dos capas a distinta velocidad) */}
      <g mask="url(#cloudFadeMask)">
        <rect width="1300" height="1300" filter="url(#clouds)" transform={`translate(${-f * 0.6} 0)`} />
        <rect width="1300" height="1300" filter="url(#clouds)" opacity={0.7} transform={`translate(${-180 + f * 0.4} 60) scale(1.15)`} />
      </g>
      {/* luz del rayo detrás de las nubes */}
      <rect width="1080" height="1300" fill="url(#cloudLight)" opacity={light} mask="url(#cloudMask)" style={{ mixBlendMode: "screen" }} />
    </svg>
  );
};

/**
 * Apertura de tormenta (~1,8 s): cielo, nubes, 3 rayos con ramas, reflejo en
 * el suelo mojado y niebla. Va DETRÁS del texto del gancho y se funde al azul.
 */
export const StormIntro: React.FC<{ fadeStart?: number; fadeEnd?: number }> = ({ fadeStart = 42, fadeEnd = 56 }) => {
  const f = useCurrentFrame();
  if (f > fadeEnd) return null;
  const c = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
  const b1 = interpolate(f, [3, 4, 9, 12], [0, 1, 0.6, 0], c);
  const b2 = interpolate(f, [15, 16, 21, 24], [0, 1, 0.6, 0], c);
  const b3 = interpolate(f, [30, 31, 35, 38], [0, 0.9, 0.45, 0], c);
  const light = Math.max(b1, b2 * 0.9, b3 * 0.7, 0.18);
  const lx = b2 > b1 && b2 > b3 ? 330 : b3 > b1 ? 820 : 640;
  const fade = interpolate(f, [fadeStart, fadeEnd], [1, 0], c);
  return (
    <AbsoluteFill style={{ opacity: fade, pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${STORM.skyTop} 0%, ${STORM.skyMid} 55%, #0A1430 72%, #050912 100%)` }} />
      <StormClouds light={light} lx={lx} />
      <StormBolt seed="s1" x0={690} y0={230} x1={600} y1={1430} o={b1} />
      <StormBolt seed="s2" x0={300} y0={330} x1={380} y1={1400} o={b2} />
      <StormBolt seed="s3" x0={880} y0={180} x1={930} y1={900} o={b3} reflect={false} />
      {/* suelo mojado + niebla */}
      <AbsoluteFill
        style={{
          top: 1380,
          background: `linear-gradient(180deg, rgba(120,160,230,${0.10 + light * 0.18}) 0%, rgba(10,16,34,0.85) 35%, #03060E 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          top: 1240,
          height: 260,
          background: `radial-gradient(ellipse at 50% 60%, rgba(170,195,240,${0.18 + light * 0.2}) 0%, transparent 70%)`,
          filter: "blur(18px)",
        }}
      />
      {/* destello general, frío */}
      <AbsoluteFill style={{ background: "#CFE0FF", opacity: Math.max(b1 * 0.35, b2 * 0.28), mixBlendMode: "screen" }} />
    </AbsoluteFill>
  );
};

// ───────────────────────── Chispas por los bordes ─────────────────────────
/** Arco eléctrico que recorre los 4 bordes + chispas que saltan hacia adentro. */
export const EdgeSparks: React.FC<{ length?: number }> = ({ length = 16 }) => {
  const f = useCurrentFrame();
  if (f < 0 || f > length) return null;
  const t = f / length;
  const o = interpolate(f, [0, 2, length - 4, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // Perímetro recorrido: el arco "corre" alrededor de la pantalla.
  const W = 1080, H = 1920, P = 2 * (W + H), m = 14;
  const at = (d: number): [number, number] => {
    d = ((d % P) + P) % P;
    if (d < W) return [d, m];
    if (d < W + H) return [W - m, d - W];
    if (d < 2 * W + H) return [W - (d - W - H), H - m];
    return [m, H - (d - 2 * W - H)];
  };
  const arcs = [0, 0.25, 0.5, 0.75].map((off, k) => {
    const head = (t + off) * P * 1.1;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 70; i++) {
      const [x, y] = at(head - i * 30);
      const j = (random(`e${k}-${f}-${i}`) - 0.5) * 48;
      pts.push([x + (x < 40 ? Math.abs(j) : x > W - 40 ? -Math.abs(j) : j * 0.3), y + (y < 40 ? Math.abs(j) : y > H - 40 ? -Math.abs(j) : j * 0.3)]);
    }
    return "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
  });
  const sparks = Array.from({ length: 80 }, (_, i) => {
    const d = random(`sp${i}`) * P;
    const [x, y] = at(d);
    const life = (f + random(`sl${i}`) * length) % 7;
    const inward = x < 40 ? [1, 0] : x > W - 40 ? [-1, 0] : y < 40 ? [0, 1] : [0, -1];
    const spread = (random(`sd${i}`) - 0.5) * 1.4;
    const dist = life * (20 + random(`sv${i}`) * 40);
    const dx = (inward[0] + (inward[1] ? spread : 0)) * dist;
    const dy = (inward[1] + (inward[0] ? spread : 0)) * dist;
    return { x, y, dx, dy, a: 1 - life / 7 };
  });
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", inset: 0, opacity: o, pointerEvents: "none" }}>
      <defs>
        <filter id="sparkGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      {/* resplandor del borde */}
      <rect x={6} y={6} width={1068} height={1908} rx={28} fill="none" stroke={STORM.glow} strokeWidth={22} opacity={0.55 + 0.3 * Math.sin(f * 1.7)} filter="url(#sparkGlow)" />
      {arcs.map((d, i) => (
        <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={d} stroke={STORM.glow} strokeWidth={26} opacity={0.75} filter="url(#sparkGlow)" />
          <path d={d} stroke={STORM.core} strokeWidth={5} />
        </g>
      ))}
      {sparks.map((s, i) => (
        <line
          key={i}
          x1={s.x + s.dx}
          y1={s.y + s.dy}
          x2={s.x + s.dx * 0.75}
          y2={s.y + s.dy * 0.75}
          stroke={i % 3 ? STORM.core : BRAND.orange}
          strokeWidth={5}
          filter={i % 4 === 0 ? "url(#sparkGlow)" : undefined}
          strokeLinecap="round"
          opacity={s.a}
        />
      ))}
    </svg>
  );
};

// ───────────────────────── Tormenta con imagen de fondo ─────────────────────────

/**
 * Usa una imagen de tormenta propia (con derechos de uso) como placa de
 * fondo: zoom lento, destellos que la iluminan y rayos animados encima.
 */
export const StormPlate: React.FC<{ src: string; fadeStart: number; fadeEnd: number }> = ({ src, fadeStart, fadeEnd }) => {
  const f = useCurrentFrame();
  if (f > fadeEnd) return null;
  const c = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
  const b1 = interpolate(f, [4, 5, 8, 11], [0, 1, 0.5, 0], c);
  const b2 = interpolate(f, [16, 17, 20, 23], [0, 1, 0.6, 0], c);
  const b3 = interpolate(f, [31, 32, 34, 37], [0, 0.9, 0.4, 0], c);
  const flash = Math.max(b1, b2 * 0.9, b3 * 0.7);
  const zoom = interpolate(f, [0, fadeEnd], [1.08, 1.0], c);
  const fade = interpolate(f, [fadeStart, fadeEnd], [1, 0], c);
  return (
    <AbsoluteFill style={{ opacity: fade, pointerEvents: "none", overflow: "hidden" }}>
      <Img
        src={staticFile(src)}
        style={{
          width: 1080,
          height: 1920,
          objectFit: "cover",
          transform: `scale(${zoom})`,
          filter: `brightness(${0.55 + flash * 0.9}) contrast(1.1) saturate(1.1)`,
        }}
      />
      <StormBolt seed="p1" x0={640} y0={260} x1={590} y1={1420} o={b1} />
      <StormBolt seed="p2" x0={330} y0={420} x1={300} y1={1250} o={b2} />
      <StormBolt seed="p3" x0={900} y0={200} x1={960} y1={980} o={b3} reflect={false} />
      <AbsoluteFill style={{ background: "#CFE0FF", opacity: flash * 0.3, mixBlendMode: "screen" }} />
    </AbsoluteFill>
  );
};
