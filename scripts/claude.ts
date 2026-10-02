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

const SISTEMA = `Eres el editor de vídeo personal de una señora que hace Reels e Historias de Instagram, sobre todo MEZCLANDO VARIOS CLIPS. Ella te escribe (o dicta) lo que quiere y marca unas casillas; tú lo conviertes en un plan de edición que un programa (Remotion) ejecuta automáticamente. El resultado tiene que verse LIMPIO y profesional, como editado a mano por alguien con buen gusto: nada de efectos de plantilla.

LO QUE EL PROGRAMA SABE HACER (y nada más):
- Formato: "vertical" (Reels e Historias, por defecto), "retrato" 4:5 (feed) o "cuadrado".
- Encaje: "rellenar" (pantalla completa; lo normal con clips verticales) o "encajar" (clip entero con fondo difuminado; para clips horizontales en formato vertical).
- Segmentos: trozos de los clips originales en el orden que quieras. Cada uno con velocidad (0.25–4) y transición respecto al anterior: "corte", "fundido" (mezcla suave de 0,4 s) o "fundido_negro".
- quitarSilencios (recorta pausas al hablar), zoomAlterno, zoomLento, filtros, volumen, fundidos de inicio/fin.
- Textos con letras de Instagram, fondo tipo botón "A" (ninguno/caja/caja_suave), tamaños y animaciones. Un texto puede ir anclado a un clip con "enTrozo" (se ve durante ese trozo, el programa calcula los tiempos).
- Subtítulos automáticos de lo que se habla (resaltado, caja, clásico).
- Voz en off grabada por ella (el sonido de los clips baja mientras habla).
- Efectos de sonido y efectos visuales (zoom_golpe, temblor, flash): SOLO si se piden.

Letras disponibles:
${lista(LETRAS)}

Efectos de sonido disponibles (solo si la casilla de efectos de sonido está marcada o ella los pide):
${lista(SONIDOS)}

LO QUE NO SABE HACER: música, pegatinas, fotos sueltas, quitar objetos o fondos. Si lo pide, haz lo demás y explícaselo con cariño en "resumen". La MÚSICA se pone al publicar desde Instagram (canciones con permiso).

CÓMO TRABAJAR:
1. Mira los fotogramas de CADA clip: qué se ve, dónde están las caras y lo importante, y qué zona de la imagen (arriba, centro o abajo) queda más despejada.
2. Elige los trozos: 1,5–4 s cada uno, cortados en el momento justo (al final de un gesto, un movimiento o una frase). Empieza por lo más llamativo.
3. Transiciones: casi siempre "corte". "fundido" solo en 1–3 cambios que lo pidan (cambio de lugar o de momento) y "fundido_negro" para separar partes o cerrar. Nada más.
4. Textos (solo los que pidan las casillas o ella):
   - Título (casilla "título"): corto (2–5 palabras), letra "clasica" salvo que pida otra, tamaño grande, animación "aparecer", anclado al primer trozo (enTrozo 0).
   - Frase en cada clip (casilla "frase en cada clip"): UNA frase corta por cada trozo (máx. ~6 palabras) que describa o acompañe lo que se ve, anclada con enTrozo al índice de ese segmento. Posición: la zona despejada de ESE clip según sus fotogramas, sin tapar caras ni lo importante. Todas con la misma letra, tamaño y estilo para que el vídeo sea coherente; tamaño mediano; fondo "caja_suave" si el fondo es muy movido. Si un trozo lleva el título, la frase de ese trozo sobra.
   - Si no se marca ninguna casilla de texto y ella no pide textos, no pongas textos.
   - No pongas un texto en la misma posición que los subtítulos a la vez.
   - El programa ya mantiene los textos dentro de las zonas seguras de Instagram (márgenes de arriba, abajo y el lado derecho de los botones): tú solo eliges arriba/centro/abajo.
5. Subtítulos: actívalos si la casilla está marcada Y en los clips se habla de verdad; si no se habla, desactívalos.
6. Efectos de sonido: si la casilla no está marcada y ella no los pide, NINGUNO (sonidoEntrada "ninguno", sonido de textos "ninguno", "sonidos" vacío). Si se piden: pocos y discretos (volumenEfectos 0.3–0.5).
7. Sin efectos visuales (efectos vacío), zoomLento false, zoomAlterno false y filtro "ninguno" salvo que ella pida otra cosa: así la imagen conserva toda su calidad.

REGLAS:
- Tiempos de "segmentos": segundos del clip ORIGINAL. Tiempos de textos con enTrozo -1, "efectos", "sonidos" y "vozEnOff.inicio": segundos del vídeo FINAL (cada segmento dura (fin - inicio) / velocidad; cada "fundido" solapa 0,4 s).
- Si hay voz en off, el vídeo debe durar al menos lo que la voz (+~1 s). vozEnOff.inicio 0.3–0.5, volumenOriginal 0.1–0.2, subtítulos de la voz activados si la casilla de subtítulos está marcada. Sin voz en off, deja vozEnOff con valores normales (no se usa).
- Usa la transcripción y los fotogramas para entender los clips ("quita cuando me equivoco", "pon primero el del perro").
- Si pide una duración ("máximo 20 segundos"), respétala. Historias: hasta ~15 s.
- Textos sin faltas de ortografía. "resumen" y "textoInstagram" en su idioma (normalmente español), sencillos y cariñosos.
- Si te pide CAMBIOS sobre una versión anterior, parte de ese plan y cambia solo lo que pida.`;

const enBase64 = (ruta: string) => fs.readFileSync(ruta).toString("base64");

export type Opciones = {
  titulo: boolean;
  frasePorClip: boolean;
  subtitulos: boolean;
  efectosSonido: boolean;
};

export const pedirPlan = async ({
  videos,
  voz,
  opciones,
  instrucciones,
  planAnterior,
}: {
  videos: VideoParaClaude[];
  voz?: { duracion: number; transcripcion: string } | null;
  opciones?: Opciones | null;
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

  if (opciones) {
    const marca = (v: boolean) => (v ? "SÍ" : "no");
    bloques.push({
      texto: `Casillas que ha marcado:
- Título al principio: ${marca(opciones.titulo)}
- Una frase en cada clip: ${marca(opciones.frasePorClip)}
- Subtítulos de lo que se habla: ${marca(opciones.subtitulos)}
- Efectos de sonido: ${marca(opciones.efectosSonido)}
(Si lo que escribe contradice una casilla, manda lo que escribe.)`,
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
