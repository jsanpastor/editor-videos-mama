import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { createTikTokStyleCaptions } from "@remotion/captions";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import {
  duracionTotalFrames,
  FPS,
  framesDeSegmento,
  type Fuente,
  type Plan,
  type PropsEditor,
  type Segmento,
  subtitulosEnLineaFinal,
  type TextoPlan,
} from "./plan";

const { fontFamily } = loadFont("normal", {
  weights: ["500", "700", "900"],
  subsets: ["latin", "latin-ext"],
});

const FILTROS: Record<Plan["filtro"], string> = {
  ninguno: "none",
  blanco_negro: "grayscale(1) contrast(1.1)",
  calido: "sepia(0.25) saturate(1.25) hue-rotate(-8deg) brightness(1.04)",
  frio: "saturate(0.9) hue-rotate(12deg) brightness(1.03) contrast(1.05)",
  vintage: "sepia(0.45) contrast(0.9) brightness(1.05) saturate(0.85)",
  vivo: "saturate(1.45) contrast(1.12)",
  suave: "brightness(1.08) contrast(0.92) saturate(0.95)",
};

const src = (f: Fuente) => (/^https?:\/\//.test(f.src) ? f.src : staticFile(f.src));

const Trozo: React.FC<{
  segmento: Segmento;
  fuente: Fuente;
  plan: Plan;
  volumen: (f: number) => number;
}> = ({ segmento, fuente, plan, volumen }) => {
  const frame = useCurrentFrame();
  const duracion = framesDeSegmento(segmento);
  const zoom = plan.zoomLento
    ? interpolate(frame, [0, duracion], [1, 1.08], { extrapolateRight: "clamp" })
    : 1;
  const comun = {
    src: src(fuente),
    trimBefore: Math.round(segmento.inicio * FPS),
    playbackRate: segmento.velocidad,
  };

  return (
    <AbsoluteFill style={{ filter: FILTROS[plan.filtro], backgroundColor: "black" }}>
      {plan.encaje === "encajar" ? (
        <AbsoluteFill>
          <OffthreadVideo
            {...comun}
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "blur(40px) brightness(0.65)",
              transform: "scale(1.2)",
            }}
          />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <OffthreadVideo
          {...comun}
          volume={volumen}
          style={{
            width: "100%",
            height: "100%",
            objectFit: plan.encaje === "encajar" ? "contain" : "cover",
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const POSICION: Record<TextoPlan["posicion"], React.CSSProperties> = {
  arriba: { justifyContent: "flex-start", paddingTop: "14%" },
  centro: { justifyContent: "center" },
  abajo: { justifyContent: "flex-end", paddingBottom: "22%" },
};

const Texto: React.FC<{ texto: TextoPlan; duracion: number }> = ({ texto, duracion }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const entrada = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const salida = interpolate(frame, [duracion - 8, duracion], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const base = width / 1080;

  const estilos: Record<TextoPlan["estilo"], React.CSSProperties> = {
    titulo: {
      fontSize: 92 * base,
      fontWeight: 900,
      color: texto.color,
      textShadow: "0 6px 24px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.8)",
      lineHeight: 1.08,
    },
    etiqueta: {
      fontSize: 62 * base,
      fontWeight: 700,
      color: "white",
      backgroundColor: texto.color,
      padding: `${18 * base}px ${36 * base}px`,
      borderRadius: 22 * base,
      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      lineHeight: 1.15,
    },
    minimal: {
      fontSize: 50 * base,
      fontWeight: 500,
      color: texto.color,
      letterSpacing: 2 * base,
      textShadow: "0 2px 12px rgba(0,0,0,0.7)",
      lineHeight: 1.2,
    },
    neon: {
      fontSize: 86 * base,
      fontWeight: 900,
      color: "white",
      textShadow: `0 0 ${10 * base}px ${texto.color}, 0 0 ${28 * base}px ${texto.color}, 0 0 ${60 * base}px ${texto.color}`,
      lineHeight: 1.1,
    },
  };

  return (
    <AbsoluteFill
      style={{ alignItems: "center", padding: `0 ${70 * base}px`, ...POSICION[texto.posicion] }}
    >
      <div
        style={{
          fontFamily,
          textAlign: "center",
          whiteSpace: "pre-wrap",
          opacity: entrada * salida,
          transform: `translateY(${(1 - entrada) * 40 * base}px) scale(${0.9 + entrada * 0.1})`,
          ...estilos[texto.estilo],
        }}
      >
        {texto.texto}
      </div>
    </AbsoluteFill>
  );
};

const Subtitulos: React.FC<{ props: PropsEditor }> = ({ props }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const base = width / 1080;
  const { plan } = props;

  const paginas = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions: subtitulosEnLineaFinal(plan, props.subtitulos),
        combineTokensWithinMilliseconds: 1100,
      }).pages,
    [plan, props.subtitulos],
  );

  const ahoraMs = (frame / fps) * 1000;
  const pagina = paginas.find(
    (p, i) =>
      ahoraMs >= p.startMs &&
      ahoraMs < Math.min(p.startMs + p.durationMs, paginas[i + 1]?.startMs ?? Infinity),
  );
  if (!pagina) return null;

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        padding: `0 ${60 * base}px`,
        ...POSICION[plan.subtitulos.posicion],
        ...(plan.subtitulos.posicion === "abajo" ? { paddingBottom: "15%" } : {}),
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 900,
          fontSize: 66 * base,
          lineHeight: 1.2,
          textAlign: "center",
          color: "white",
          WebkitTextStroke: `${10 * base}px black`,
          paintOrder: "stroke",
          textShadow: "0 4px 18px rgba(0,0,0,0.5)",
        }}
      >
        {pagina.tokens.map((t) => {
          const activa = ahoraMs >= t.fromMs && ahoraMs < t.toMs;
          return (
            <span
              key={t.fromMs}
              style={{ color: activa ? plan.subtitulos.colorResaltado : "white" }}
            >
              {t.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const EditorVideo: React.FC<PropsEditor> = (props) => {
  const { plan, fuentes } = props;
  const frame = useCurrentFrame();
  const total = duracionTotalFrames(plan);
  const fundido = Math.min(15, Math.floor(total / 4));

  const opacidad = interpolate(
    frame,
    [0, fundido, total - fundido, total],
    [plan.fundidoEntrada ? 0 : 1, 1, 1, plan.fundidoSalida ? 0 : 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) },
  );

  let desde = 0;
  const trozos = plan.segmentos.map((s, i) => {
    const duracion = framesDeSegmento(s);
    const inicioTrozo = desde;
    desde += duracion;
    // El volumen se calcula con el frame del trozo; lo pasamos a frame global
    // para aplicar también el fundido de sonido al principio y al final.
    const volumen = (f: number) => {
      const global = inicioTrozo + f;
      const fade = interpolate(
        global,
        [0, fundido, total - fundido, total],
        [plan.fundidoEntrada ? 0 : 1, 1, 1, plan.fundidoSalida ? 0 : 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      );
      return plan.volumen * fade;
    };
    return (
      <Sequence key={i} from={inicioTrozo} durationInFrames={duracion} premountFor={FPS}>
        <Trozo segmento={s} fuente={fuentes[s.video]} plan={plan} volumen={volumen} />
      </Sequence>
    );
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill style={{ opacity: opacidad }}>
        {trozos}
        {plan.subtitulos.activar ? <Subtitulos props={props} /> : null}
        {plan.textos.map((t, i) => {
          const inicio = Math.max(0, Math.round(t.inicio * FPS));
          const fin = Math.min(total, Math.round(t.fin * FPS));
          if (fin - inicio < 5) return null;
          return (
            <Sequence key={i} from={inicio} durationInFrames={fin - inicio}>
              <Texto texto={t} duracion={fin - inicio} />
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
