// Prueba en el ordenador sin Drive ni GitHub:
//   npm run local -- video.mp4 [otro.mp4] -i "pon subtítulos y un título"
//   npm run local -- video.mp4 --plan plan.json --sin-transcribir   (sin gastar Claude)
//   npm run local -- a.mp4 b.mp4 --voz voz.m4a -i "..."              (con voz en off)
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Plan } from "../src/plan";
import { ejecutarPipeline } from "./pipeline";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    instrucciones: { type: "string", short: "i", default: "" },
    plan: { type: "string" },
    voz: { type: "string" },
    "sin-transcribir": { type: "boolean", default: false },
    salida: { type: "string", default: "out/resultado.mp4" },
  },
});

if (positionals.length === 0) {
  console.error('Uso: npm run local -- video.mp4 [otro.mp4] -i "instrucciones"');
  process.exit(1);
}

const salida = path.resolve(values.salida!);
fs.mkdirSync(path.dirname(salida), { recursive: true });

const { plan, duracion } = await ejecutarPipeline({
  originales: positionals.map((p) => ({ ruta: path.resolve(p), nombre: path.basename(p) })),
  voz: values.voz ? { ruta: path.resolve(values.voz) } : null,
  instrucciones: values.instrucciones!,
  planFijo: values.plan ? (JSON.parse(fs.readFileSync(values.plan, "utf8")) as Plan) : null,
  transcribir: !values["sin-transcribir"],
  salida,
  carpetaTrabajo: path.resolve("trabajo/local"),
  avisar: (etapa, progreso) => console.log(`→ ${etapa}${progreso !== undefined ? ` ${progreso}%` : ""}`),
});

console.log(JSON.stringify(plan, null, 2));
console.log(`\n✅ Listo: ${salida} (${duracion.toFixed(1)} s)`);
