import fs from "node:fs";
import path from "node:path";
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
} from "@remotion/install-whisper-cpp";
import type { Caption } from "@remotion/captions";

const VERSION = "1.7.6";
const MODELO = (process.env.WHISPER_MODELO ?? "small") as "small";
const CARPETA = path.resolve(".whisper");

let preparado: Promise<void> | null = null;

const preparar = () => {
  preparado ??= (async () => {
    await installWhisperCpp({ to: CARPETA, version: VERSION, printOutput: false });
    // En Windows el zip oficial trae los .exe en Release/, pero Remotion los
    // busca en build/bin/ (donde quedan al compilar en Linux/Mac).
    const release = path.join(CARPETA, "Release");
    const bin = path.join(CARPETA, "build", "bin");
    if (process.platform === "win32" && fs.existsSync(release) && !fs.existsSync(bin)) {
      fs.cpSync(release, bin, { recursive: true });
    }
    await downloadWhisperModel({ folder: CARPETA, model: MODELO, printOutput: false });
  })();
  return preparado;
};

export const transcribirWav = async (wav: string): Promise<Caption[]> => {
  await preparar();
  const json = await transcribe({
    inputPath: wav,
    whisperPath: CARPETA,
    whisperCppVersion: VERSION,
    model: MODELO,
    modelFolder: CARPETA,
    tokenLevelTimestamps: true,
    language: "auto",
    printOutput: false,
  });
  const resultado: Caption[] = [];
  for (const c of toCaptions({ whisperCppOutput: json }).captions) {
    // whisper marca silencios y ruidos como [MÚSICA], (risas)...
    if (c.text.trim() === "" || /^\s*[[(].*[\])]\s*$/.test(c.text)) continue;
    // Los signos sueltos (". , ?") se pegan a la palabra anterior para que no
    // aparezcan al principio de la siguiente línea de subtítulos.
    const anterior = resultado[resultado.length - 1];
    if (anterior && /^[.,;:!?…]+$/.test(c.text.trim())) {
      anterior.text += c.text.trim();
      anterior.endMs = Math.max(anterior.endMs, c.endMs);
      continue;
    }
    resultado.push({ ...c });
  }
  return resultado;
};

// Texto legible con tiempos, para que Claude sepa qué se dice y cuándo
export const transcripcionLegible = (captions: Caption[]) => {
  const lineas: string[] = [];
  let actual: Caption[] = [];
  const cerrar = () => {
    if (actual.length === 0) return;
    const desde = (actual[0].startMs / 1000).toFixed(1);
    const hasta = (actual[actual.length - 1].endMs / 1000).toFixed(1);
    lineas.push(`[${desde}s–${hasta}s] ${actual.map((c) => c.text).join("").trim()}`);
    actual = [];
  };
  for (const c of captions) {
    const anterior = actual[actual.length - 1];
    if (anterior && (c.startMs - anterior.endMs > 700 || c.endMs - actual[0].startMs > 6000)) {
      cerrar();
    }
    actual.push(c);
    if (/[.!?¿¡]$/.test(c.text.trim())) cerrar();
  }
  cerrar();
  return lineas.join("\n");
};
