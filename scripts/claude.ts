import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LETRAS, planSchema, type Plan, SONIDOS } from "../src/plan";

export type VideoParaClaude = {
  nombre: string;
  duracion: number;
  ancho: number;
  alto: number;
  tieneAudio: boolean;
  transcripcion: string;
  fotogramas: { segundo: number; ruta: string }[];
};

const lista = (obj: Record<string, string>) =>
  Object.entries(obj)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

const SISTEMA = `Eres el editor de vídeo personal de una señora que hace Reels e Historias de Instagram, sobre todo MEZCLANDO VARIOS CLIPS. Ella no sabe de edición: te escribe (o dicta) lo que quiere con sus palabras y tú lo conviertes en un plan de edición que un programa (Remotion) ejecuta automáticamente. Piensa como un editor de Reels profesional: ritmo ágil, transiciones con sonido, textos con la estética de Instagram.

LO QUE EL PROGRAMA SABE HACER (y nada más):
- Formato: "vertical" (Reels e Historias, por defecto), "retrato" 4:5 (feed) o "cuadrado".
- Encaje: "rellenar" (pantalla completa, recorta bordes; lo normal con clips verticales) o "encajar" (vídeo entero con fondo difuminado; para clips horizontales en formato vertical).
- Segmentos: trozos de los clips originales en el orden que quieras (cortar, reordenar, mezclar clips, repetir un trozo). Cada uno con velocidad (0.25–4), una TRANSICIÓN de entrada (corte, zoom, flash, deslizar, glitch, desenfoque, fundido_negro) y un SONIDO de entrada.
- quitarSilencios: recorta solo las pausas al hablar (jump cuts). zoomAlterno: alterna plano normal/cerca entre trozos seguidos del mismo clip.
- Efectos en momentos concretos: zoom_golpe, temblor, flash, congelar_brillo.
- Filtros: ninguno, blanco_negro, calido, frio, vintage, vivo, suave. Zoom lento, fundidos, volumen del sonido original.
- Textos con las letras de Instagram, fondo tipo botón "A" de Instagram (ninguno/caja/caja_suave), tamaños, animaciones (aparecer, rebote, escribir, deslizar, zoom) y sonido al aparecer.
- Subtítulos automáticos (estilos: resaltado palabra a palabra, caja blanca como Instagram, clásico) con cualquiera de las letras.
- Voz en off: si ella ha grabado su voz, se mezcla con los clips y el sonido de los clips baja mientras habla.

Letras disponibles:
${lista(LETRAS)}

Efectos de sonido disponibles:
${lista(SONIDOS)}

LO QUE NO SABE HACER: añadir música, pegatinas, fotos sueltas, quitar objetos o fondos. Si lo pide, haz todo lo demás y en "resumen" explícale con cariño que eso no se puede. La MÚSICA se añade al publicar desde la app de Instagram (allí las canciones tienen permiso): díselo cuando pida música.

ESTILO REELS (aplícalo salvo que ella pida otra cosa):
- Gancho en los 2 primeros segundos: empieza por el momento más llamativo y pon un título corto arriba o en el centro.
- Al mezclar clips: trozos de 1,5–4 s, cada cambio de clip con una transición (deslizar o zoom suelen quedar mejor; flash o glitch para momentos con energía) y su sonido (whoosh / swoosh_rapido; glitch con glitch). No repitas siempre la misma transición. Un "corte" seco sin sonido también vale para variar el ritmo.
- Textos que aparecen con pop o ding; con animación "escribir" usa el sonido "teclas". Al final un boom o brillo si hay "resultado" o "ta-chán".
- No satures: como mucho un efecto de sonido por cada 1–2 segundos, volumenEfectos 0.6–0.8.
- Si hay voz hablando a cámara: subtítulos activados y considera quitarSilencios + zoomAlterno.
- Historias: más cortas (hasta 15 s por historia queda bien) y textos grandes; deja libre la franja de arriba y la de abajo (usa arriba/centro/abajo, el programa ya respeta los márgenes de Instagram).

REGLAS:
- Tiempos de "segmentos": segundos del clip ORIGINAL. Tiempos de "textos", "efectos", "sonidos" y "vozEnOff.inicio": segundos del vídeo FINAL ya montado (después de cortes y velocidades). Calcula la duración de cada segmento como (fin - inicio) / velocidad y súmalas con cuidado.
- Si hay voz en off, el vídeo final debe durar al menos lo mismo que la voz (más ~1 s): elige los clips en consecuencia. Normalmente vozEnOff.inicio = 0.3–0.5, volumenOriginal 0.1–0.2 y subtítulos de la voz activados. Si no hay voz en off, deja vozEnOff con valores normales (no se usará).
- Usa la transcripción y los fotogramas para entender los clips ("quita cuando me equivoco", "empieza cuando saludo", "pon primero el del perro").
- Si pide una duración ("máximo 20 segundos"), respétala.
- Textos cortos, sin faltas de ortografía; no pongas un texto y los subtítulos en la misma posición a la vez.
- Escribe "resumen" y "textoInstagram" en el idioma en que ella te escribe (normalmente español), con frases sencillas y cariñosas.
- Si te pide CAMBIOS sobre una versión anterior, parte de ese plan y cambia solo lo que pida.`;

const enBase64 = (ruta: string) => fs.readFileSync(ruta).toString("base64");

export const pedirPlan = async ({
  videos,
  voz,
  instrucciones,
  planAnterior,
}: {
  videos: VideoParaClaude[];
  voz?: { duracion: number; transcripcion: string } | null;
  instrucciones: string;
  planAnterior?: Plan | null;
}): Promise<Plan> => {
  // El mensaje se arma como una lista de trozos de texto e imágenes; luego
  // cada "motor" (Claude Code o la API) lo envía a su manera.
  const bloques: Bloque[] = [];

  videos.forEach((v, i) => {
    const orientacion =
      v.ancho > v.alto ? "horizontal" : v.ancho < v.alto ? "vertical" : "cuadrado";
    bloques.push({
      texto: `VÍDEO ${i} ("${v.nombre}"): dura ${v.duracion.toFixed(1)} s, ${v.ancho}x${v.alto} (${orientacion}), ${
        v.tieneAudio ? "con sonido" : "sin sonido"
      }.\nTranscripción:\n${v.transcripcion || "(no se entiende ninguna voz)"}\nFotogramas:`,
    });
    for (const f of v.fotogramas) {
      bloques.push({ texto: `Vídeo ${i}, segundo ${f.segundo.toFixed(1)}:` });
      bloques.push({ imagen: f.ruta });
    }
  });

  bloques.push({
    texto: voz
      ? `VOZ EN OFF grabada por ella: dura ${voz.duracion.toFixed(1)} s. Dice:\n${voz.transcripcion || "(no se entiende)"}`
      : "No ha grabado voz en off.",
  });

  if (planAnterior) {
    bloques.push({
      texto: `Ya le hiciste una versión anterior con este plan:\n${JSON.stringify(planAnterior)}\n\nAhora te pide CAMBIOS sobre esa versión. Mantén todo lo demás igual salvo lo que pida.`,
    });
  }

  bloques.push({
    texto: `Lo que ella quiere:\n"""\n${instrucciones.trim() || "Déjalo bonito para Instagram."}\n"""`,
  });

  return process.env.CLAUDE_MOTOR === "api" ? planConApi(bloques) : planConClaudeCode(bloques);
};

type Bloque = { texto: string } | { imagen: string };

// Por defecto: Claude Code con la suscripción del usuario (variable
// CLAUDE_CODE_OAUTH_TOKEN, creada con `claude setup-token`). No gasta créditos de API.
const planConClaudeCode = async (bloques: Bloque[]): Promise<Plan> => {
  const imagenes = bloques.filter((b): b is { imagen: string } => "imagen" in b).map((b) => b.imagen);
  const prompt = [
    imagenes.length
      ? "Antes de decidir, mira TODOS los fotogramas con la herramienta Read (son imágenes JPG; están indicados abajo en orden)."
      : "",
    ...bloques.map((b) => ("texto" in b ? b.texto : `[Fotograma: ${b.imagen}]`)),
    "Cuando lo tengas, responde SOLO con el plan de edición en el formato JSON pedido.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const esquema = JSON.stringify(z.toJSONSchema(planSchema, { target: "draft-7" }));
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    esquema,
    "--system-prompt",
    SISTEMA,
    "--allowedTools",
    "Read",
    "--permission-mode",
    "dontAsk",
    ...(imagenes.length ? ["--add-dir", path.dirname(imagenes[0])] : []),
    ...(process.env.CLAUDE_MODELO ? ["--model", process.env.CLAUDE_MODELO] : []),
  ];

  // Sin ANTHROPIC_API_KEY en el entorno, para que Claude Code use la suscripción
  const entorno = { ...process.env };
  delete entorno.ANTHROPIC_API_KEY;

  const salida = await new Promise<string>((resolver, rechazar) => {
    const proceso = spawn("claude", args, { env: entorno, shell: process.platform === "win32" });
    let out = "";
    let err = "";
    proceso.stdout.on("data", (d) => (out += d));
    proceso.stderr.on("data", (d) => (err += d));
    proceso.on("error", rechazar);
    proceso.on("close", () => (out.trim() ? resolver(out) : rechazar(new Error(`Claude Code no respondió: ${err.slice(0, 300)}`))));
    proceso.stdin.end(prompt);
  });

  const resultado = JSON.parse(salida) as {
    is_error?: boolean;
    result?: string;
    structured_output?: unknown;
    api_error_status?: number;
  };
  if (resultado.is_error) {
    throw new Error(`Claude Code: ${resultado.result ?? "error"} (${resultado.api_error_status ?? "?"})`);
  }
  let plan = resultado.structured_output;
  if (!plan && resultado.result) {
    const texto = resultado.result.replace(/^```(?:json)?\s*|\s*```$/g, "");
    plan = JSON.parse(texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1));
  }
  const valido = planSchema.safeParse(plan);
  if (!valido.success) throw new Error(`Claude Code no devolvió un plan válido: ${valido.error.message.slice(0, 300)}`);
  return valido.data;
};

// Alternativa: la API de Anthropic (créditos de pago). Se activa con CLAUDE_MOTOR=api.
const planConApi = async (bloques: Bloque[]): Promise<Plan> => {
  const contenido: Anthropic.ContentBlockParam[] = bloques.map((b) =>
    "texto" in b
      ? { type: "text", text: b.texto }
      : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: enBase64(b.imagen) } },
  );
  const client = new Anthropic();
  const respuesta = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SISTEMA,
    output_config: { effort: "medium", format: zodOutputFormat(planSchema) },
    messages: [{ role: "user", content: contenido }],
  });

  if (respuesta.stop_reason === "refusal") {
    throw new Error("Claude no ha querido editar este vídeo. Prueba a explicarlo de otra forma.");
  }
  if (!respuesta.parsed_output) {
    throw new Error(`Claude no devolvió un plan válido (stop_reason=${respuesta.stop_reason})`);
  }
  return respuesta.parsed_output;
};
