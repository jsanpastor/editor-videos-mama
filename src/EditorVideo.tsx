import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
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
import { loadFont as cargarFigtree } from "@remotion/google-fonts/Figtree";
import { loadFont as cargarBebas } from "@remotion/google-fonts/BebasNeue";
import { loadFont as cargarYellowtail } from "@remotion/google-fonts/Yellowtail";
import { loadFont as cargarCourier } from "@remotion/google-fonts/CourierPrime";
import { loadFont as cargarAnton } from "@remotion/google-fonts/Anton";
import { loadFont as cargarPlayfair } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as cargarBangers } from "@remotion/google-fonts/Bangers";
import { loadFont as cargarCaveat } from "@remotion/google-fonts/Caveat";
import {
  duracionTotalFrames,
  type EfectoPlan,
  FPS,
  lineaDeTiempo,
  type Tramo,
  type Transicion,
  ventanaTexto,
  type Fuente,
  type Letra,
  type Plan,
  type PropsEditor,
  type Segmento,
  subtitulosEnLineaFinal,
  type TextoPlan,
} from "./plan";

const latinas = { subsets: ["latin", "latin-ext"] as ("latin" | "latin-ext")[] };
const LETRAS: Record<Letra, React.CSSProperties> = {
  clasica: { fontFamily: cargarFigtree("normal", { weights: ["700", "800"], ...latinas }).fontFamily, fontWeight: 800 },
  moderna: {
    fontFamily: cargarBebas("normal", { weights: ["400"], ...latinas }).fontFamily,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  neon: { fontFamily: cargarYellowtail("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily },
  maquina: { fontFamily: cargarCourier("normal", { weights: ["700"], ...latinas }).fontFamily, fontWeight: 700 },
  fuerte: {
    fontFamily: cargarAnton("normal", { weights: ["400"], ...latinas }).fontFamily,
    textTransform: "uppercase",
  },
  elegante: {
    fontFamily: cargarPlayfair("italic", { weights: ["700"], ...latinas }).fontFamily,
    fontStyle: "italic",
    fontWeight: 700,
  },
  comic: { fontFamily: cargarBangers("normal", { weights: ["400"], ...latinas }).fontFamily, letterSpacing: "0.03em" },
  manuscrita: { fontFamily: cargarCaveat("normal", { weights: ["700"], ...latinas }).fontFamily, fontWeight: 700 },
};
// Algunas letras son más pequeñas o más grandes "a ojo" con el mismo tamaño
const ESCALA_LETRA: Record<Letra, number> = {
  clasica: 1,
  moderna: 1.25,
  neon: 1.15,
  maquina: 0.95,
  fuerte: 1.1,
  elegante: 1,
  comic: 1.15,
  manuscrita: 1.3,
};

const FILTROS: Record<Plan["filtro"], string> = {
  ninguno: "none",
  blanco_negro: "grayscale(1) contrast(1.1)",
  calido: "sepia(0.25) saturate(1.25) hue-rotate(-8deg) brightness(1.04)",
  frio: "saturate(0.9) hue-rotate(12deg) brightness(1.03) contrast(1.05)",
  vintage: "sepia(0.45) contrast(0.9) brightness(1.05) saturate(0.85)",
  vivo: "saturate(1.45) contrast(1.12)",
  suave: "brightness(1.08) contrast(0.92) saturate(0.95)",
};

const NEGRO_FRAMES = 8; // duración de cada mitad del "fundido a negro"

const src = (f: Fuente) => (/^https?:\/\//.test(f.src) ? f.src : staticFile(f.src));
const curva = Easing.inOut(Easing.cubic);
const progreso = (f: number, desde: number, frames: number) =>
  frames <= 0 ? 1 : curva(interpolate(f, [desde, desde + frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

// Fundido cruzado: el trozo que entra (encima) aparece poco a poco sobre el que
// sale, que sigue intacto debajo (sin zooms ni desplazamientos: imagen limpia).
const estiloTransicion = (frame: number, tramo: Tramo, entrada: Transicion): React.CSSProperties =>
  entrada === "fundido" && tramo.solapeEntrada > 0 && frame < tramo.solapeEntrada
    ? { opacity: progreso(frame, 0, tramo.solapeEntrada) }
    : {};

const Trozo: React.FC<{
  segmento: Segmento;
  tramo: Tramo;
  siguiente: Transicion | null;
  fuente: Fuente;
  plan: Plan;
  cerca: boolean;
  primero: boolean;
  volumen: (f: number) => number;
}> = ({ segmento, tramo, siguiente, fuente, plan, cerca, primero, volumen }) => {
  const frame = useCurrentFrame();
  const duracion = tramo.duracion;
  const zoom =
    (plan.zoomLento ? interpolate(frame, [0, duracion], [1, 1.06], { extrapolateRight: "clamp" }) : 1) *
    (cerca ? 1.15 : 1);
  const entrada: Transicion = primero ? "corte" : segmento.transicion;
  const comun = {
    src: src(fuente),
    trimBefore: Math.round(segmento.inicio * FPS),
    playbackRate: segmento.velocidad,
  };
  // Fundido a negro: el que sale se oscurece al final y el que entra aparece desde negro
  const negro = Math.max(
    entrada === "fundido_negro" ? 1 - progreso(frame, 0, NEGRO_FRAMES) : 0,
    siguiente === "fundido_negro" ? progreso(frame, duracion - NEGRO_FRAMES, NEGRO_FRAMES) : 0,
  );

  return (
    <AbsoluteFill style={{ overflow: "hidden", ...estiloTransicion(frame, tramo, entrada) }}>
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
      {negro > 0 ? <AbsoluteFill style={{ backgroundColor: "black", opacity: negro }} /> : null}
    </AbsoluteFill>
  );
};

// Zonas seguras de Instagram (Reels e Historias en 1080x1920): arriba van el
// nombre/la barra de progreso, abajo la descripción y a la derecha los botones
// de "me gusta", comentar y compartir. Los textos nunca entran ahí.
const zonaSegura = (width: number, height: number) => {
  const vertical = height / width > 1.5;
  return {
    arriba: vertical ? 0.14 * height : 0.08 * height,
    abajo: vertical ? 0.24 * height : 0.1 * height,
    izquierda: 0.07 * width,
    derecha: vertical ? 0.15 * width : 0.07 * width,
  };
};

const usePosicion = (posicion: TextoPlan["posicion"]): React.CSSProperties => {
  const { width, height } = useVideoConfig();
  const z = zonaSegura(width, height);
  return {
    alignItems: "center",
    paddingLeft: z.izquierda,
    paddingRight: z.derecha,
    paddingTop: z.arriba,
    paddingBottom: z.abajo,
    justifyContent: posicion === "arriba" ? "flex-start" : posicion === "abajo" ? "flex-end" : "center",
  };
};

const TAMANOS: Record<TextoPlan["tamano"], number> = { pequeno: 48, mediano: 68, grande: 96 };

const Texto: React.FC<{ texto: TextoPlan; duracion: number }> = ({ texto, duracion }) => {
  const frame = useCurrentFrame();
  const posicion = usePosicion(texto.posicion);
  const { fps, width } = useVideoConfig();
  const base = width / 1080;
  const muelle = spring({ frame, fps, config: { damping: texto.animacion === "rebote" ? 9 : 16, mass: 0.6 } });
  const salida = interpolate(frame, [duracion - 7, duracion], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  let transform = "";
  let opacidad = salida;
  let contenido = texto.texto;
  switch (texto.animacion) {
    case "rebote":
      transform = `scale(${muelle})`;
      break;
    case "zoom":
      transform = `scale(${interpolate(muelle, [0, 1], [2.2, 1])})`;
      opacidad *= muelle;
      break;
    case "deslizar":
      transform = `translateX(${(1 - muelle) * -width * 0.5}px)`;
      opacidad *= muelle;
      break;
    case "escribir": {
      const letras = Array.from(texto.texto);
      contenido = letras.slice(0, Math.floor(frame / 1.6)).join("");
      break;
    }
    default:
      transform = `translateY(${(1 - muelle) * 30 * base}px)`;
      opacidad *= muelle;
  }

  const tamano = TAMANOS[texto.tamano] * ESCALA_LETRA[texto.letra] * base;
  const conCaja = texto.fondo !== "ninguno";
  const brilloNeon =
    texto.letra === "neon"
      ? `0 0 ${8 * base}px ${texto.color}, 0 0 ${22 * base}px ${texto.color}, 0 0 ${48 * base}px ${texto.color}`
      : conCaja
        ? "none"
        : "0 4px 18px rgba(0,0,0,0.55), 0 2px 3px rgba(0,0,0,0.7)";

  return (
    <AbsoluteFill style={posicion}>
      <div style={{ textAlign: "center", opacity: opacidad, transform, maxWidth: "100%" }}>
        <span
          style={{
            ...LETRAS[texto.letra],
            fontSize: tamano,
            lineHeight: 1.32,
            color: texto.letra === "neon" ? "#FFFFFF" : texto.color,
            textShadow: brilloNeon,
            whiteSpace: "pre-wrap",
            // Caja detrás de cada línea, como el fondo de texto de Instagram
            backgroundColor: conCaja ? texto.colorFondo : undefined,
            opacity: 1,
            padding: conCaja ? `${0.08 * tamano}px ${0.28 * tamano}px` : undefined,
            borderRadius: conCaja ? 0.22 * tamano : undefined,
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
            ...(texto.fondo === "caja_suave" ? { backgroundColor: hexConAlfa(texto.colorFondo, 0.6) } : {}),
          }}
        >
          {contenido}
        </span>
      </div>
    </AbsoluteFill>
  );
};

const hexConAlfa = (hex: string, alfa: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0,0,0,${alfa})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
};

const Subtitulos: React.FC<{ props: PropsEditor }> = ({ props }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const base = width / 1080;
  const { plan } = props;
  const { estilo, letra, colorResaltado, posicion } = plan.subtitulos;
  const estiloPosicion = usePosicion(posicion);

  const paginas = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions: [
          ...(plan.subtitulos.activar ? subtitulosEnLineaFinal(plan, props.subtitulos) : []),
          // La voz en off ya está en la línea de tiempo final: solo hay que desplazarla
          ...(props.voz && plan.vozEnOff.subtitulos
            ? props.voz.subtitulos.map((c) => {
                const d = plan.vozEnOff.inicio * 1000;
                return { ...c, startMs: c.startMs + d, endMs: c.endMs + d, timestampMs: c.timestampMs === null ? null : c.timestampMs + d };
              })
            : []),
        ].sort((a, b) => a.startMs - b.startMs),
        combineTokensWithinMilliseconds: estilo === "resaltado" ? 900 : 1400,
      }).pages,
    [plan, props.subtitulos, props.voz, estilo],
  );

  const ahoraMs = (frame / fps) * 1000;
  const pagina = paginas.find(
    (p, i) => ahoraMs >= p.startMs && ahoraMs < Math.min(p.startMs + p.durationMs, paginas[i + 1]?.startMs ?? Infinity),
  );
  if (!pagina) return null;

  const tamano = (estilo === "resaltado" ? 68 : 50) * ESCALA_LETRA[letra] * base;
  const estilos: React.CSSProperties =
    estilo === "caja"
      ? {
          color: "black",
          backgroundColor: "white",
          padding: `${0.12 * tamano}px ${0.35 * tamano}px`,
          borderRadius: 0.25 * tamano,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }
      : estilo === "clasico"
        ? { color: "white", textShadow: "0 2px 10px rgba(0,0,0,0.8), 0 0 3px rgba(0,0,0,0.9)" }
        : {
            color: "white",
            WebkitTextStroke: `${0.15 * tamano}px black`,
            paintOrder: "stroke",
            textShadow: "0 4px 18px rgba(0,0,0,0.5)",
          };

  return (
    <AbsoluteFill style={estiloPosicion}>
      <div style={{ textAlign: "center", lineHeight: 1.35 }}>
        <span style={{ ...LETRAS[letra], fontSize: tamano, ...estilos }}>
          {pagina.tokens.map((t) => {
            const activa = estilo === "resaltado" && ahoraMs >= t.fromMs && ahoraMs < t.toMs;
            return (
              <span key={t.fromMs} style={activa ? { color: colorResaltado } : undefined}>
                {t.text}
              </span>
            );
          })}
        </span>
      </div>
    </AbsoluteFill>
  );
};

// Efectos sobre todo el vídeo en momentos concretos
const transformEfectos = (efectos: EfectoPlan[], frame: number) => {
  let escala = 1;
  let x = 0;
  let y = 0;
  for (const e of efectos) {
    const ini = Math.round(e.inicio * FPS);
    const dur = Math.max(4, Math.round(e.duracion * FPS));
    const f = frame - ini;
    if (f < 0 || f >= dur) continue;
    if (e.tipo === "zoom_golpe") {
      const entrada = interpolate(f, [0, 3], [1, 1.28], { extrapolateRight: "clamp" });
      const vuelta = interpolate(f, [dur - 4, dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      escala *= entrada - (entrada - 1) * vuelta;
    } else if (e.tipo === "temblor") {
      const fuerza = interpolate(f, [0, dur], [1, 0.2]);
      x += Math.sin(f * 2.9) * 22 * fuerza;
      y += Math.cos(f * 3.7) * 16 * fuerza;
      escala *= 1.06;
    }
  }
  return `translate(${x}px, ${y}px) scale(${escala})`;
};

const Destellos: React.FC<{ efectos: EfectoPlan[] }> = ({ efectos }) => {
  const frame = useCurrentFrame();
  let blanco = 0;
  for (const e of efectos) {
    if (e.tipo !== "flash" && e.tipo !== "congelar_brillo") continue;
    const f = frame - Math.round(e.inicio * FPS);
    const largo = e.tipo === "flash" ? 7 : 14;
    if (f < 0 || f > largo) continue;
    blanco = Math.max(blanco, interpolate(f, [0, largo], [e.tipo === "flash" ? 1 : 0.6, 0]));
  }
  return blanco > 0 ? <AbsoluteFill style={{ backgroundColor: "white", opacity: blanco }} /> : null;
};

const Efecto: React.FC<{ sonido: string; volumen: number }> = ({ sonido, volumen }) => (
  <Audio src={staticFile(`sonidos/${sonido}.wav`)} volume={volumen} />
);

export const EditorVideo: React.FC<PropsEditor> = (props) => {
  const { plan, fuentes } = props;
  const frame = useCurrentFrame();
  const total = duracionTotalFrames(plan);
  const fundido = Math.min(15, Math.floor(total / 4));
  const vfx = plan.volumenEfectos;
  const voz = props.voz;
  const vozDesde = voz ? Math.round(plan.vozEnOff.inicio * FPS) : 0;
  const vozHasta = voz ? vozDesde + Math.round(voz.duracion * FPS) : 0;
  // Mientras habla la voz en off, el sonido de los clips baja ("ducking")
  const factorVoz = (global: number) =>
    voz
      ? interpolate(global, [vozDesde - 6, vozDesde, vozHasta, vozHasta + 8], [1, plan.vozEnOff.volumenOriginal, plan.vozEnOff.volumenOriginal, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  const opacidad = interpolate(
    frame,
    [0, fundido, total - fundido, total],
    [plan.fundidoEntrada ? 0 : 1, 1, 1, plan.fundidoSalida ? 0 : 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) },
  );

  const { tramos } = lineaDeTiempo(plan);
  let cerca = false;
  const sonidosTransicion: React.ReactNode[] = [];
  const trozos = plan.segmentos.map((s, i) => {
    const tramo = tramos[i];
    const siguiente = plan.segmentos[i + 1]?.transicion ?? null;
    // Plano normal / plano cerca alternando cuando se encadenan trozos del mismo vídeo
    const anterior = plan.segmentos[i - 1];
    cerca = plan.zoomAlterno && anterior?.video === s.video ? !cerca : false;
    const volumen = (f: number) => {
      const global = tramo.inicio + f;
      const fade = interpolate(
        global,
        [0, fundido, total - fundido, total],
        [plan.fundidoEntrada ? 0 : 1, 1, 1, plan.fundidoSalida ? 0 : 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      );
      // En los solapes, el sonido de un trozo se cruza con el del otro
      const cruce = Math.min(
        tramo.solapeEntrada > 0 ? interpolate(f, [0, tramo.solapeEntrada], [0, 1], { extrapolateRight: "clamp" }) : 1,
        tramo.solapeSalida > 0
          ? interpolate(f, [tramo.duracion - tramo.solapeSalida, tramo.duracion], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
          : 1,
      );
      return plan.volumen * fade * cruce * factorVoz(global);
    };
    if (s.sonidoEntrada !== "ninguno") {
      // El whoosh suena un pelín antes del corte para que acompañe la transición
      const adelanto = ["whoosh", "swoosh_rapido", "subida"].includes(s.sonidoEntrada)
        ? s.sonidoEntrada === "subida" ? 55 : 6
        : 0;
      sonidosTransicion.push(
        <Sequence key={`st${i}`} from={Math.max(0, tramo.inicio - adelanto)} durationInFrames={FPS * 3}>
          <Efecto sonido={s.sonidoEntrada} volumen={0.6 * vfx} />
        </Sequence>,
      );
    }
    return (
      <Sequence key={i} from={tramo.inicio} durationInFrames={tramo.duracion} premountFor={FPS}>
        <Trozo
          segmento={s}
          tramo={tramo}
          siguiente={siguiente}
          fuente={fuentes[s.video]}
          plan={plan}
          cerca={cerca}
          primero={i === 0}
          volumen={volumen}
        />
      </Sequence>
    );
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill style={{ opacity: opacidad }}>
        <AbsoluteFill style={{ transform: transformEfectos(plan.efectos, frame) }}>{trozos}</AbsoluteFill>
        <Destellos efectos={plan.efectos} />
        {plan.subtitulos.activar || (voz && plan.vozEnOff.subtitulos) ? <Subtitulos props={props} /> : null}
        {plan.textos.map((t, i) => {
          const { desde: inicio, hasta: fin } = ventanaTexto(plan, t, tramos, total);
          if (fin - inicio < 5) return null;
          return (
            <Sequence key={i} from={inicio} durationInFrames={fin - inicio}>
              <Texto texto={t} duracion={fin - inicio} />
              {t.sonido !== "ninguno" ? <Efecto sonido={t.sonido} volumen={0.7 * vfx} /> : null}
            </Sequence>
          );
        })}
      </AbsoluteFill>
      {voz ? (
        <Sequence from={vozDesde}>
          <Audio src={/^https?:\/\//.test(voz.src) ? voz.src : staticFile(voz.src)} volume={plan.vozEnOff.volumen} />
        </Sequence>
      ) : null}
      {sonidosTransicion}
      {plan.sonidos.map((s, i) => (
        <Sequence key={`s${i}`} from={Math.max(0, Math.round(s.inicio * FPS))} durationInFrames={FPS * 3}>
          <Efecto sonido={s.sonido} volumen={s.volumen * vfx} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
