---
name: efectos-reels
description: Catálogo y cómo ampliar las capacidades de edición del editor de vídeos de mamá (transiciones, efectos de sonido, letras de Instagram, efectos visuales, voz en off, jump cuts). Úsala siempre que haya que añadir o cambiar un efecto, sonido, transición, letra o estilo de Reel/Historia, o cuando Claude no use bien alguno de ellos al editar.
---

# Efectos de Reels e Historias — editor de vídeos de mamá

El editor funciona así: Claude recibe los clips (fotogramas + transcripción) y las
instrucciones de mamá, y devuelve un **plan** que valida `planSchema`
([src/plan.ts](../../../src/plan.ts)). Remotion lo pinta en
[src/EditorVideo.tsx](../../../src/EditorVideo.tsx). **Una capacidad solo existe si está
en los tres sitios**: esquema (con `.describe()` claro, que es lo que lee Claude),
componente de Remotion e instrucciones de [scripts/claude.ts](../../../scripts/claude.ts).

## Catálogo actual

| Tipo | Dónde | Valores |
|---|---|---|
| Transiciones (respecto al segmento anterior) | `segmento.transicion` | corte, fundido (solapa 0,4 s), fundido_negro — a propósito solo transiciones limpias: el usuario rechazó zoom/deslizar/glitch por artificiales |
| Sonido al empezar un segmento | `segmento.sonidoEntrada` | cualquier clave de `SONIDOS` o `ninguno` |
| Efectos visuales puntuales | `plan.efectos[]` | zoom_golpe, temblor, flash, congelar_brillo (solo si se piden) |
| Frase por clip | `texto.enTrozo` | texto anclado a un segmento; `ventanaTexto()` calcula cuándo se ve |
| Zonas seguras | `zonaSegura()` en EditorVideo | arriba 14 %, abajo 24 %, derecha 15 % en vertical |
| Sonidos sueltos | `plan.sonidos[]` | claves de `SONIDOS` |
| Letras (estilos de texto de Instagram) | `texto.letra`, `subtitulos.letra` | clasica (Figtree), moderna (Bebas Neue), neon (Yellowtail + brillo), maquina (Courier Prime), fuerte (Anton), elegante (Playfair italic), comic (Bangers), manuscrita (Caveat) |
| Fondo de texto (botón "A" de Instagram) | `texto.fondo` | ninguno, caja, caja_suave |
| Animación de texto | `texto.animacion` | aparecer, rebote, escribir, deslizar, zoom |
| Subtítulos | `subtitulos.estilo` | resaltado (palabra a palabra), caja (como los automáticos de Instagram), clasico |
| Jump cuts | `quitarSilencios`, `zoomAlterno` | recorta pausas con los tiempos de whisper; alterna plano normal/cerca |
| Voz en off | `vozEnOff` + `props.voz` | se graba en la web, se limpia con ffmpeg (`limpiarVoz`) y baja el audio de los clips mientras suena |

Las letras originales de Instagram (Instagram Sans, etc.) no tienen licencia para usarse
fuera de Instagram: se usan equivalentes libres de Google Fonts.

## Añadir un efecto de sonido

1. Añade una función en [herramientas/generar_sonidos.py](../../../herramientas/generar_sonidos.py)
   que llame a `guardar("nombre", señal)` (todo sintetizado con numpy: sin derechos de
   autor). Ejecuta `py herramientas/generar_sonidos.py`.
   - Si usas un archivo externo, que sea CC0/dominio público y anota la fuente aquí.
2. Añade `nombre: "cuándo usarlo"` a `SONIDOS` en `src/plan.ts`. La descripción es lo que
   Claude lee para decidir: escríbela pensando en el momento del Reel en que encaja.
3. Nada más: el componente `Efecto` carga `public/sonidos/<nombre>.wav` y la lista de
   sonidos del prompt se genera sola desde `SONIDOS`.

## Añadir una transición o un efecto visual

1. Añade el valor al `z.enum` (`transicion` del segmento o `tipo` de `efectoSchema`) y
   explica en el `.describe()` cómo se ve.
2. Transición: nuevo `case` en `estiloTransicion()` (devuelve CSS para los primeros
   `DURACION_TRANSICION` frames del segmento) o una capa encima en `Trozo` (como flash).
   Efecto: en `transformEfectos()` (mueve/escala todo el vídeo) o en `Destellos` (capa).
3. **No dupliques `<OffthreadVideo>` del mismo clip** para conseguir un efecto: con
   varios hilos el extractor falla ("No frame found at position"). Usa CSS (`filter`,
   `drop-shadow`, `transform`) sobre el vídeo que ya existe.
4. Si suele ir con un sonido, menciónalo en las reglas de "ESTILO REELS" del prompt.

## Añadir una letra

1. Comprueba que existe en `node_modules/@remotion/google-fonts/dist/esm/<Nombre>.mjs`.
2. Importa su `loadFont` en `EditorVideo.tsx` cargando solo los pesos necesarios y añádela
   a `LETRAS` (CSS) y a `ESCALA_LETRA` (corrección de tamaño óptico).
3. Añade la clave y su descripción a `LETRAS` en `src/plan.ts`.

## Probar sin gastar saldo de Claude

```bash
npm run local -- a.mp4 b.mp4 --voz voz.wav --plan plan.json --salida out/prueba.mp4
```

`plan.json` es un plan escrito a mano (ver `planPorDefecto` en `src/plan.ts` para la
forma). Añade `--sin-transcribir` si no hace falta whisper. Saca fotogramas con
`ffmpeg -ss 3 -i out/prueba.mp4 -frames:v 1 f.jpg` para revisar el resultado.

Después de cambiar el esquema, `npx tsc --noEmit` tiene que pasar. Los planes antiguos
guardados (para "pedir cambios") pueden no tener los campos nuevos: si añades un campo
obligatorio, dale un valor por defecto en `sanearPlan` o asume que Claude lo rellenará
al rehacer el plan.

## Reglas de estilo que ya sigue Claude (scripts/claude.ts)

- Gancho en los 2 primeros segundos; trozos de 1,5–4 s al mezclar clips.
- Cada cambio de clip con transición + sonido, variando; como mucho un sonido cada 1–2 s.
- Textos con pop/ding; "escribir" con teclas; boom/brillo al final si hay "resultado".
- Historias: hasta ~15 s, textos grandes, respetar las franjas de la interfaz de Instagram
  (los márgenes ya están en `POSICION`).
- La música NO la pone el editor: se añade al publicar desde Instagram (derechos).
