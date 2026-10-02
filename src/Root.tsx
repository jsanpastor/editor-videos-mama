import React from "react";
import { Composition } from "remotion";
import { EditorVideo } from "./EditorVideo";
import { duracionTotalFrames, FORMATOS, FPS, planPorDefecto, type PropsEditor } from "./plan";

const propsPorDefecto: PropsEditor = {
  plan: planPorDefecto,
  fuentes: [{ src: "fuentes/0.mp4", duracion: 8, ancho: 1920, alto: 1080 }],
  subtitulos: [[]],
  voz: null,
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="EditorVideo"
    component={EditorVideo}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={150}
    defaultProps={propsPorDefecto}
    calculateMetadata={({ props }) => ({
      durationInFrames: duracionTotalFrames(props.plan),
      ...FORMATOS[props.plan.formato],
    })}
  />
);
