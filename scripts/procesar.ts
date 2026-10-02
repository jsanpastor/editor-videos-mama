// Lo ejecuta GitHub Actions cuando mamá pulsa "Editar mi vídeo".
// El id del trabajo y su llave de un solo uso llegan en el aviso de Apps Script
// (repository_dispatch). Se leen del archivo del evento para que no salgan en los
// logs públicos. Para pruebas: variables TRABAJO_ID y LLAVE_TRABAJO.
// La dirección de Apps Script se toma de web/config.js (o de APPS_SCRIPT_URL).
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import type { Plan } from "../src/plan";
import { ejecutarPipeline, type Etapa } from "./pipeline";
import type { Opciones } from "./claude";

const evento = process.env.GITHUB_EVENT_PATH
  ? (JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) as {
      client_payload?: { id?: string; llave?: string };
    })
  : {};
const ID = evento.client_payload?.id ?? process.env.TRABAJO_ID;
const LLAVE = evento.client_payload?.llave ?? process.env.LLAVE_TRABAJO;
const URL_SCRIPT =
  process.env.APPS_SCRIPT_URL ??
  fs
    .readFileSync(path.resolve(import.meta.dirname, "..", "web", "config.js"), "utf8")
    .match(/APPS_SCRIPT_URL:\s*"([^"]+)"/)?.[1];
if (!ID || !LLAVE) throw new Error("Falta el id del trabajo o su llave");
if (!URL_SCRIPT?.startsWith("https://")) throw new Error("Falta la URL de Apps Script en web/config.js");

type Trabajo = {
  id: string;
  archivos: { id: string; nombre: string }[];
  voz?: { id: string; nombre: string } | null;
  instrucciones: string;
  opciones?: Opciones | null;
  version?: number;
};

const appsScript = async <T>(accion: string, datos: object): Promise<T> => {
  // Google a veces responde con una página de error suelta: se reintenta
  for (let intento = 1; ; intento++) {
    const r = await fetch(URL_SCRIPT, {
      method: "POST",
      body: JSON.stringify({ accion, id: ID, llave: LLAVE, ...datos }),
      redirect: "follow",
    });
    const texto = await r.text();
    if (!texto.trimStart().startsWith("{")) {
      if (intento >= 4) throw new Error(`Apps Script (${accion}) no responde bien (${r.status})`);
      await new Promise((res) => setTimeout(res, 2000 * intento));
      continue;
    }
    const json = JSON.parse(texto) as { ok: boolean; error?: string } & T;
    if (!json.ok) throw new Error(`Apps Script (${accion}): ${json.error}`);
    return json;
  }
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

// Enlace directo: cualquiera con el enlace puede ver/descargar el vídeo (sin
// iniciar sesión), para abrirlo en el móvil o mandarlo por WhatsApp.
const hacerPublicoConEnlace = async (fileId: string, token: string) => {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!r.ok) console.warn(`No se pudo crear el enlace público (${r.status})`);
  return r.ok;
};

// Comparte el vídeo con una persona: Google le manda un correo con el enlace
const compartirCon = async (fileId: string, token: string, correo: string, mensaje: string) => {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`);
  url.searchParams.set("sendNotificationEmail", "true");
  url.searchParams.set("emailMessage", mensaje);
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "user", emailAddress: correo }),
  });
  // Si el correo no tiene cuenta de Google, Drive puede rechazarlo: el enlace
  // público del vídeo sigue funcionando igualmente.
  if (!r.ok) console.warn(`No se pudo compartir con un destinatario (${r.status})`);
};

// Lo que verá mamá si algo falla: claro y sin tecnicismos
const mensajeAmable = (tecnico: string) => {
  if (/credit balance|billing|insufficient/i.test(tecnico))
    return "Se ha acabado el saldo de Claude (el editor). Avisa a tu hijo para que lo recargue y luego pulsa Reintentar.";
  if (/OAuth|401|authenticate|setup-token/i.test(tecnico))
    return "El editor ha perdido el permiso para usar Claude. Avisa a tu hijo para que renueve el token (claude setup-token) y luego pulsa Reintentar.";
  if (/usage limit|limit reached|límite/i.test(tecnico))
    return "Se ha llegado al límite de uso de Claude por ahora. Espera un rato (unas horas como mucho) y pulsa Reintentar.";
  if (/rate.?limit|overloaded|529|429/i.test(tecnico))
    return "El editor está muy ocupado ahora mismo. Espera unos minutos y pulsa Reintentar.";
  if (/descargar el vídeo de Drive \(404\)/.test(tecnico))
    return "No encuentro el vídeo original en Drive (¿se ha borrado?). Vuelve a subirlo.";
  if (/no parece un vídeo|Invalid data/i.test(tecnico))
    return "Uno de los archivos no parece un vídeo que se pueda abrir. Prueba con otro.";
  return `Algo ha fallado. Pulsa Reintentar y, si sigue sin ir, avisa a tu hijo. (Detalle: ${tecnico.slice(0, 200)})`;
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
    compartirCon?: string[];
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
  let voz: { ruta: string } | null = null;
  if (trabajo.voz) {
    voz = { ruta: path.join(carpeta, `voz${path.extname(trabajo.voz.nombre) || ".webm"}`) };
    await descargar(trabajo.voz.id, datos.token, voz.ruta);
  }

  const salida = path.join(carpeta, "resultado.mp4");
  const { plan, duracion } = await ejecutarPipeline({
    originales,
    voz,
    opciones: trabajo.opciones ?? null,
    instrucciones: trabajo.instrucciones,
    planAnterior: datos.planAnterior,
    salida,
    carpetaTrabajo: carpeta,
    avisar: (estado: Etapa, progreso?: number) => actualizar({ estado, progreso: progreso ?? null }),
  });

  await actualizar({ estado: "subiendo", progreso: null });
  // Por si el render ha tardado mucho y el permiso de Drive (1 h) ha caducado
  const { token } = await appsScript<{ token: string }>("servidor:trabajo", { id: ID });
  const fecha = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date())
    .replace(":", "h")
    .replace(/[,.]/g, "");
  const version = trabajo.version && trabajo.version > 1 ? ` (versión ${trabajo.version})` : "";
  const resultadoNombre = `Reel ${fecha}${version}.mp4`;
  const resultadoId = await subir(salida, resultadoNombre, datos.carpetaListos, token);
  const publico = await hacerPublicoConEnlace(resultadoId, token);
  for (const correo of datos.compartirCon ?? []) {
    await compartirCon(resultadoId, token, correo, `¡Nuevo vídeo listo! 🎬 ${plan.resumen}`.slice(0, 900));
  }

  await actualizar({
    estado: "listo",
    progreso: null,
    resultadoId,
    resultadoNombre,
    enlace: publico ? `https://drive.google.com/file/d/${resultadoId}/view?usp=sharing` : null,
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
  await actualizar({ estado: "error", error: mensajeAmable(mensaje) });
  process.exit(1);
}
