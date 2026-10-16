import React from "react";
import { Composition } from "remotion";
import { ReelFromTimeline, type ReelProps } from "./ReelFromTimeline";
import ejemplo from "./timeline-default.json";

/**
 * Una sola composición que se adapta al timeline que recibe:
 *   npx remotion render ReelFromTimeline out/reel.mp4 --props=public/voz/<reel>/timeline.json
 * En Studio (`npm run studio`) carga el ejemplo por defecto.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ReelFromTimeline"
      component={ReelFromTimeline}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={ejemplo.durationInFrames}
      defaultProps={ejemplo as ReelProps}
      calculateMetadata={async ({ props }) => ({
        // la apertura cinematográfica (tormenta + chispas) se suma al largo del guión
        durationInFrames: props.durationInFrames + (props.cinematic === false ? 0 : props.introFrames ?? 60),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
  );
};
