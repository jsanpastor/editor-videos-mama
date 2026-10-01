import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { Caption } from "@remotion/captions";
import { type Fuente, type Plan, type PropsEditor, sanearPlan } from "../src/plan";
import { audioParaWhisper, fotogramas, infoVideo, normalizar } from "./medios";
import { transcribirWav, transcripcionLegible } from "./transcribir";
import { pedirPlan, type VideoParaClaude } from "./claude";

export type Etapa = "preparando" | "escuchando" | "pensando" | "montando";

export type OpcionesPipeline = {
  originales: { ruta: string; nombre: string }[];
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
  const maxFotogramas = Math.max(3, Math.floor(20 / o.originales.length));
  for (const [i, original] of o.originales.entries()) {
    const normalizado = path.join(carpetaPublica, `${i}.mp4`);
    await normalizar(original.ruta, normalizado);
    const info = await infoVideo(normalizado);
    fuentes.push({ src: `fuentes/${i}.mp4`, duracion: info.duracion, ancho: info.ancho, alto: info.alto });
    const cuantos = Math.min(maxFotogramas, Math.max(3, Math.round(info.duracion / 5)));
    paraClaude.push({
      nombre: original.nombre,
      ...info,
      transcripcion: "",
      fotogramas: o.planFijo
        ? []
        : await fotogramas(normalizado, info.duracion, cuantos, o.carpetaTrabajo, `v${i}`),
    });
  }

  // 2. Transcribir lo que se dice (para subtítulos y para que Claude entienda el vídeo)
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
  }

  // 3. Claude decide la edición
  await avisar("pensando");
  const planCrudo =
    o.planFijo ??
    (await pedirPlan({
      videos: paraClaude,
      instrucciones: o.instrucciones,
      planAnterior: o.planAnterior,
    }));
  const plan = sanearPlan(planCrudo, fuentes);

  // 4. Remotion monta el vídeo
  await avisar("montando", 0);
  const props: PropsEditor = { plan, fuentes, subtitulos };
  const serveUrl = await bundle({ entryPoint: path.join(RAIZ, "src", "index.ts") });
  const composition = await selectComposition({ serveUrl, id: "EditorVideo", inputProps: props });
  let ultimo = 0;
  const render = () => renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    crf: 20,
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
    await render();
  } catch (e) {
    // A veces el primer render falla al cargar algo (fuentes, Chrome): un reintento lo arregla
    console.warn("Render fallido, reintentando:", (e as Error).message);
    ultimo = 0;
    await render();
  }

  return { plan, duracion: composition.durationInFrames / composition.fps };
};
