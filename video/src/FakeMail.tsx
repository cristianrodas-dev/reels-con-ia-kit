/**
 * FakeMail — tarjeta de "mail de phishing" de ejemplo para mostrar en pantalla.
 *
 * Es un ejemplo armado por nosotros: no imita el diseño real de Instagram ni usa
 * su logo. Lleva el sello EJEMPLO. Cada detalle (remitente, apuro, link) se
 * resalta por turno con `highlight`.
 */
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND } from "./Cinematic";

export type MailHighlight = "none" | "sender" | "urgency" | "link";

export const FakeMail: React.FC<{ highlight: MailHighlight; width?: number }> = ({ highlight, width = 880 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 150, mass: 0.8 } });
  const y = interpolate(enter, [0, 1], [80, 0]);
  const pulse = 0.5 + 0.5 * Math.sin(frame / 4); // parpadeo suave del marcador

  const mark = (on: boolean): React.CSSProperties =>
    on
      ? {
          outline: `5px solid ${BRAND.orange}`,
          outlineOffset: 6,
          borderRadius: 10,
          boxShadow: `0 0 ${18 + pulse * 14}px ${BRAND.orange}AA`,
          background: "#FFF1EA",
        }
      : {};

  const F = "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  return (
    <div
      style={{
        position: "absolute",
        left: (1080 - width) / 2,
        top: 600,
        width,
        transform: `translateY(${y}px)`,
        opacity: enter,
        fontFamily: F,
        color: "#1F2430",
        background: "#FFFFFF",
        borderRadius: 26,
        boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
        overflow: "hidden",
      }}
    >
      {/* sello EJEMPLO */}
      <div
        style={{
          position: "absolute",
          right: -70,
          top: 34,
          transform: "rotate(28deg)",
          background: "#C62828",
          color: "#fff",
          fontFamily: BRAND.font,
          fontWeight: 900,
          fontSize: 26,
          letterSpacing: 6,
          padding: "8px 90px",
        }}
      >
        EJEMPLO
      </div>

      {/* cabecera */}
      <div style={{ padding: "34px 40px 22px", borderBottom: "2px solid #E6E8EF" }}>
        <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.2, marginBottom: 22, paddingRight: 130 }}>
          Tu cuenta será cerrada
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#B06AB3,#E58C5A)",
              flex: "0 0 64px",
            }}
          />
          <div style={{ lineHeight: 1.35, fontSize: 28 }}>
            <div style={{ fontWeight: 700 }}>Soporte Instagram</div>
            <div style={{ color: "#5B6170", display: "inline-block", padding: "2px 6px", ...mark(highlight === "sender") }}>
              soporte@instagram-seguridad-ayuda.com
            </div>
          </div>
        </div>
      </div>

      {/* cuerpo */}
      <div style={{ padding: "26px 40px 36px", fontSize: 29, lineHeight: 1.45 }}>
        <p style={{ margin: "0 0 18px" }}>Hola,</p>
        <p style={{ margin: "0 0 18px" }}>
          Detectamos una infracción de derechos de autor en tu cuenta.{" "}
          <span style={{ display: "inline-block", padding: "2px 8px", fontWeight: 700, ...mark(highlight === "urgency") }}>
            Tienes 24 horas para verificar tu identidad o tu cuenta será eliminada.
          </span>
        </p>
        <div
          style={{
            display: "inline-block",
            marginTop: 8,
            padding: "16px 34px",
            borderRadius: 12,
            background: "#3B5BDB",
            color: "#fff",
            fontWeight: 700,
            fontSize: 26,
          }}
        >
          Verificar mi cuenta
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 26,
            color: "#5B6170",
            display: "inline-block",
            padding: "2px 8px",
            ...mark(highlight === "link"),
          }}
        >
          https://ig-verificacion-centro.net/login
        </div>
      </div>
    </div>
  );
};
