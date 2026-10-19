/**
 * ReelFromTimeline — composición de Remotion que renderiza un Reel a partir
 * de la línea de tiempo que genera `beats.py --remotion`.
 *
 * Cada beat es un <Sequence>: tarjeta de texto en pantalla (grande, en la
 * zona segura) + subtítulo quemado con la línea hablada. El gancho está en
 * el frame 0. Nada queda quieto más de un beat.
 *
 * Uso en Root.tsx:
 *   <Composition
 *     id="ReelFromTimeline"
 *     component={ReelFromTimeline}
 *     width={1080} height={1920} fps={30}
 *     durationInFrames={timeline.durationInFrames}
 *     defaultProps={{ timeline, voiceoverSrc: undefined }}
 *   />
 *
 * Render:
 *   npx remotion render ReelFromTimeline out/reel.mp4 --props=timeline.json
 */
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  BRAND,
  BrandMark,
  CineBackground,
  CineSfx,
  FilmGrain,
  GlitchBars,
  ImpactFlash,
  StormIntro,
  StormPlate,
  EdgeSparks,
  Vignette,
  glitchShadow,
  shakeAt,
  useBrandFonts,
} from "./Cinematic";
import { FakeMail, type MailHighlight } from "./FakeMail";

export type Beat = {
  id: string;
  label: "GANCHO" | "CUERPO" | "MEDIO" | "CTA" | "GANCHO/CTA" | string;
  from: number;
  durationInFrames: number;
  spoken: string;
  onScreen: string[];
  /** Clip de audio de este beat en /public (lo genera tts.py). */
  audio?: string;
  /** Capa visual extra del beat (ej. mail de ejemplo con un detalle resaltado). */
  visual?: { type: "fakeMail"; highlight?: MailHighlight };
  /** Contador de pasos visible arriba a la derecha, ej. "1/3". Mantiene al espectador hasta el final. */
  step?: string;
};

export type Timeline = {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  safeZone: { top: number; bottom: number; right: number };
  /** Toma completa de voz grabada en /public, ya alineada (la pone align.py). */
  voiceoverSrc?: string;
  beats: Beat[];
};

/**
 * Las props SON el timeline.json (más opcionales), así el render es directo:
 *   npx remotion render ReelFromTimeline out/reel.mp4 --props=public/voz/<reel>/timeline.json
 */
export type ReelProps = Timeline & {
  /** Música de fondo en /public (opcional). Se baja a 0.12 de volumen. */
  musicSrc?: string;
  /** Estilo tráiler: rayos, glitch, SFX, grano, marca (default true). */
  cinematic?: boolean;
  /** Frames de tormenta + chispas antes del primer título (default 60 = 2 s). */
  introFrames?: number;
  /** Imagen de tormenta en /public para la apertura (vacío = tormenta generada por código). */
  stormImage?: string;
  /** Nombre de marca que aparece arriba (default "PROTOCOLO SOS"). */
  brandName?: string;
  theme?: Partial<Theme>;
};

type Theme = {
  bg: string;
  bgAccent: string;
  text: string;
  accent: string;
  subtitleBg: string;
  font: string;
};

const DEFAULT_THEME: Theme = {
  bg: "#0B0F19",
  bgAccent: "#1E3A8A",
  text: "#FFFFFF",
  accent: "#F59E0B",
  subtitleBg: "rgba(0,0,0,0.55)",
  font: "Inter, 'Helvetica Neue', Arial, sans-serif",
};

// Zona segura de Instagram (1080×1920): la interfaz tapa todo lo de afuera.
// Márgenes SIMÉTRICOS: el centro de títulos y subtítulos queda en x=540, igual que la marca.
// (Antes era 60–850 → todo se veía corrido a la izquierda.) 120 px a cada lado
// deja libre la columna de botones de Instagram (x > ~980).
const SAFE = { top: 230, bottom: 1440, right: 960, left: 120 };

/** Fondo con un degradado que se mueve despacio: nunca hay un frame quieto. */
const Background: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const angle = interpolate(frame, [0, durationInFrames], [160, 200]);
  const x = interpolate(frame, [0, durationInFrames], [30, 70]);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at ${x}% 20%, ${theme.bgAccent}55 0%, transparent 55%), linear-gradient(${angle}deg, ${theme.bg} 0%, #000 100%)`,
      }}
    />
  );
};

/** Barra de progreso arriba, dentro de la zona segura. Da sensación de brevedad. */
const Progress: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const w = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        top: SAFE.top - 40,
        left: SAFE.left,
        width: SAFE.right - SAFE.left,
        height: 8,
        background: "rgba(255,255,255,0.15)",
        borderRadius: 4,
      }}
    >
      <div style={{ width: `${w}%`, height: "100%", background: theme.accent, borderRadius: 4 }} />
    </div>
  );
};

/** Tarjeta de texto en pantalla: entra con spring, sale con fade. */
const Card: React.FC<{ lines: string[]; label: string; theme: Theme; durationInFrames: number; cinematic?: boolean; compact?: boolean; anchorTop?: boolean }> = ({
  lines,
  label,
  theme,
  durationInFrames,
  cinematic,
  compact,
  anchorTop,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isHook = label.startsWith("GANCHO");
  const isCta = label.includes("CTA");

  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.7, stiffness: 160 } });
  const y = interpolate(enter, [0, 1], [60, 0]);
  const scale = interpolate(enter, [0, 1], [0.92, 1]);
  const fadeOut = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Tamaño según largo: el gancho más grande, el CTA con color de acento.
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const fontSize = compact ? 58 : isHook ? (longest > 18 ? 96 : 120) : longest > 24 ? 72 : 88;

  return (
    <div
      style={{
        position: "absolute",
        // anchorTop: con contador, todos los títulos arrancan en la misma línea (y = 450)
        // en vez de centrarse según cuántas líneas tengan; así no "saltan" entre beats.
        // Con contador (anchorTop) la tarjeta compacta baja para no quedar tapada por la pastilla.
        top: compact ? (anchorTop ? SAFE.top + 175 : SAFE.top + 110) : anchorTop ? SAFE.top + 220 : SAFE.top,
        left: SAFE.left,
        width: SAFE.right - SAFE.left,
        height: compact ? (anchorTop ? 190 : 220) : anchorTop ? SAFE.bottom - SAFE.top - 540 : SAFE.bottom - SAFE.top - 320, // compacto: deja lugar a la capa visual
        display: "flex",
        alignItems: anchorTop && !compact ? "flex-start" : "center",
        justifyContent: "center",
        opacity: fadeOut,
        transform: `translateY(${y}px) scale(${scale})`,
      }}
    >
      <div
        style={{
          fontFamily: theme.font,
          fontWeight: 900,
          fontSize,
          lineHeight: 1.05,
          letterSpacing: -1,
          textTransform: "uppercase",
          color: isCta ? theme.accent : theme.text,
          textAlign: "center",
          textShadow: cinematic ? glitchShadow(frame, isHook ? 10 : 5, isHook ? 16 : 10) : "0 6px 30px rgba(0,0,0,0.6)",
        }}
      >
        {lines.map((l, i) => (
          <div key={i} style={{ marginBottom: i < lines.length - 1 ? 24 : 0 }}>
            {/* *palabra* = resaltada en el color de acento */}
            {l.split(/(\*[^*]+\*)/g).map((part, j) =>
              part.startsWith("*") && part.endsWith("*") ? (
                <span key={j} style={{ color: theme.accent }}>{part.slice(1, -1)}</span>
              ) : (
                <React.Fragment key={j}>{part}</React.Fragment>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Contador "1/3" centrado bajo la barra de progreso. Entra con un pop corto. */
const StepPill: React.FC<{ step: string; theme: Theme }> = ({ step, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 10, stiffness: 220, mass: 0.6 } });
  return (
    <div
      style={{
        position: "absolute",
        top: SAFE.top + 100, // debajo de la marca PROTOCOLO SOS, encima del título (termina ~y 400)
        left: SAFE.left,
        width: SAFE.right - SAFE.left,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontFamily: theme.font,
          fontWeight: 900,
          fontSize: 46,
          letterSpacing: 4,
          color: "#fff",
          background: "#D32F2F",
          padding: "8px 30px",
          borderRadius: 999,
          boxShadow: "0 8px 30px rgba(211,47,47,0.55)",
          transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`,
        }}
      >
        {step}
      </div>
    </div>
  );
};

/** Subtítulo quemado con la línea hablada. La mayoría mira sin sonido. */
const Subtitle: React.FC<{ text: string; theme: Theme }> = ({ text, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 200 } });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        width: SAFE.right - SAFE.left,
        bottom: 1920 - SAFE.bottom + 20,
        display: "flex",
        justifyContent: "center",
        opacity: enter,
      }}
    >
      <div
        style={{
          fontFamily: theme.font,
          fontWeight: 700,
          fontSize: 44,
          lineHeight: 1.25,
          color: theme.text,
          background: theme.subtitleBg,
          padding: "18px 28px",
          borderRadius: 18,
          textAlign: "center",
          maxWidth: "100%",
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const ReelFromTimeline: React.FC<ReelProps> = ({
  beats,
  voiceoverSrc,
  musicSrc,
  theme: themeOverride,
  cinematic = true,
  introFrames,
  stormImage = "",
  brandName,
  durationInFrames,
}) => {
  const base: Theme = cinematic
    ? { ...DEFAULT_THEME, bg: BRAND.navy, bgAccent: BRAND.navy2, accent: BRAND.orange, font: BRAND.font, subtitleBg: "rgba(5,10,24,0.72)" }
    : DEFAULT_THEME;
  const theme: Theme = { ...base, ...(themeOverride ?? {}) };
  const voice = voiceoverSrc;
  const frame = useCurrentFrame();
  if (cinematic) useBrandFonts();

  // Apertura: tormenta sola, chispas por los bordes y recién ahí los títulos.
  const intro = cinematic ? introFrames ?? 60 : 0;
  const sparksLen = 16;
  const SPARKS_AT = Math.max(0, intro - 12);

  const cta = beats.find((b) => b.label.includes("CTA"));
  const s1 = cinematic ? shakeAt(frame, 4, 10, 18) : { x: 0, y: 0, r: 0 };
  const s1b = cinematic ? shakeAt(frame, 16, 8, 12) : { x: 0, y: 0, r: 0 };
  const s2 = cinematic && cta ? shakeAt(frame, intro + cta.from, 8, 12) : { x: 0, y: 0, r: 0 };
  const shake = { x: s1.x + s1b.x + s2.x, y: s1.y + s1b.y + s2.y, r: s1.r + s1b.r + s2.r };
  const shifted = beats.map((b) => ({ ...b, from: b.from + intro }));

  // Contador: beats seguidos con el mismo `step` forman UN tramo. El número aparece
  // una sola vez (cuando la voz dice "uno", "dos", "tres") y queda fijo hasta el siguiente.
  const stepSegments: { step: string; from: number; durationInFrames: number }[] = [];
  for (const b of shifted) {
    if (!b.step) continue;
    const last = stepSegments[stepSegments.length - 1];
    if (last && last.step === b.step && last.from + last.durationInFrames === b.from) {
      last.durationInFrames += b.durationInFrames;
    } else {
      stepSegments.push({ step: b.step, from: b.from, durationInFrames: b.durationInFrames });
    }
  }
  const hasSteps = stepSegments.length > 0;

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px) rotate(${shake.r}deg) scale(${cinematic ? 1.04 : 1})` }}>
        {cinematic ? <CineBackground durationInFrames={durationInFrames} /> : <Background theme={theme} />}
        {cinematic &&
          (stormImage ? (
            <StormPlate src={stormImage} fadeStart={intro - 6} fadeEnd={intro + 14} />
          ) : (
            <StormIntro fadeStart={intro - 6} fadeEnd={intro + 14} />
          ))}
        <Sequence from={intro} name="Progreso + marca">
          <Progress theme={theme} />
          {cinematic && <BrandMark name={brandName} />}
        </Sequence>

        {shifted.map((b) => (
          <Sequence key={b.id} from={b.from} durationInFrames={b.durationInFrames} name={`${b.label} ${b.id}`}>
            {b.onScreen.length > 0 && (
              <Card lines={b.onScreen} label={b.label} theme={theme} durationInFrames={b.durationInFrames} cinematic={cinematic} compact={!!b.visual} anchorTop={hasSteps} />
            )}
            {b.visual?.type === "fakeMail" && <FakeMail highlight={b.visual.highlight ?? "none"} />}
            {cinematic && <GlitchBars len={b.label.startsWith("GANCHO") ? 8 : 3} />}
            {cinematic && b.label.includes("CTA") && <ImpactFlash />}
            <Subtitle text={b.spoken} theme={theme} />
            {/* Voz artificial: un clip por beat, arranca con el beat */}
            {b.audio && !voice && <Audio src={staticFile(b.audio)} />}
          </Sequence>
        ))}

        {stepSegments.map((s) => (
          <Sequence key={`step-${s.from}`} from={s.from} durationInFrames={s.durationInFrames} name={`Contador ${s.step}`}>
            <StepPill step={s.step} theme={theme} />
          </Sequence>
        ))}
      </AbsoluteFill>

      {cinematic && intro > 0 && (
        <Sequence from={SPARKS_AT} durationInFrames={sparksLen + 1} name="Chispas">
          <EdgeSparks length={sparksLen} />
        </Sequence>
      )}
      {cinematic && <Vignette />}
      {cinematic && <FilmGrain />}

      {/* Voz grabada: una sola pista alineada a los beats */}
      {voice && (
        <Sequence from={intro} name="Voz">
          <Audio src={staticFile(voice)} />
        </Sequence>
      )}
      {musicSrc && <Audio src={staticFile(musicSrc)} volume={0.12} />}
      {cinematic && <CineSfx beats={shifted} intro={intro} sparksAt={SPARKS_AT} />}
    </AbsoluteFill>
  );
};
