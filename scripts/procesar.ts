// Lo ejecuta GitHub Actions cuando mamá pulsa "Editar mi vídeo".
// Variables de entorno: TRABAJO_ID, APPS_SCRIPT_URL, SECRETO_SERVIDOR, ANTHROPIC_API_KEY
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import type { Plan } from "../src/plan";
import { ejecutarPipeline, type Etapa } from "./pipeline";

const requerida = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Falta la variable de entorno ${k}`);
  return v;
};

const ID = requerida("TRABAJO_ID");
const URL_SCRIPT = requerida("APPS_SCRIPT_URL");
const SECRETO = requerida("SECRETO_SERVIDOR");

type Trabajo = {
  id: string;
  archivos: { id: string; nombre: string }[];
  instrucciones: string;
};

const appsScript = async <T>(accion: string, datos: object): Promise<T> => {
  const r = await fetch(URL_SCRIPT, {
    method: "POST",
    body: JSON.stringify({ accion, secreto: SECRETO, ...datos }),
    redirect: "follow",
  });
  const json = (await r.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) throw new Error(`Apps Script (${accion}): ${json.error}`);
  return json;
};

const actualizar = (campos: Record<string, unknown>) =>
  appsScript("servidor:actualizar", { id: ID, campos }).catch((e) =>
    console.warn("No se pudo avisar del progreso:", (e as Error).message),
  );

const descargar = async (fileId: string, token: string, destino: string) => {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok || !r.body) throw new Error(`No se pudo descargar el vídeo de Drive (${r.status})`);
  await streamPipeline(Readable.fromWeb(r.body as never), fs.createWriteStream(destino));
};

const subir = async (archivo: string, nombre: string, carpeta: string, token: string) => {
  const contenido = fs.readFileSync(archivo);
  const inicio = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(contenido.length),
      },
      body: JSON.stringify({ name: nombre, parents: [carpeta], mimeType: "video/mp4" }),
    },
  );
  const sesion = inicio.headers.get("location");
  if (!inicio.ok || !sesion) throw new Error(`Drive no acepta la subida (${inicio.status})`);
  const r = await fetch(sesion, { method: "PUT", body: contenido });
  if (!r.ok) throw new Error(`Falló la subida a Drive (${r.status})`);
  return ((await r.json()) as { id: string }).id;
};

const ejecucion = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;

try {
  const datos = await appsScript<{
    trabajo: Trabajo;
    planAnterior: Plan | null;
    token: string;
    carpetaListos: string;
  }>("servidor:trabajo", { id: ID });
  const { trabajo } = datos;

  await actualizar({ estado: "preparando", progreso: null, error: null, ejecucion });
  const carpeta = path.resolve("trabajo", ID);
  fs.mkdirSync(carpeta, { recursive: true });
  const originales = [];
  for (const [i, a] of trabajo.archivos.entries()) {
    const ruta = path.join(carpeta, `original-${i}${path.extname(a.nombre) || ".mp4"}`);
    await descargar(a.id, datos.token, ruta);
    originales.push({ ruta, nombre: a.nombre });
  }

  const salida = path.join(carpeta, "resultado.mp4");
  const { plan, duracion } = await ejecutarPipeline({
    originales,
    instrucciones: trabajo.instrucciones,
    planAnterior: datos.planAnterior,
    salida,
    carpetaTrabajo: carpeta,
    avisar: (estado: Etapa, progreso?: number) => actualizar({ estado, progreso: progreso ?? null }),
  });

  await actualizar({ estado: "subiendo", progreso: null });
  // Por si el render ha tardado mucho y el permiso de Drive (1 h) ha caducado
  const { token } = await appsScript<{ token: string }>("servidor:trabajo", { id: ID });
  const base = path.parse(trabajo.archivos[0].nombre).name.slice(0, 50);
  const fecha = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "h");
  const resultadoId = await subir(salida, `${base} (editado ${fecha}).mp4`, datos.carpetaListos, token);

  await actualizar({
    estado: "listo",
    progreso: null,
    resultadoId,
    duracion,
    plan,
    resumen: plan.resumen,
    textoInstagram: plan.textoInstagram,
  });
  console.log(`Trabajo ${ID} terminado (${duracion.toFixed(1)} s)`);
} catch (e) {
  const mensaje = (e as Error).message ?? String(e);
  // En el log público solo va el mensaje técnico, nunca el contenido del vídeo
  console.error(`Error en el trabajo ${ID}:`, mensaje);
  await actualizar({ estado: "error", error: mensaje.slice(0, 400) });
  process.exit(1);
}
