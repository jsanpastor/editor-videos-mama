# Guía de configuración (se hace una sola vez, ~20 minutos)

Al final tendrás **un enlace** que le mandas a tu madre. Ella lo abre en el móvil o en el
ordenador, elige el vídeo, escribe (o dicta) lo que quiere y en unos minutos tiene el vídeo
editado listo para Instagram.

## Cómo funciona por dentro

```
 Móvil / PC de mamá                Google (tu cuenta)                 GitHub (tu cuenta)
┌──────────────────┐  sube vídeo  ┌──────────────────────┐  avisa   ┌──────────────────────────┐
│ Web (GitHub      │ ───────────▶ │ Drive: carpeta       │ ───────▶ │ Actions:                 │
│ Pages)           │              │ "Editor de vídeos"   │          │ 1. descarga el vídeo     │
│ - elegir vídeo   │ ◀─────────── │ Apps Script: guarda  │ ◀─────── │ 2. whisper: transcribe   │
│ - instrucciones  │  estado y    │ la lista de trabajos │ progreso │ 3. Claude: plan edición  │
│ - ver/guardar    │  vídeo final │                      │ y vídeo  │ 4. Remotion: renderiza   │
└──────────────────┘              └──────────────────────┘          └──────────────────────────┘
```

- Los vídeos **nunca** se guardan en GitHub: viven en tu Google Drive, en la carpeta
  *Editor de vídeos de mamá* (originales y terminados por separado).
- La app solo tiene permiso sobre los archivos que ella misma crea en Drive (no ve el resto
  de tu Drive).

## Qué necesitas

- Cuenta de **GitHub**.
- Cuenta de **Google** (la de tu Drive).
- Una **API key de Anthropic** con saldo: <https://console.anthropic.com> → *API Keys*.
  Cada vídeo cuesta del orden de **5–15 céntimos** de Claude.
- GitHub Actions es **gratis** si el repositorio es público (que es lo que recomendamos: el
  código es público, pero los vídeos, las instrucciones y las claves no).

---

## Paso 1 · Subir el código a GitHub

1. Crea un repositorio nuevo en <https://github.com/new> llamado `editor-videos-mama`,
   **público**, sin README.
2. Desde esta carpeta:

```bash
git remote add origin https://github.com/TU_USUARIO/editor-videos-mama.git
```

```bash
git push -u origin main
```

## Paso 2 · Token para que Google pueda avisar a GitHub

1. <https://github.com/settings/personal-access-tokens/new> (*Fine-grained token*).
2. Nombre: `editor-videos-mama`. Caducidad: la máxima que te deje (apúntate renovarlo).
3. *Repository access* → **Only select repositories** → `editor-videos-mama`.
4. *Permissions* → *Repository permissions* → **Contents: Read and write**.
5. Genera y copia el token (`github_pat_...`).

## Paso 3 · El "puente" en Google (Apps Script)

1. Entra en <https://script.google.com> con tu cuenta de Google → **Nuevo proyecto**.
   Ponle de nombre *Editor de vídeos de mamá*.
2. ⚙️ *Configuración del proyecto* → marca **Mostrar el archivo de manifiesto
   "appsscript.json" en el editor**.
3. Vuelve al editor (`< >`):
   - Abre `appsscript.json` y sustituye todo por el contenido de
     [`apps-script/appsscript.json`](apps-script/appsscript.json).
   - Abre `Código.gs` y sustituye todo por el contenido de
     [`apps-script/Code.gs`](apps-script/Code.gs). Guarda (💾).
4. ⚙️ *Configuración del proyecto* → *Propiedades del script* → añade:
   - `GITHUB_TOKEN` = el token del paso 2
   - `GITHUB_REPO` = `TU_USUARIO/editor-videos-mama`
5. En el editor, elige la función **`configurar`** en el desplegable y pulsa **▶ Ejecutar**.
   - Google pedirá permisos. Saldrá *"Google no ha verificado esta aplicación"*: es normal,
     es tu propio script → *Configuración avanzada* → *Ir a Editor de vídeos de mamá* →
     *Permitir*.
   - En el registro de ejecución aparecerán la **CLAVE** y el **SECRETO**. Cópialos.
6. **Implementar** → **Nueva implementación** → tipo ⚙️ **Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario**
   - Pulsa *Implementar* y copia la **URL de la aplicación web** (acaba en `/exec`).

> Si algún día cambias `Code.gs`: *Implementar* → *Gestionar implementaciones* → ✏️ →
> *Versión: nueva versión* → *Implementar*. Así la URL no cambia.

## Paso 4 · Secretos en GitHub

En el repositorio → *Settings* → *Secrets and variables* → *Actions* → **New repository
secret**, crea estos tres:

| Nombre | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | tu API key de Anthropic (`sk-ant-...`) |
| `APPS_SCRIPT_URL` | la URL `/exec` del paso 3.6 |
| `SECRETO_SERVIDOR` | el SECRETO del paso 3.5 |

## Paso 5 · Publicar la web

1. Edita [`web/config.js`](web/config.js) y pon la URL `/exec` del paso 3.6 en
   `APPS_SCRIPT_URL`. Haz commit y push.
2. En el repositorio → *Settings* → *Pages* → *Source*: **GitHub Actions**.
3. En la pestaña *Actions*, ejecuta **Publicar web** (o espera a que se lance con el push).

## Paso 6 · El enlace para tu madre

```
https://TU_USUARIO.github.io/editor-videos-mama/#clave=LA_CLAVE_DEL_PASO_3
```

- Mándaselo por WhatsApp. La primera vez que lo abra se queda guardado en ese móvil u
  ordenador; las siguientes veces le vale con abrir la página.
- En el móvil, que lo añada a la pantalla de inicio (Safari: *Compartir → Añadir a
  pantalla de inicio*; Chrome: ⋮ → *Añadir a pantalla de inicio*). Así parece una app.
- **No publiques la clave**: quien la tenga puede editar vídeos con tu saldo de Anthropic.
  Si se filtra, borra la propiedad `CLAVE` en Apps Script, ejecuta `configurar` otra vez y
  manda el enlace nuevo.

## Paso 7 · Primera prueba

Abre el enlace, sube un vídeo corto y pide algo sencillo (*"pon subtítulos y un título"*).
En la pestaña *Actions* de GitHub verás el trabajo **Editar vídeo** en marcha. La primera
vez tarda algo más (~10 min) porque descarga y compila el transcriptor; luego se guarda en
caché.

---

## Si algo falla

| Síntoma | Qué mirar |
|---|---|
| La web dice "Falta configurar la dirección del servidor" | `web/config.js` sin la URL |
| "Clave incorrecta" | El enlace no lleva bien la `#clave=...` |
| "GitHub no acepta el aviso (401/404)" | `GITHUB_TOKEN` caducado o sin permiso *Contents: write*, o `GITHUB_REPO` mal escrito |
| Se queda "En la cola" | *Actions* del repo: ¿se ha lanzado *Editar vídeo*? ¿Actions está activado? |
| Error durante la edición | Abre la ejecución en *Actions* → paso *Editar el vídeo*. Los logs no muestran el contenido del vídeo ni las instrucciones |
| No sube vídeos | Que `configurar` se haya ejecutado (crea las carpetas) y que la implementación sea "Cualquier usuario" |

## Probar en el ordenador (sin Drive ni GitHub)

Necesitas Node 24 y ffmpeg.

```bash
npm install
```

```bash
npm run local -- mi-video.mp4 -i "quita los 3 primeros segundos y pon subtítulos"
```

(Requiere `ANTHROPIC_API_KEY` en el entorno. Con `--plan plan.json --sin-transcribir` se
prueba solo el montaje, sin Claude.) El resultado queda en `out/resultado.mp4`.
Para ver y retocar el diseño de los textos y subtítulos: `npm run studio`.

La web se puede ver en modo demostración (sin servidor) abriendo `web/index.html?demo`
con cualquier servidor estático.
