/**
 * "Puente" entre la web de mamá (GitHub Pages), Google Drive y GitHub Actions.
 *
 * - Guarda la lista de trabajos (vídeos pedidos) en las propiedades del script.
 * - Da a la web un permiso temporal de Drive (solo para los archivos de esta app)
 *   para subir los vídeos originales y descargar los terminados.
 * - Avisa a GitHub Actions para que edite el vídeo, y recibe de vuelta el progreso.
 *
 * Instalación: ver GUIA_CONFIGURACION.md
 */

var DRIVE = 'https://www.googleapis.com/drive/v3/files';
var MAX_TRABAJOS = 30;

// ---------------------------------------------------------------------------
// Ejecutar UNA vez desde el editor (botón ▶ con "configurar" seleccionado)
// ---------------------------------------------------------------------------
function configurar() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('CLAVE')) p.setProperty('CLAVE', aleatorio_(24));
  if (!p.getProperty('CARPETA_RAIZ')) {
    var raiz = crearCarpeta_('Editor de vídeos de mamá', null);
    p.setProperty('CARPETA_RAIZ', raiz);
    p.setProperty('CARPETA_ORIGINALES', crearCarpeta_('1 - Vídeos originales', raiz));
    p.setProperty('CARPETA_LISTOS', crearCarpeta_('2 - Vídeos listos para Instagram', raiz));
  }
  var faltan = ['GITHUB_TOKEN', 'GITHUB_REPO'].filter(function (k) {
    return !p.getProperty(k);
  });
  Logger.log('CLAVE (va en el enlace de mamá): ' + p.getProperty('CLAVE'));
  Logger.log('Carpeta en Drive: https://drive.google.com/drive/folders/' + p.getProperty('CARPETA_RAIZ'));
  Logger.log(faltan.length ? 'FALTAN propiedades: ' + faltan.join(', ') : 'GitHub configurado ✔');
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
function doGet() {
  return json_({ ok: true, app: 'editor-videos-mama' });
}

function doPost(e) {
  try {
    var datos = JSON.parse(e.postData.contents);
    var accion = datos.accion;
    if (accion.indexOf('servidor:') === 0) {
      if (!ACCIONES_SERVIDOR[accion]) throw new Error('Acción desconocida');
      comprobarLlave_(datos.id, datos.llave);
      return json_(ACCIONES_SERVIDOR[accion](datos));
    }
    comprobarClave_(datos.clave);
    if (!ACCIONES[accion]) throw new Error('Acción desconocida');
    return json_(ACCIONES[accion](datos));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

var ACCIONES = {
  hola: function () {
    return { ok: true };
  },

  // Permiso temporal (1 h) para subir/descargar archivos de esta app en Drive
  token: function () {
    return {
      ok: true,
      token: ScriptApp.getOAuthToken(),
      carpetaOriginales: prop_('CARPETA_ORIGINALES'),
    };
  },

  trabajos: function () {
    var lista = leerTrabajos_().map(function (t) {
      return marcarAtascado_(t);
    });
    lista.forEach(function (t) {
      delete t.llave;
    });
    return {
      ok: true,
      trabajos: lista,
      // Para que la web pueda decir dónde están los vídeos terminados
      carpeta: {
        ruta: 'Google Drive › Editor de vídeos de mamá › 2 - Vídeos listos para Instagram',
        enlace: 'https://drive.google.com/drive/folders/' + prop_('CARPETA_LISTOS'),
      },
    };
  },

  editar: function (d) {
    if (!d.archivos || !d.archivos.length) throw new Error('Falta el vídeo');
    var anterior = d.basadoEn ? leerTrabajo_(d.basadoEn) : null;
    var trabajo = {
      id: Utilities.getUuid().slice(0, 8),
      creado: Date.now(),
      actualizado: Date.now(),
      archivos: d.archivos.slice(0, 6).map(function (a) {
        return { id: String(a.id), nombre: String(a.nombre || 'vídeo').slice(0, 80) };
      }),
      voz: d.voz && d.voz.id ? { id: String(d.voz.id), nombre: String(d.voz.nombre || 'voz').slice(0, 80) } : null,
      instrucciones: String(d.instrucciones || '').slice(0, 3000),
      opciones: d.opciones
        ? {
            titulo: !!d.opciones.titulo,
            frasePorClip: !!d.opciones.frasePorClip,
            subtitulos: !!d.opciones.subtitulos,
            efectosSonido: !!d.opciones.efectosSonido,
          }
        : anterior && anterior.opciones
          ? anterior.opciones
          : null,
      basadoEn: anterior ? anterior.id : null,
      version: anterior ? (anterior.version || 1) + 1 : 1,
      estado: 'en_cola',
      progreso: null,
    };
    avisarGitHub_(trabajo);
    limpiarAntiguos_();
    delete trabajo.llave;
    return { ok: true, trabajo: trabajo };
  },

  reintentar: function (d) {
    var t = leerTrabajo_(d.id);
    if (!t) throw new Error('No encuentro ese vídeo');
    t.estado = 'en_cola';
    t.error = null;
    t.progreso = null;
    t.actualizado = Date.now();
    avisarGitHub_(t);
    return { ok: true };
  },

  borrar: function (d) {
    var t = leerTrabajo_(d.id);
    if (!t) return { ok: true };
    if (t.resultadoId) papelera_(t.resultadoId);
    borrarTrabajo_(t.id);
    return { ok: true };
  },
};

var ACCIONES_SERVIDOR = {
  'servidor:trabajo': function (d) {
    var t = leerTrabajo_(d.id);
    if (!t) throw new Error('Trabajo no encontrado: ' + d.id);
    var anterior = t.basadoEn ? leerTrabajo_(t.basadoEn) : null;
    return {
      ok: true,
      trabajo: t,
      planAnterior: anterior ? leerPlan_(anterior.id) : null,
      token: ScriptApp.getOAuthToken(),
      carpetaListos: prop_('CARPETA_LISTOS'),
      // Correos que reciben automáticamente cada vídeo terminado (propiedad COMPARTIR_CON, separados por comas)
      compartirCon: (PropertiesService.getScriptProperties().getProperty('COMPARTIR_CON') || '')
        .split(',')
        .map(function (c) {
          return c.trim();
        })
        .filter(function (c) {
          return /@/.test(c);
        }),
    };
  },

  'servidor:actualizar': function (d) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var t = leerTrabajo_(d.id);
      if (!t) throw new Error('Trabajo no encontrado: ' + d.id);
      var permitidos = ['estado', 'progreso', 'error', 'resumen', 'textoInstagram', 'resultadoId', 'resultadoNombre', 'enlace', 'duracion', 'ejecucion'];
      permitidos.forEach(function (k) {
        if (d.campos && d.campos.hasOwnProperty(k)) t[k] = d.campos[k];
      });
      if (d.campos && d.campos.plan) guardarPlan_(t.id, d.campos.plan);
      t.actualizado = Date.now();
      // Trabajo terminado: la llave ya no sirve para nada más
      if (t.estado === 'listo' || t.estado === 'error') delete t.llave;
      guardarTrabajo_(t);
      return { ok: true };
    } finally {
      lock.releaseLock();
    }
  },
};

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Falta configurar ' + k + ' (ejecuta configurar())');
  return v;
}

function aleatorio_(n) {
  var letras = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < n; i++) s += letras.charAt(Math.floor(Math.random() * letras.length));
  return s;
}

// Frena a quien intente adivinar la clave a base de probar
function comprobarClave_(clave) {
  var cache = CacheService.getScriptCache();
  var fallos = Number(cache.get('fallos') || 0);
  if (fallos > 30) throw new Error('Demasiados intentos. Espera unos minutos.');
  if (!clave || clave !== prop_('CLAVE')) {
    cache.put('fallos', String(fallos + 1), 600);
    throw new Error('Clave incorrecta');
  }
}

// GitHub Actions demuestra que trabaja para un vídeo concreto con la llave de
// un solo uso que le mandamos al avisarle (no queda en ningún log público).
function comprobarLlave_(id, llave) {
  var t = id ? leerTrabajo_(id) : null;
  if (!t || !t.llave || !llave || llave !== t.llave) throw new Error('Llave incorrecta');
}

function leerTrabajo_(id) {
  var v = PropertiesService.getScriptProperties().getProperty('t_' + id);
  return v ? JSON.parse(v) : null;
}

function guardarTrabajo_(t) {
  PropertiesService.getScriptProperties().setProperty('t_' + t.id, JSON.stringify(t));
}

function borrarTrabajo_(id) {
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty('t_' + id);
  p.deleteProperty('p_' + id);
}

// El plan de edición (para poder pedir cambios luego) se guarda aparte y
// comprimido: las propiedades solo admiten ~9 KB por valor.
function guardarPlan_(id, plan) {
  var zip = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(plan), 'application/json')).getBytes());
  if (zip.length < 8800) PropertiesService.getScriptProperties().setProperty('p_' + id, zip);
}

function leerPlan_(id) {
  var zip = PropertiesService.getScriptProperties().getProperty('p_' + id);
  if (!zip) return null;
  var blob = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(zip), 'application/x-gzip'));
  return JSON.parse(blob.getDataAsString());
}

function leerTrabajos_() {
  var todas = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(todas)
    .filter(function (k) {
      return k.indexOf('t_') === 0;
    })
    .map(function (k) {
      return JSON.parse(todas[k]);
    })
    .sort(function (a, b) {
      return b.creado - a.creado;
    });
}

function limpiarAntiguos_() {
  var lista = leerTrabajos_();
  lista.slice(MAX_TRABAJOS).forEach(function (t) {
    borrarTrabajo_(t.id);
  });
}

// Si GitHub no responde, que mamá no se quede esperando para siempre
function marcarAtascado_(t) {
  var minutos = (Date.now() - t.actualizado) / 60000;
  var enMarcha = ['en_cola', 'preparando', 'escuchando', 'pensando', 'montando', 'subiendo'];
  if (enMarcha.indexOf(t.estado) >= 0 && minutos > (t.estado === 'en_cola' ? 30 : 45)) {
    t.estado = 'error';
    t.error = 'Se ha quedado atascado. Pulsa "Reintentar".';
  }
  return t;
}

function avisarGitHub_(t) {
  t.llave = aleatorio_(40);
  guardarTrabajo_(t);
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + prop_('GITHUB_REPO') + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + prop_('GITHUB_TOKEN'),
      Accept: 'application/vnd.github+json',
    },
    payload: JSON.stringify({ event_type: 'editar-video', client_payload: { id: t.id, llave: t.llave } }),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() >= 300) {
    throw new Error('GitHub no acepta el aviso (' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 200));
  }
}

function crearCarpeta_(nombre, padre) {
  var r = UrlFetchApp.fetch(DRIVE, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({
      name: nombre,
      mimeType: 'application/vnd.google-apps.folder',
      parents: padre ? [padre] : undefined,
    }),
  });
  return JSON.parse(r.getContentText()).id;
}

function papelera_(id) {
  UrlFetchApp.fetch(DRIVE + '/' + id, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ trashed: true }),
    muteHttpExceptions: true,
  });
}
