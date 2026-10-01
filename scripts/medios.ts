import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const run = promisify(execFile);

export type InfoVideo = {
  duracion: number;
  ancho: number;
  alto: number;
  tieneAudio: boolean;
};

const ffmpeg = (args: string[]) =>
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: 1024 * 1024 * 64,
  });

export const infoVideo = async (archivo: string): Promise<InfoVideo> => {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height",
    "-of",
    "json",
    archivo,
  ]);
  const datos = JSON.parse(stdout) as {
    format: { duration: string };
    streams: { codec_type: string; width?: number; height?: number }[];
  };
  const video = datos.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new Error("El archivo no parece un vídeo");
  return {
    duracion: Number(datos.format.duration),
    ancho: video.width,
    alto: video.height,
    tieneAudio: datos.streams.some((s) => s.codec_type === "audio"),
  };
};

// Los vídeos del móvil vienen en formatos muy distintos (HEVC, .mov, 60fps,
// fotogramas variables, rotación en metadatos...). Los pasamos todos a un MP4
// H.264 a 30fps, ya girados, para que Remotion los lea sin sorpresas.
export const normalizar = async (entrada: string, salida: string) => {
  await ffmpeg([
    "-i",
    entrada,
    "-vf",
    "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    salida,
  ]);
};

export const fotogramas = async (
  archivo: string,
  duracion: number,
  cuantos: number,
  carpeta: string,
  prefijo: string,
) => {
  fs.mkdirSync(carpeta, { recursive: true });
  const resultado: { segundo: number; ruta: string }[] = [];
  for (let i = 0; i < cuantos; i++) {
    const segundo = Math.min(duracion - 0.1, ((i + 0.5) * duracion) / cuantos);
    const ruta = path.join(carpeta, `${prefijo}-${i}.jpg`);
    await ffmpeg([
      "-ss",
      segundo.toFixed(2),
      "-i",
      archivo,
      "-frames:v",
      "1",
      "-vf",
      "scale=512:512:force_original_aspect_ratio=decrease",
      "-q:v",
      "5",
      ruta,
    ]);
    if (fs.existsSync(ruta)) resultado.push({ segundo, ruta });
  }
  return resultado;
};

// whisper.cpp necesita WAV mono a 16 kHz
export const audioParaWhisper = async (archivo: string, salida: string) => {
  await ffmpeg(["-i", archivo, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", salida]);
};
