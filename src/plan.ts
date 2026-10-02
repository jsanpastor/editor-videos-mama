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

// Biblioteca de efectos de sonido (public/sonidos/*.wav, generados con
// herramientas/generar_sonidos.py). La descripción es lo que lee Claude.
export const SONIDOS = {
  whoosh: "aire rápido, el clásico de transición entre clips",
  swoosh_rapido: "barrido corto y agudo, para cortes muy rápidos",
  boom: "golpe grave e impactante, para un momento fuerte o el gran final",
  subida: "tensión que sube (2 s), para antes de una revelación o del 'antes y después'",
  glitch: "fallo digital, para transiciones tipo glitch",
  pop: "pop corto, para cuando aparece un texto o un emoji",
  burbuja: "burbuja suave, para textos pequeños o detalles",
  ding: "campanita, para un dato importante o un precio",
  notificacion: "aviso de móvil, para mensajes o recordatorios",
  click: "clic seco, para listas o pasos",
  camara: "disparo de cámara de fotos, para congelar un momento o mostrar una foto",
  teclas: "tecleo, para textos que se escriben letra a letra",
  disco_rayado: "disco rayado, para un momento de sorpresa o de humor ('¿perdona?')",
  brillo: "destellos mágicos, para un resultado bonito o un 'ta-chán'",
  caja_registradora: "caja registradora, para precios, ofertas o ventas",
  boing: "muelle cómico, para momentos graciosos",
} as const;
export type Sonido = keyof typeof SONIDOS;
const NOMBRES_SONIDOS = Object.keys(SONIDOS) as [Sonido, ...Sonido[]];
const sonidoOpcional = z.enum(["ninguno", ...NOMBRES_SONIDOS]);

// Letras inspiradas en los estilos de texto de Instagram (fuentes libres de
// Google Fonts parecidas; las originales de Instagram no se pueden usar fuera).
export const LETRAS = {
  clasica: "Clásica de Instagram: redonda, limpia y en negrita",
  moderna: "Moderna: mayúsculas estrechas y altas",
  neon: "Neón: letra de mano/caligráfica con brillo de color",
  maquina: "Máquina de escribir",
  fuerte: "Fuerte: mayúsculas muy gruesas e impactantes",
  elegante: "Elegante/literatura: con serifa, en cursiva",
  comic: "Cómic: divertida, de tebeo",
  manuscrita: "Manuscrita: como escrita a mano con rotulador",
} as const;
export type Letra = keyof typeof LETRAS;
const NOMBRES_LETRAS = Object.keys(LETRAS) as [Letra, ...Letra[]];

const segmentoSchema = z.object({
  video: z.number().describe("Índice del vídeo original (0 = el primero que subió)"),
  inicio: z.number().describe("Segundo del vídeo original donde empieza el trozo"),
  fin: z.number().describe("Segundo del vídeo original donde acaba el trozo"),
  velocidad: z
    .number()
    .describe("1 = normal, 2 = el doble de rápido, 0.5 = cámara lenta. Entre 0.25 y 4"),
  transicion: z
    .enum(["corte", "zoom", "flash", "deslizar", "glitch", "desenfoque", "fundido_negro"])
    .describe(
      "Cómo ENTRA este trozo (se ignora en el primero si no hay nada antes). corte: cambio seco; zoom: entra con un acercamiento rápido; flash: destello blanco; deslizar: barrido lateral rápido (whip pan); glitch: fallo digital con colores separados; desenfoque: entra desenfocado; fundido_negro: pasa por negro",
    ),
  sonidoEntrada: sonidoOpcional.describe(
    "Efecto de sonido que suena justo cuando empieza este trozo (p. ej. whoosh con deslizar/zoom, glitch con glitch)",
  ),
});

const textoSchema = z.object({
  texto: z.string().describe("Texto a mostrar. Corto (máx. ~30 caracteres por línea). Se permiten emojis y saltos de línea"),
  inicio: z.number().describe("Segundo del vídeo FINAL en que aparece"),
  fin: z.number().describe("Segundo del vídeo FINAL en que desaparece"),
  posicion: z.enum(["arriba", "centro", "abajo"]),
  letra: z.enum(NOMBRES_LETRAS),
  tamano: z.enum(["pequeno", "mediano", "grande"]),
  color: z.string().describe("Color de las letras en hexadecimal, p. ej. #FFFFFF"),
  fondo: z
    .enum(["ninguno", "caja", "caja_suave"])
    .describe("Como el botón 'A' de Instagram: sin fondo, caja de color sólido detrás del texto, o caja semitransparente"),
  colorFondo: z.string().describe("Color de la caja en hexadecimal (si fondo no es 'ninguno')"),
  animacion: z
    .enum(["aparecer", "rebote", "escribir", "deslizar", "zoom"])
    .describe("Cómo entra el texto. escribir = letra a letra como una máquina"),
  sonido: sonidoOpcional.describe("Efecto de sonido al aparecer el texto (pop, ding, teclas con 'escribir'...)"),
});

const efectoSchema = z.object({
  tipo: z
    .enum(["zoom_golpe", "temblor", "flash", "congelar_brillo"])
    .describe(
      "zoom_golpe: acercamiento brusco para remarcar algo; temblor: la imagen tiembla (impacto, risa); flash: destello blanco; congelar_brillo: destello suave tipo foto",
    ),
  inicio: z.number().describe("Segundo del vídeo FINAL"),
  duracion: z.number().describe("Segundos (0.2 a 2)"),
});

const sonidoLibreSchema = z.object({
  sonido: z.enum(NOMBRES_SONIDOS),
  inicio: z.number().describe("Segundo del vídeo FINAL"),
  volumen: z.number().describe("0.2 a 1"),
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
  quitarSilencios: z
    .boolean()
    .describe("Recorta automáticamente las pausas y silencios mientras se habla (cortes tipo jump cut)"),
  zoomAlterno: z
    .boolean()
    .describe("En trozos seguidos del mismo vídeo, alterna un plano normal y uno más cerca (típico de Reels hablados)"),
  filtro: z.enum(["ninguno", "blanco_negro", "calido", "frio", "vintage", "vivo", "suave"]),
  zoomLento: z.boolean().describe("Acercamiento lento y suave durante cada trozo"),
  fundidoEntrada: z.boolean(),
  fundidoSalida: z.boolean(),
  volumen: z.number().describe("Volumen del sonido original: 0 = silencio, 1 = normal, hasta 2"),
  volumenEfectos: z.number().describe("Volumen general de los efectos de sonido: 0.3 suave, 0.7 normal, 1 fuerte"),
  textos: z.array(textoSchema),
  efectos: z.array(efectoSchema),
  sonidos: z
    .array(sonidoLibreSchema)
    .describe("Efectos de sonido sueltos en momentos concretos (además de los de transiciones y textos)"),
  vozEnOff: z
    .object({
      inicio: z.number().describe("Segundo del vídeo FINAL en que empieza la voz grabada (normalmente 0 o 0.5)"),
      volumen: z.number().describe("Volumen de la voz: 1 normal, hasta 1.5"),
      volumenOriginal: z
        .number()
        .describe("Volumen del sonido de los clips MIENTRAS habla la voz en off (0 = se calla, 0.15 = de fondo)"),
      subtitulos: z.boolean().describe("Poner subtítulos de lo que dice la voz en off"),
    })
    .describe("Solo se usa si ella ha grabado una voz en off; si no, pon valores por defecto"),
  subtitulos: z.object({
    activar: z.boolean().describe("Subtítulos de lo que se habla DENTRO de los clips"),
    posicion: z.enum(["arriba", "centro", "abajo"]),
    estilo: z
      .enum(["resaltado", "caja", "clasico"])
      .describe(
        "resaltado: palabras grandes con borde y la que suena de color (estilo Reels); caja: texto negro sobre caja blanca como los subtítulos automáticos de Instagram; clasico: letras blancas sencillas",
      ),
    letra: z.enum(NOMBRES_LETRAS),
    colorResaltado: z.string().describe("Color hexadecimal de la palabra que se está diciendo"),
  }),
});

export type Plan = z.infer<typeof planSchema>;
export type Segmento = z.infer<typeof segmentoSchema>;
export type TextoPlan = z.infer<typeof textoSchema>;
export type EfectoPlan = z.infer<typeof efectoSchema>;

export type Fuente = {
  src: string; // ruta dentro de /public (staticFile) o URL
  duracion: number; // segundos
  ancho: number;
  alto: number;
};

export type VozEnOff = {
  src: string;
  duracion: number; // segundos
  subtitulos: Caption[]; // en milisegundos desde el principio de la grabación
};

export type PropsEditor = {
  plan: Plan;
  fuentes: Fuente[];
  // Subtítulos de cada vídeo original, en milisegundos del vídeo original
  subtitulos: Caption[][];
  voz: VozEnOff | null;
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
        : fuentes.map((f, i) => ({
            video: i,
            inicio: 0,
            fin: f.duracion,
            velocidad: 1,
            transicion: i === 0 ? ("corte" as const) : ("deslizar" as const),
            sonidoEntrada: i === 0 ? ("ninguno" as const) : ("whoosh" as const),
          })),
    volumen: limitar(plan.volumen, 0, 2),
    volumenEfectos: limitar(plan.volumenEfectos, 0, 1.2),
    efectos: plan.efectos.map((e) => ({ ...e, duracion: limitar(e.duracion, 0.15, 3) })),
    sonidos: plan.sonidos.map((s) => ({ ...s, volumen: limitar(s.volumen, 0.1, 1.2) })),
    vozEnOff: {
      ...plan.vozEnOff,
      inicio: limitar(plan.vozEnOff.inicio, 0, 600),
      volumen: limitar(plan.vozEnOff.volumen, 0.2, 1.5),
      volumenOriginal: limitar(plan.vozEnOff.volumenOriginal, 0, 1),
    },
  };
};

// Jump cuts: parte cada trozo en los tramos donde realmente se habla,
// usando los tiempos palabra a palabra de la transcripción.
export const aplicarQuitarSilencios = (plan: Plan, subtitulos: Caption[][]): Plan => {
  if (!plan.quitarSilencios) return plan;
  const ANTES = 0.08;
  const DESPUES = 0.15;
  const HUECO_MAX = 0.35;
  const segmentos: Segmento[] = [];
  for (const s of plan.segmentos) {
    const palabras = (subtitulos[s.video] ?? []).filter(
      (c) => c.endMs / 1000 > s.inicio && c.startMs / 1000 < s.fin,
    );
    if (palabras.length === 0) {
      segmentos.push(s);
      continue;
    }
    const tramos: { inicio: number; fin: number }[] = [];
    for (const p of palabras) {
      const ini = Math.max(s.inicio, p.startMs / 1000 - ANTES);
      const fin = Math.min(s.fin, p.endMs / 1000 + DESPUES);
      const ultimo = tramos[tramos.length - 1];
      if (ultimo && ini - ultimo.fin <= HUECO_MAX) ultimo.fin = Math.max(ultimo.fin, fin);
      else tramos.push({ inicio: ini, fin });
    }
    tramos
      .filter((t) => t.fin - t.inicio >= 0.25)
      .forEach((t, i) =>
        segmentos.push({
          ...s,
          ...t,
          // Solo el primer tramo conserva la transición y el sonido elegidos
          transicion: i === 0 ? s.transicion : "corte",
          sonidoEntrada: i === 0 ? s.sonidoEntrada : "ninguno",
        }),
      );
  }
  return { ...plan, segmentos: segmentos.length ? segmentos : plan.segmentos };
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
  segmentos: [
    { video: 0, inicio: 0, fin: 3, velocidad: 1, transicion: "corte", sonidoEntrada: "ninguno" },
    { video: 0, inicio: 4, fin: 7, velocidad: 1, transicion: "deslizar", sonidoEntrada: "whoosh" },
  ],
  quitarSilencios: false,
  zoomAlterno: false,
  filtro: "ninguno",
  zoomLento: true,
  fundidoEntrada: true,
  fundidoSalida: true,
  volumen: 1,
  volumenEfectos: 0.7,
  textos: [
    {
      texto: "¡Hola! 👋",
      inicio: 0.3,
      fin: 2.8,
      posicion: "arriba",
      letra: "clasica",
      tamano: "grande",
      color: "#FFFFFF",
      fondo: "ninguno",
      colorFondo: "#000000",
      animacion: "rebote",
      sonido: "pop",
    },
  ],
  efectos: [],
  sonidos: [],
  vozEnOff: { inicio: 0.5, volumen: 1, volumenOriginal: 0.15, subtitulos: true },
  subtitulos: {
    activar: true,
    posicion: "abajo",
    estilo: "resaltado",
    letra: "clasica",
    colorResaltado: "#FFD43B",
  },
};
