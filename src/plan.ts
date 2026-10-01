import { z } from "zod";
import type { Caption } from "@remotion/captions";

// El "plan de edición" es lo que Claude devuelve a partir de las instrucciones
// de mamá. Remotion solo sabe dibujar lo que cabe en este esquema, así que
// todo lo que la app puede hacer está descrito aquí.

export const FPS = 30;

export const FORMATOS = {
  vertical: { width: 1080, height: 1920 }, // Reels / Historias (9:16)
  retrato: { width: 1080, height: 1350 }, // Publicación del feed (4:5)
  cuadrado: { width: 1080, height: 1080 }, // Publicación cuadrada (1:1)
} as const;

const segmentoSchema = z.object({
  video: z
    .number()
    .describe("Índice del vídeo original (0 = el primero que subió)"),
  inicio: z.number().describe("Segundo del vídeo original donde empieza el trozo"),
  fin: z.number().describe("Segundo del vídeo original donde acaba el trozo"),
  velocidad: z
    .number()
    .describe("1 = normal, 2 = el doble de rápido, 0.5 = cámara lenta. Entre 0.25 y 4"),
});

const textoSchema = z.object({
  texto: z.string().describe("Texto a mostrar. Corto (máx. ~40 caracteres por línea). Se permiten emojis"),
  inicio: z.number().describe("Segundo del vídeo FINAL en que aparece"),
  fin: z.number().describe("Segundo del vídeo FINAL en que desaparece"),
  posicion: z.enum(["arriba", "centro", "abajo"]),
  estilo: z
    .enum(["titulo", "etiqueta", "minimal", "neon"])
    .describe(
      "titulo: letras grandes blancas con sombra; etiqueta: texto sobre caja de color; minimal: texto pequeño elegante; neon: letras con brillo de color",
    ),
  color: z.string().describe("Color principal en hexadecimal, p. ej. #FF4F8B"),
});

export const planSchema = z.object({
  resumen: z
    .string()
    .describe(
      "Explicación breve y cariñosa, en español sencillo, de lo que has hecho con el vídeo. Si algo de lo que pidió no se puede hacer, dilo aquí con amabilidad",
    ),
  textoInstagram: z
    .string()
    .describe("Propuesta de texto para la publicación de Instagram, con algún emoji y 3-6 hashtags"),
  formato: z.enum(["vertical", "retrato", "cuadrado"]),
  encaje: z
    .enum(["rellenar", "encajar"])
    .describe(
      "rellenar: el vídeo ocupa toda la pantalla (recorta bordes); encajar: se ve entero con fondo difuminado",
    ),
  segmentos: z
    .array(segmentoSchema)
    .describe("Trozos de los vídeos originales que se quedan, en el orden en que se verán"),
  filtro: z.enum(["ninguno", "blanco_negro", "calido", "frio", "vintage", "vivo", "suave"]),
  zoomLento: z.boolean().describe("Acercamiento lento y suave durante cada trozo"),
  fundidoEntrada: z.boolean(),
  fundidoSalida: z.boolean(),
  volumen: z.number().describe("Volumen del sonido original: 0 = silencio, 1 = normal, hasta 2"),
  textos: z.array(textoSchema),
  subtitulos: z.object({
    activar: z.boolean(),
    posicion: z.enum(["arriba", "centro", "abajo"]),
    colorResaltado: z.string().describe("Color hexadecimal de la palabra que se está diciendo"),
  }),
});

export type Plan = z.infer<typeof planSchema>;
export type Segmento = z.infer<typeof segmentoSchema>;
export type TextoPlan = z.infer<typeof textoSchema>;

export type Fuente = {
  src: string; // ruta dentro de /public (staticFile) o URL
  duracion: number; // segundos
  ancho: number;
  alto: number;
};

export type PropsEditor = {
  plan: Plan;
  fuentes: Fuente[];
  // Subtítulos de cada vídeo original, en milisegundos del vídeo original
  subtitulos: Caption[][];
};

const limitar = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

// Claude puede equivocarse con algún número: aquí se corrige todo lo que
// haría fallar el render (trozos fuera de rango, velocidades absurdas...).
export const sanearPlan = (plan: Plan, fuentes: Fuente[]): Plan => {
  const segmentos = plan.segmentos
    .map((s) => ({ ...s, video: Math.round(s.video) }))
    .filter((s) => s.video >= 0 && s.video < fuentes.length)
    .map((s) => {
      const dur = fuentes[s.video].duracion;
      const inicio = limitar(s.inicio, 0, dur);
      const fin = limitar(s.fin, inicio, dur);
      return { ...s, inicio, fin, velocidad: limitar(s.velocidad, 0.25, 4) };
    })
    .filter((s) => s.fin - s.inicio >= 0.2);

  return {
    ...plan,
    segmentos:
      segmentos.length > 0
        ? segmentos
        : fuentes.map((f, i) => ({ video: i, inicio: 0, fin: f.duracion, velocidad: 1 })),
    volumen: limitar(plan.volumen, 0, 2),
  };
};

export const framesDeSegmento = (s: Segmento) =>
  Math.max(1, Math.round(((s.fin - s.inicio) / s.velocidad) * FPS));

export const duracionTotalFrames = (plan: Plan) =>
  plan.segmentos.reduce((acc, s) => acc + framesDeSegmento(s), 0);

// Pasa los subtítulos (en tiempo del vídeo original) a la línea de tiempo
// del vídeo final, teniendo en cuenta cortes y cambios de velocidad.
export const subtitulosEnLineaFinal = (
  plan: Plan,
  subtitulos: Caption[][],
): Caption[] => {
  const resultado: Caption[] = [];
  let inicioSegmentoMs = 0;
  for (const s of plan.segmentos) {
    const desdeMs = s.inicio * 1000;
    const hastaMs = s.fin * 1000;
    for (const c of subtitulos[s.video] ?? []) {
      if (c.startMs < desdeMs || c.startMs >= hastaMs) continue;
      const mapear = (ms: number) =>
        inicioSegmentoMs + (Math.min(ms, hastaMs) - desdeMs) / s.velocidad;
      resultado.push({
        ...c,
        startMs: mapear(c.startMs),
        endMs: mapear(c.endMs),
        timestampMs: c.timestampMs === null ? null : mapear(c.timestampMs),
      });
    }
    inicioSegmentoMs += (framesDeSegmento(s) / FPS) * 1000;
  }
  return resultado;
};

export const planPorDefecto: Plan = {
  resumen: "Vídeo de prueba",
  textoInstagram: "",
  formato: "vertical",
  encaje: "encajar",
  segmentos: [{ video: 0, inicio: 0, fin: 5, velocidad: 1 }],
  filtro: "ninguno",
  zoomLento: true,
  fundidoEntrada: true,
  fundidoSalida: true,
  volumen: 1,
  textos: [
    {
      texto: "¡Hola! 👋",
      inicio: 0.3,
      fin: 3,
      posicion: "arriba",
      estilo: "titulo",
      color: "#FFFFFF",
    },
  ],
  subtitulos: { activar: true, posicion: "abajo", colorResaltado: "#FFD43B" },
};
