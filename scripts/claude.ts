import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { planSchema, type Plan } from "../src/plan";

export type VideoParaClaude = {
  nombre: string;
  duracion: number;
  ancho: number;
  alto: number;
  tieneAudio: boolean;
  transcripcion: string;
  fotogramas: { segundo: number; ruta: string }[];
};

const SISTEMA = `Eres el editor de vídeo personal de una señora que publica vídeos en Instagram. Ella no sabe de edición: te escribe (o dicta) lo que quiere con sus palabras y tú lo conviertes en un plan de edición que un programa (Remotion) ejecuta automáticamente.

Lo que el programa SABE hacer (y nada más):
- Elegir formato: "vertical" (Reels e Historias, el recomendado por defecto), "retrato" 4:5 (publicación del feed) o "cuadrado".
- Encaje: "rellenar" (ocupa toda la pantalla, recorta bordes) o "encajar" (se ve el vídeo entero con fondo difuminado; úsalo si el vídeo es horizontal y el formato vertical, salvo que pida lo contrario).
- Cortar: quedarse con trozos de los vídeos originales (segmentos), en el orden que quieras. Sirve para quitar el principio, el final, partes del medio, o unir varios vídeos.
- Cambiar velocidad de cada trozo (cámara lenta / acelerado).
- Filtros de color: ninguno, blanco_negro, calido, frio, vintage, vivo, suave.
- Zoom lento, fundido de entrada y de salida, volumen del sonido original (0 = silenciar).
- Textos animados sobre el vídeo (títulos, frases, etiquetas) en arriba/centro/abajo, con 4 estilos.
- Subtítulos automáticos de lo que se dice en el vídeo (palabra a palabra, resaltando la que suena).

Lo que NO sabe hacer: añadir música, voces, pegatinas, fotos, transiciones entre trozos distintas al corte, quitar objetos o fondos. Si te lo pide, haz todo lo demás y en "resumen" explícale con cariño que eso no se puede, y si es música sugiérele que la añada desde la propia app de Instagram al publicar (allí tiene canciones con permiso).

Reglas:
- Los tiempos de "segmentos" están en segundos del vídeo ORIGINAL. Los de "textos" están en segundos del vídeo FINAL ya montado (después de cortes y cambios de velocidad): calcúlalos con cuidado.
- Usa la transcripción y los fotogramas para entender el vídeo: p. ej. "quita cuando me equivoco" o "empieza cuando saludo".
- Si no pide cortar, conserva el vídeo entero. Si no especifica algo, elige lo que mejor quede en Instagram sin pasarte: es mejor un resultado limpio que recargado.
- Si el vídeo tiene voz y no dice nada de subtítulos, actívalos (en Instagram mucha gente ve sin sonido). Si no hay voz, desactívalos.
- Textos cortos, legibles y sin faltas de ortografía. No tapes los subtítulos con textos en la misma posición al mismo tiempo.
- Reels: entre 5 y 90 segundos es lo ideal.
- Escribe "resumen" y "textoInstagram" en el idioma en que ella te escribe (normalmente español), con frases sencillas.`;

const enBase64 = (ruta: string) => fs.readFileSync(ruta).toString("base64");

export const pedirPlan = async ({
  videos,
  instrucciones,
  planAnterior,
}: {
  videos: VideoParaClaude[];
  instrucciones: string;
  planAnterior?: Plan | null;
}): Promise<Plan> => {
  const contenido: Anthropic.ContentBlockParam[] = [];

  videos.forEach((v, i) => {
    const orientacion =
      v.ancho > v.alto ? "horizontal" : v.ancho < v.alto ? "vertical" : "cuadrado";
    contenido.push({
      type: "text",
      text: `VÍDEO ${i} ("${v.nombre}"): dura ${v.duracion.toFixed(1)} s, ${v.ancho}x${v.alto} (${orientacion}), ${
        v.tieneAudio ? "con sonido" : "sin sonido"
      }.\nTranscripción:\n${v.transcripcion || "(no se entiende ninguna voz)"}\nFotogramas:`,
    });
    for (const f of v.fotogramas) {
      contenido.push({ type: "text", text: `Vídeo ${i}, segundo ${f.segundo.toFixed(1)}:` });
      contenido.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: enBase64(f.ruta) },
      });
    }
  });

  if (planAnterior) {
    contenido.push({
      type: "text",
      text: `Ya le hiciste una versión anterior con este plan:\n${JSON.stringify(planAnterior)}\n\nAhora te pide CAMBIOS sobre esa versión. Mantén todo lo demás igual salvo lo que pida.`,
    });
  }

  contenido.push({
    type: "text",
    text: `Lo que ella quiere:\n"""\n${instrucciones.trim() || "Déjalo bonito para Instagram."}\n"""`,
  });

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
