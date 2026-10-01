# Editor de vídeos de mamá 🎬

Web sencilla para editar vídeos para Instagram dando instrucciones con palabras
("quita el principio, pon subtítulos y un título bonito"). Claude decide la edición y
Remotion la monta.

- **Web** (`web/`): se publica en GitHub Pages. Subir vídeos, escribir o dictar
  instrucciones, ver el progreso, guardar el resultado en el móvil y copiar el texto
  para la publicación.
- **Puente** (`apps-script/`): Google Apps Script. Guarda los vídeos en Google Drive,
  lleva la lista de trabajos y avisa a GitHub Actions.
- **Editor** (`scripts/` + `src/`): se ejecuta en GitHub Actions. Normaliza los vídeos con
  ffmpeg, transcribe la voz con whisper.cpp, pide a Claude un plan de edición
  (esquema en [`src/plan.ts`](src/plan.ts)) y lo renderiza con Remotion
  ([`src/EditorVideo.tsx`](src/EditorVideo.tsx)).

Qué sabe hacer: formato Reels/feed/cuadrado, recortar y unir trozos (también de varios
vídeos), cambiar velocidad, filtros de color, zoom lento, fundidos, volumen, textos
animados y subtítulos palabra a palabra. Además propone el texto de la publicación.

**Instalación:** [GUIA_CONFIGURACION.md](GUIA_CONFIGURACION.md).

> Remotion está fijado en 4.0.530 a propósito (la 4.0.531 publicó el Studio roto).
