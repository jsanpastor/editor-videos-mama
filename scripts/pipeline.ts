import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { Caption } from "@remotion/captions";
import {
  aplicarQuitarSilencios,
  type Fuente,
  type Plan,
  type PropsEditor,
  sanearPlan,
  type VozEnOff,
} from "../src/plan";
import { audioParaWhisper, fotogramas, infoAudio, infoVideo, limpiarVoz, normalizar } from "./medios";
import { transcribirWav, transcripcionLegible } from "./transcribir";
import { pedirPlan, type VideoParaClaude } from "./claude";

export type Etapa = "preparando" | "escuchando" | "pensando" | "montando";

export type OpcionesPipeline = {
  originales: { ruta: string; nombre: string }[];
  voz?: { ruta: string } | null; // voz en off grabada por ella
  instrucciones: string;
  planAnterior?: Plan | null;
  planFijo?: Plan | null; // para pruebas: saltarse a Claude
  transcribir?: boolean;
  salida: string;
  carpetaTrabajo: string;
  avisar?: (etapa: Etapa, progreso?: number) => unknown;
};

const RAIZ = path.resolve(import.meta.dirname, "..");

export const ejecutarPipeline = async (o: OpcionesPipeline) => {
  const avisar = o.avisar ?? (() => {});
  fs.mkdirSync(o.carpetaTrabajo, { recursive: true });
  const carpetaPublica = path.join(RAIZ, "public", "fuentes");
  fs.rmSync(carpetaPublica, { recursive: true, force: true });
  fs.mkdirSync(carpetaPublica, { recursive: true });

  // 1. Normalizar vídeos y sacar información + fotogramas
  await avisar("preparando");
  const fuentes: Fuente[] = [];
  const paraClaude: VideoParaClaude[] = [];
  const maxFotogramas = Math.max(2, Math.floor(24 / o.originales.length));
  for (const [i, original] of o.originales.entries()) {
    const normalizado = path.join(carpetaPublica, `${i}.mp4`);
    await normalizar(original.ruta, normalizado);
    const info = await infoVideo(normalizado);
    fuentes.push({ src: `fuentes/${i}.mp4`, duracion: info.duracion, ancho: info.ancho, alto: info.alto });
    const cuantos = Math.min(maxFotogramas, Math.max(2, Math.round(info.duracion / 4)));
    paraClaude.push({
      nombre: original.nombre,
      ...info,
      transcripcion: "",
      fotogramas: o.planFijo
        ? []
        : await fotogramas(normalizado, info.duracion, cuantos, o.carpetaTrabajo, `v${i}`),
    });
  }

  let voz: VozEnOff | null = null;
  if (o.voz) {
    const limpia = path.join(carpetaPublica, "voz.wav");
    await limpiarVoz(o.voz.ruta, limpia);
    voz = { src: "fuentes/voz.wav", duracion: (await infoAudio(limpia)).duracion, subtitulos: [] };
  }

  // 2. Transcribir lo que se dice (para subtítulos, jump cuts y para que Claude entienda el vídeo)
  const subtitulos: Caption[][] = fuentes.map(() => []);
  if (o.transcribir !== false) {
    await avisar("escuchando");
    for (const [i, v] of paraClaude.entries()) {
      if (!v.tieneAudio) continue;
      const wav = path.join(o.carpetaTrabajo, `audio-${i}.wav`);
      await audioParaWhisper(path.join(carpetaPublica, `${i}.mp4`), wav);
      subtitulos[i] = await transcribirWav(wav);
      v.transcripcion = transcripcionLegible(subtitulos[i]);
    }
    if (voz) {
      const wav = path.join(o.carpetaTrabajo, "audio-voz.wav");
      await audioParaWhisper(path.join(carpetaPublica, "voz.wav"), wav);
      voz.subtitulos = await transcribirWav(wav);
    }
  }

  // 3. Claude decide la edición
  await avisar("pensando");
  const planClaude =
    o.planFijo ??
    (await pedirPlan({
      videos: paraClaude,
      voz: voz ? { duracion: voz.duracion, transcripcion: transcripcionLegible(voz.subtitulos) } : null,
      instrucciones: o.instrucciones,
      planAnterior: o.planAnterior,
    }));
  const plan = aplicarQuitarSilencios(sanearPlan(planClaude, fuentes), subtitulos);

  // 4. Remotion monta el vídeo
  await avisar("montando", 0);
  const props: PropsEditor = { plan, fuentes, subtitulos, voz };
  const serveUrl = await bundle({ entryPoint: path.join(RAIZ, "src", "index.ts") });
  const composition = await selectComposition({ serveUrl, id: "EditorVideo", inputProps: props });
  let ultimo = 0;
  const render = (concurrency: number | null) =>
    renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 20,
      concurrency,
      outputLocation: o.salida,
      inputProps: props,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct - ultimo >= 10) {
          ultimo = pct;
          void avisar("montando", pct);
        }
      },
    });
  try {
    await render(process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : null);
  } catch (e) {
    // Con varios hilos, a veces el extractor de fotogramas falla al leer el mismo
    // clip desde varios sitios a la vez ("No frame found"). Con uno solo es fiable.
    console.warn("Render fallido, reintentando con un solo hilo:", (e as Error).message.slice(0, 200));
    ultimo = 0;
    await render(1);
  }

  // Se devuelve el plan tal como lo hizo Claude (sin trocear por silencios) para
  // poder pedir cambios sobre él más adelante
  return { plan: sanearPlan(planClaude, fuentes), duracion: composition.durationInFrames / composition.fps };
};
