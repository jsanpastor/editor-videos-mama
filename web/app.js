"use strict";

const URL_API = window.CONFIG && window.CONFIG.APPS_SCRIPT_URL;
const MODO_DEMO = URL_API === "DEMO" || new URLSearchParams(location.search).has("demo");

const ESTADOS = {
  en_cola: { icono: "⏳", texto: "En la cola, empieza enseguida" },
  preparando: { icono: "📦", texto: "Preparando el vídeo" },
  escuchando: { icono: "👂", texto: "Escuchando lo que se dice" },
  pensando: { icono: "🤔", texto: "Pensando cómo editarlo" },
  montando: { icono: "🎬", texto: "Montando el vídeo" },
  subiendo: { icono: "📤", texto: "Ya casi está" },
  listo: { icono: "🎉", texto: "¡Listo!" },
  error: { icono: "😕", texto: "Algo ha fallado" },
};
const EN_MARCHA = ["en_cola", "preparando", "escuchando", "pensando", "montando", "subiendo"];

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Clave (llega en el enlace: ...#clave=XXXX y se recuerda en este dispositivo)
// ---------------------------------------------------------------------------
const almacen = {
  leer(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  guardar(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* sin almacenamiento: habrá que usar el enlace cada vez */
    }
  },
  borrar(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* nada */
    }
  },
};

let clave = null;
const deEnlace = new URLSearchParams(location.hash.slice(1)).get("clave");
if (deEnlace) {
  clave = deEnlace;
  almacen.guardar("clave", deEnlace);
  history.replaceState(null, "", location.pathname + location.search);
} else {
  clave = almacen.leer("clave");
}

// ---------------------------------------------------------------------------
// API (Apps Script)
// ---------------------------------------------------------------------------
async function api(accion, datos = {}) {
  if (MODO_DEMO) return demo(accion, datos);
  // Todas las peticiones se pueden repetir sin duplicar nada: "editar" lleva un
  // identificador único y el servidor reconoce la repetición; "reintentar" no
  // relanza un vídeo que ya está en cola.
  const sePuedeRepetir = true;
  if (accion === "editar" && !datos.idCliente) datos = { ...datos, idCliente: idUnico() };
  for (let intento = 1; ; intento++) {
    const ultimo = intento >= 3;
    let r;
    try {
      r = await fetch(URL_API, {
        method: "POST",
        body: JSON.stringify({ accion, clave, ...datos }),
      });
    } catch {
      if (ultimo || !sePuedeRepetir) throw new Error("No hay conexión a internet. Inténtalo otra vez en un momento.");
      await esperar(1500 * intento);
      continue;
    }
    let json;
    try {
      json = await r.json();
    } catch {
      // Google a veces devuelve una página de error en vez de la respuesta
      if (ultimo || !sePuedeRepetir) throw new Error("Google no responde ahora mismo. Inténtalo otra vez en un minuto.");
      await esperar(1500 * intento);
      continue;
    }
    if (json.reintentar && !ultimo) {
      await esperar(1500 * intento);
      continue;
    }
    if (!json.ok) throw new Error(json.reintentar ? "Google no responde ahora mismo. Inténtalo otra vez en un minuto." : json.error || "Error desconocido");
    return json;
  }
}

const idUnico = () =>
  window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let tokenCache = null;
async function tokenDrive() {
  if (tokenCache && Date.now() - tokenCache.hora < 40 * 60 * 1000) return tokenCache;
  const r = await api("token");
  tokenCache = { token: r.token, carpeta: r.carpetaOriginales, hora: Date.now() };
  return tokenCache;
}

// Subida "reanudable" a Drive, por trozos, para que aguante vídeos grandes y
// conexiones del móvil que se cortan.
async function subirADrive(archivo, alProgresar) {
  if (MODO_DEMO) return demoSubida(archivo, alProgresar);
  const { token, carpeta } = await tokenDrive();
  const inicio = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": archivo.type || "video/mp4",
        "X-Upload-Content-Length": String(archivo.size),
      },
      body: JSON.stringify({ name: archivo.name, parents: [carpeta] }),
    },
  );
  const sesion = inicio.headers.get("Location");
  if (!inicio.ok || !sesion) throw new Error("Google Drive no deja subir el vídeo ahora mismo.");

  const TROZO = 8 * 1024 * 1024; // múltiplo de 256 KB, como pide Google
  let desde = 0;
  let fallos = 0;
  while (true) {
    const hasta = Math.min(desde + TROZO, archivo.size);
    let r;
    try {
      r = await enviarTrozo(sesion, archivo.slice(desde, hasta), desde, hasta, archivo.size, (n) =>
        alProgresar((desde + n) / archivo.size),
      );
    } catch (e) {
      if (++fallos > 6) throw new Error("Se ha cortado la conexión al subir el vídeo.");
      await esperar(2000 * fallos);
      desde = await consultarSubida(sesion, archivo.size);
      continue;
    }
    if (r.status === 200 || r.status === 201) {
      if (r.override !== "308") return JSON.parse(r.cuerpo).id;
    } else if (r.status !== 308) {
      if (++fallos > 6) throw new Error(`Google Drive ha dado un error (${r.status}).`);
      await esperar(2000 * fallos);
      desde = await consultarSubida(sesion, archivo.size);
      continue;
    }
    desde = r.rango !== null ? r.rango : hasta;
    fallos = 0;
  }
}

function enviarTrozo(sesion, trozo, desde, hasta, total, alProgresar) {
  return new Promise((resolver, rechazar) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sesion);
    xhr.setRequestHeader("Content-Range", `bytes ${desde}-${hasta - 1}/${total}`);
    xhr.setRequestHeader("X-GUploader-No-308", "yes");
    xhr.upload.onprogress = (e) => alProgresar(e.loaded);
    xhr.onload = () =>
      resolver({
        status: xhr.status,
        override: xhr.getResponseHeader("X-HTTP-Status-Code-Override"),
        rango: rangoRecibido(xhr.getResponseHeader("Range")),
        cuerpo: xhr.responseText,
      });
    xhr.onerror = () => rechazar(new Error("red"));
    xhr.send(trozo);
  });
}

async function consultarSubida(sesion, total) {
  const r = await new Promise((resolver) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sesion);
    xhr.setRequestHeader("Content-Range", `bytes */${total}`);
    xhr.setRequestHeader("X-GUploader-No-308", "yes");
    xhr.onload = () => resolver(rangoRecibido(xhr.getResponseHeader("Range")));
    xhr.onerror = () => resolver(null);
    xhr.send();
  });
  return r || 0;
}

const rangoRecibido = (cabecera) => {
  const m = cabecera && cabecera.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : null;
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function descargarDeDrive(id) {
  if (MODO_DEMO) return demoDescarga();
  const { token } = await tokenDrive();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("No se ha podido traer el vídeo de Drive.");
  return r.blob();
}

// ---------------------------------------------------------------------------
// Pantalla "nuevo vídeo"
// ---------------------------------------------------------------------------
let elegidos = [];

function pintarElegidos() {
  const lista = $("lista-elegidos");
  lista.replaceChildren();
  elegidos.forEach((archivo, i) => {
    const li = document.createElement("li");
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = URL.createObjectURL(archivo) + "#t=0.5";
    const nombre = document.createElement("span");
    nombre.className = "nombre";
    nombre.textContent = archivo.name;
    const quitar = document.createElement("button");
    quitar.className = "quitar";
    quitar.type = "button";
    quitar.setAttribute("aria-label", `Quitar ${archivo.name}`);
    quitar.textContent = "✕";
    quitar.onclick = () => {
      elegidos.splice(i, 1);
      pintarElegidos();
    };
    li.append(video, nombre, quitar);
    lista.append(li);
  });
  $("boton-editar").disabled = elegidos.length === 0;
}

$("campo-videos").addEventListener("change", (e) => {
  elegidos = elegidos.concat(Array.from(e.target.files)).slice(0, 6);
  e.target.value = "";
  pintarElegidos();
});

function anadirTexto(texto) {
  const campo = $("campo-instrucciones");
  const actual = campo.value.trim();
  campo.value = actual ? `${actual.replace(/[.,]$/, "")}. ${texto}` : texto;
}

// Dictado por voz (Chrome y Safari)
const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Reconocimiento) {
  const boton = $("boton-dictar");
  boton.hidden = false;
  let rec = null;
  boton.onclick = () => {
    if (rec) {
      rec.stop();
      return;
    }
    rec = new Reconocimiento();
    rec.lang = "es-ES";
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) anadirTexto(e.results[i][0].transcript.trim());
      }
    };
    rec.onend = () => {
      rec = null;
      boton.textContent = "🎤 Dictar";
    };
    rec.start();
    boton.textContent = "⏹️ Parar de dictar";
  };
}

// ---------------------------------------------------------------------------
// Voz en off: grabarla aquí mismo con el micrófono o elegir un audio
// ---------------------------------------------------------------------------
let vozArchivo = null;
let grabadora = null;

function mostrarVoz() {
  $("voz-vacia").hidden = !!vozArchivo || !!grabadora;
  $("voz-grabando").hidden = !grabadora;
  $("voz-lista").hidden = !vozArchivo;
  if (vozArchivo) $("voz-audio").src = URL.createObjectURL(vozArchivo);
}

function tipoGrabacion() {
  // Safari (iPhone) graba en mp4/aac; Chrome y Android en webm/opus
  for (const tipo of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(tipo)) return tipo;
  }
  return "";
}

if (!window.MediaRecorder || !navigator.mediaDevices) $("boton-grabar").hidden = true;

$("boton-grabar").addEventListener("click", async () => {
  $("error-voz").hidden = true;
  let flujo;
  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    $("error-voz").textContent =
      "No puedo usar el micrófono. Cuando el móvil pregunte, pulsa «Permitir» para que la página pueda grabar tu voz.";
    $("error-voz").hidden = false;
    return;
  }
  const tipo = tipoGrabacion();
  const trozos = [];
  const rec = new MediaRecorder(flujo, tipo ? { mimeType: tipo } : undefined);
  const inicio = Date.now();
  const reloj = setInterval(() => {
    const seg = Math.floor((Date.now() - inicio) / 1000);
    $("voz-tiempo").textContent = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
    if (seg >= 180 && rec.state === "recording") rec.stop(); // 3 minutos como máximo
  }, 250);
  rec.ondataavailable = (e) => e.data.size && trozos.push(e.data);
  rec.onstop = () => {
    clearInterval(reloj);
    flujo.getTracks().forEach((p) => p.stop());
    const mime = rec.mimeType || tipo || "audio/webm";
    const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
    vozArchivo = new File(trozos, `voz-en-off.${ext}`, { type: mime.split(";")[0] });
    grabadora = null;
    mostrarVoz();
  };
  grabadora = rec;
  $("voz-tiempo").textContent = "0:00";
  rec.start(1000);
  mostrarVoz();
});

$("boton-parar").addEventListener("click", () => {
  if (grabadora && grabadora.state === "recording") grabadora.stop();
});

$("campo-voz").addEventListener("change", (e) => {
  if (e.target.files[0]) vozArchivo = e.target.files[0];
  e.target.value = "";
  mostrarVoz();
});

$("boton-borrar-voz").addEventListener("click", () => {
  vozArchivo = null;
  mostrarVoz();
});

$("boton-editar").addEventListener("click", async () => {
  const boton = $("boton-editar");
  const error = $("error-nuevo");
  error.hidden = true;
  boton.disabled = true;
  $("subida").hidden = false;
  try {
    const archivos = [];
    const total = elegidos.reduce((a, f) => a + f.size, 0);
    let hecho = 0;
    for (const [i, archivo] of elegidos.entries()) {
      $("subida-texto").textContent =
        elegidos.length > 1 ? `Subiendo vídeo ${i + 1} de ${elegidos.length}…` : "Subiendo vídeo…";
      const id = await subirADrive(archivo, (p) => {
        const pct = Math.round(((hecho + p * archivo.size) / total) * 100);
        $("subida-barra").style.width = `${pct}%`;
        $("subida-texto").textContent = $("subida-texto").textContent.replace(/ \d+%$/, "") + ` ${pct}%`;
      });
      hecho += archivo.size;
      archivos.push({ id, nombre: archivo.name });
    }
    let voz = null;
    if (vozArchivo) {
      $("subida-texto").textContent = "Subiendo tu voz…";
      voz = { id: await subirADrive(vozArchivo, () => {}), nombre: vozArchivo.name };
    }
    $("subida-texto").textContent = "Enviando las instrucciones…";
    const opciones = {
      titulo: $("op-titulo").checked,
      frasePorClip: $("op-frases").checked,
      subtitulos: $("op-subtitulos").checked,
      efectosSonido: $("op-sonidos").checked,
    };
    await api("editar", { archivos, voz, opciones, instrucciones: $("campo-instrucciones").value });
    elegidos = [];
    vozArchivo = null;
    mostrarVoz();
    pintarElegidos();
    $("campo-instrucciones").value = "";
    await cargarTrabajos();
    $("titulo-lista").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    boton.disabled = elegidos.length === 0;
  } finally {
    $("subida").hidden = true;
    $("subida-barra").style.width = "0";
  }
});

// ---------------------------------------------------------------------------
// Lista de vídeos
// ---------------------------------------------------------------------------
let trabajos = [];
let carpeta = null; // dónde se guardan los vídeos terminados
const videosCargados = new Map(); // id resultado -> blob URL
let temporizador = null;

async function cargarTrabajos() {
  try {
    const r = await api("trabajos");
    trabajos = r.trabajos;
    carpeta = r.carpeta || null;
    pintarTrabajos();
  } catch (e) {
    if (/clave/i.test(e.message)) return salir(e.message);
  }
  clearTimeout(temporizador);
  const hayEnMarcha = trabajos.some((t) => EN_MARCHA.includes(t.estado));
  temporizador = setTimeout(cargarTrabajos, hayEnMarcha ? 8000 : 60000);
}

const formatoHora = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

function pintarTrabajos() {
  const lista = $("lista-trabajos");
  if (trabajos.length === 0) {
    lista.innerHTML = '<p class="vacio">Aquí aparecerán tus vídeos editados.</p>';
    return;
  }
  // Conservar las tarjetas que ya existen para no cortar un vídeo que se está viendo
  const existentes = new Map(Array.from(lista.querySelectorAll(".trabajo")).map((n) => [n.dataset.id, n]));
  const nuevas = trabajos.map((t) => {
    const firma = `${t.estado}|${t.progreso}|${t.error}|${t.resultadoId}|${t.enlace}`;
    const previa = existentes.get(t.id);
    if (previa && previa.dataset.firma === firma) return previa;
    const nodo = crearTarjeta(t);
    nodo.dataset.firma = firma;
    return nodo;
  });
  lista.replaceChildren(...nuevas);
}

function boton(texto, clase, accion) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `boton ${clase}`;
  b.textContent = texto;
  b.onclick = accion;
  return b;
}

function crearTarjeta(t) {
  const nodo = $("plantilla-trabajo").content.firstElementChild.cloneNode(true);
  nodo.dataset.id = t.id;
  const estado = ESTADOS[t.estado] || ESTADOS.en_cola;
  nodo.querySelector(".estado-icono").textContent = estado.icono;
  nodo.querySelector(".estado-texto").textContent =
    t.estado === "montando" && t.progreso != null ? `${estado.texto} · ${t.progreso}%` : estado.texto;
  const nombres = t.archivos.map((a) => a.nombre).join(", ");
  nodo.querySelector(".trabajo-meta").textContent = `${formatoHora.format(new Date(t.creado))} · ${nombres}`;
  if (t.version > 1) {
    const v = document.createElement("span");
    v.className = "version";
    v.textContent = `Versión ${t.version}`;
    nodo.querySelector(".estado-texto").append(v);
  }
  nodo.querySelector(".instrucciones").textContent = t.instrucciones
    ? `${t.version > 1 ? "Cambios pedidos: " : ""}«${t.instrucciones}»`
    : "";
  nodo.querySelector(".lleva-voz").hidden = !t.voz;

  if (EN_MARCHA.includes(t.estado)) {
    const barra = nodo.querySelector(".barra");
    barra.hidden = false;
    if (t.estado === "montando" && t.progreso != null) {
      barra.firstElementChild.style.width = `${t.progreso}%`;
    } else {
      barra.classList.add("indeterminada");
    }
  }

  const acciones = nodo.querySelector(".acciones");
  const resumen = nodo.querySelector(".resumen");

  if (t.estado === "listo") {
    if (t.resumen) {
      resumen.hidden = false;
      resumen.textContent = t.resumen;
    }
    if (t.textoInstagram) {
      const caja = nodo.querySelector(".texto-instagram");
      caja.hidden = false;
      caja.querySelector(".texto").textContent = t.textoInstagram;
    }
    const hueco = nodo.querySelector(".video-hueco");
    const ver = boton("▶️ Ver vídeo", "boton-secundario", async () => {
      ver.disabled = true;
      ver.textContent = "Cargando…";
      try {
        hueco.hidden = false;
        const video = document.createElement("video");
        video.controls = true;
        video.playsInline = true;
        video.src = await urlVideo(t);
        hueco.replaceChildren(video);
        ver.remove();
        video.play().catch(() => {});
      } catch (e) {
        ver.textContent = "▶️ Ver vídeo";
        ver.disabled = false;
        alert(e.message);
      }
    });
    const guardar = boton("📲 Guardar en el móvil", "boton-principal", () => guardarVideo(t, guardar));
    if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) guardar.textContent = "⬇️ Descargar";
    acciones.append(ver, guardar);
    if (t.textoInstagram) {
      const copiar = boton("📋 Copiar texto", "boton-secundario", async () => {
        await copiarTexto(t.textoInstagram);
        copiar.textContent = "✔ Copiado";
        setTimeout(() => (copiar.textContent = "📋 Copiar texto"), 2500);
      });
      acciones.append(copiar);
    }
    if (t.resultadoNombre || t.enlace) pintarUbicacion(nodo.querySelector(".ubicacion"), t);

    // Pedir cambios: siempre a la vista debajo de cada vídeo terminado
    const cambios = nodo.querySelector(".cambios");
    cambios.hidden = false;
    const areaCambios = cambios.querySelector("textarea");
    cambios.querySelector(".boton").onclick = async (e) => {
      const texto = areaCambios.value.trim();
      if (!texto) return areaCambios.focus();
      e.target.disabled = true;
      e.target.textContent = "Enviando…";
      try {
        await api("editar", { archivos: t.archivos, voz: t.voz || null, instrucciones: texto, basadoEn: t.id });
        await cargarTrabajos();
        window.scrollTo({ top: $("titulo-lista").offsetTop, behavior: "smooth" });
      } catch (err) {
        alert(err.message);
        e.target.disabled = false;
        e.target.textContent = "✨ Hacer los cambios";
      }
    };
  }

  if (t.estado === "error") {
    nodo.classList.add("con-error");
    resumen.hidden = false;
    resumen.textContent = t.error || "No sabemos qué ha pasado.";
    acciones.append(
      boton("🔁 Reintentar", "boton-principal", async (e) => {
        e.target.disabled = true;
        await api("reintentar", { id: t.id }).catch((err) => alert(err.message));
        cargarTrabajos();
      }),
    );
  }

  if (!EN_MARCHA.includes(t.estado)) {
    acciones.append(
      boton("🗑️ Borrar", "boton-peligro", async () => {
        if (!confirm("¿Borrar este vídeo de la lista?")) return;
        await api("borrar", { id: t.id }).catch((err) => alert(err.message));
        cargarTrabajos();
      }),
    );
  }
  return nodo;
}

const ES_MOVIL = /Android|iPhone|iPad/i.test(navigator.userAgent);

// "Dónde está tu vídeo": carpeta de Drive + enlace directo para compartirlo
function pintarUbicacion(ubic, t) {
  ubic.hidden = false;
  const ruta = ubic.querySelector(".ruta");
  ruta.textContent = `${carpeta ? carpeta.ruta : "Google Drive"} › `;
  const nombre = document.createElement("strong");
  nombre.textContent = t.resultadoNombre || "vídeo";
  ruta.append(nombre);
  const compartir = ubic.querySelector(".copiar-enlace");
  const abrir = ubic.querySelector(".abrir-enlace");
  if (!t.enlace) {
    compartir.hidden = true;
    if (carpeta) abrir.href = carpeta.enlace;
    else abrir.hidden = true;
    return;
  }
  abrir.href = t.enlace;
  if (ES_MOVIL && navigator.share) compartir.textContent = "🔗 Compartir enlace";
  compartir.onclick = async () => {
    // En el móvil abre el menú de compartir (WhatsApp, correo...); si no, lo copia
    if (ES_MOVIL && navigator.share) {
      try {
        await navigator.share({ title: t.resultadoNombre || "Mi vídeo", url: t.enlace });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    await copiarTexto(t.enlace);
    compartir.textContent = "✔ Enlace copiado";
    setTimeout(() => (compartir.textContent = "🔗 Copiar enlace"), 2500);
  };
}

async function urlVideo(t) {
  if (!videosCargados.has(t.resultadoId)) {
    const blob = await descargarDeDrive(t.resultadoId);
    videosCargados.set(t.resultadoId, { blob, url: URL.createObjectURL(blob) });
  }
  return videosCargados.get(t.resultadoId).url;
}

async function guardarVideo(t, b) {
  const original = b.textContent;
  b.disabled = true;
  b.textContent = "Preparando…";
  try {
    await urlVideo(t);
    const { blob, url } = videosCargados.get(t.resultadoId);
    const nombre = `video-instagram-${t.id}.mp4`;
    const archivo = new File([blob], nombre, { type: "video/mp4" });
    // En el móvil abre el menú de compartir: "Guardar vídeo", Instagram, WhatsApp...
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try {
        await navigator.share({ files: [archivo] });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.append(a);
    a.click();
    a.remove();
  } catch (e) {
    alert(e.message);
  } finally {
    b.disabled = false;
    b.textContent = original;
  }
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const area = document.createElement("textarea");
    area.value = texto;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
function salir(mensaje) {
  clave = null;
  almacen.borrar("clave");
  $("pantalla-app").hidden = true;
  $("pantalla-clave").hidden = false;
  if (mensaje) {
    $("error-clave").textContent = mensaje;
    $("error-clave").hidden = false;
  }
}

$("form-clave").addEventListener("submit", async (e) => {
  e.preventDefault();
  clave = $("campo-clave").value.trim();
  try {
    await api("hola");
    almacen.guardar("clave", clave);
    entrar();
  } catch (err) {
    $("error-clave").textContent = err.message;
    $("error-clave").hidden = false;
  }
});

function entrar() {
  $("pantalla-clave").hidden = true;
  $("pantalla-app").hidden = false;
  cargarTrabajos();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && clave) cargarTrabajos();
});

if (!MODO_DEMO && (!URL_API || URL_API.startsWith("PEGA"))) {
  document.querySelector("main").innerHTML =
    '<p class="tarjeta aviso-error">Falta configurar la dirección del servidor en web/config.js</p>';
} else if (clave || MODO_DEMO) {
  entrar();
} else {
  salir();
}

// ---------------------------------------------------------------------------
// Modo demostración (CONFIG.APPS_SCRIPT_URL = "DEMO"): simula el servidor
// ---------------------------------------------------------------------------
function demo(accion, d) {
  const lista = (window.__demo ??= [
    {
      id: "demo1",
      creado: Date.now() - 3600e3,
      archivos: [{ id: "x", nombre: "bizcocho.mp4" }],
      instrucciones: "Pon subtítulos y un título que diga Bizcocho de limón",
      estado: "listo",
      resumen:
        "He puesto el título «Bizcocho de limón 🍋» al principio, subtítulos de lo que dices y he quitado los 3 primeros segundos en los que colocabas el móvil.",
      textoInstagram: "Bizcocho de limón esponjoso y facilísimo 🍋✨\n\n#reposteria #bizcocho #recetasfaciles",
      resultadoId: "r1",
      resultadoNombre: "Reel 2 oct 18h05 (versión 2).mp4",
      enlace: "https://drive.google.com/file/d/demo/view",
      version: 2,
      voz: { id: "v", nombre: "voz-en-off.m4a" },
    },
    {
      id: "demo2",
      creado: Date.now() - 120e3,
      archivos: [{ id: "y", nombre: "jardin.mov" }],
      instrucciones: "Hazlo más corto y ponle un filtro cálido",
      estado: "montando",
      progreso: 40,
    },
  ]);
  if (accion === "editar") {
    lista.unshift({
      id: "d" + Date.now(),
      creado: Date.now(),
      archivos: d.archivos,
      instrucciones: d.instrucciones,
      estado: "en_cola",
    });
  }
  if (accion === "borrar") lista.splice(lista.findIndex((t) => t.id === d.id), 1);
  return Promise.resolve({
    ok: true,
    trabajos: lista,
    carpeta: { ruta: "Google Drive › Editor de vídeos de mamá › 2 - Vídeos listos para Instagram", enlace: "#" },
  });
}

async function demoSubida(archivo, alProgresar) {
  for (let i = 1; i <= 10; i++) {
    await esperar(150);
    alProgresar(i / 10);
  }
  return "demo-" + archivo.name;
}

async function demoDescarga() {
  throw new Error("En el modo demostración no hay vídeo real.");
}
