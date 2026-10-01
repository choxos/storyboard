import type { Project } from "./model";
import { drawFrame, sceneAt } from "./render";

export function frameTimes(
  project: Project,
  index: number | null,
  playhead: number,
): number[] {
  const start =
    index === null
      ? 0
      : project.scenes
          .slice(0, index)
          .reduce((n, d) => n + d.scene.duration_ms, 0);
  const duration =
    index === null
      ? project.scenes.reduce((n, d) => n + d.scene.duration_ms, 0)
      : project.scenes[index].scene.duration_ms;
  const end = start + duration - 1000 / project.fps;
  return [
    ...new Set([start, Math.max(start, Math.min(end, playhead)), end]),
  ].sort((a, b) => a - b);
}

export async function frameSheet(
  project: Project,
  index: number | null,
  playhead: number,
): Promise<Blob> {
  const times = frameTimes(project, index, playhead);
  const scale = Math.min(1, 720 / Math.max(project.width, project.height));
  const width = Math.max(1, Math.round(project.width * scale)),
    height = Math.max(1, Math.round(project.height * scale));
  const canvas = document.createElement("canvas"),
    frame = document.createElement("canvas");
  canvas.width = Math.max(360, width);
  canvas.height = (height + 40) * times.length;
  frame.width = width;
  frame.height = height;
  const context = canvas.getContext("2d"),
    frameContext = frame.getContext("2d");
  if (!context || !frameContext) throw new Error("Canvas is unavailable.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [i, time] of times.entries()) {
    const [scene, local] = sceneAt(project, time);
    await drawFrame(
      frameContext,
      scene,
      local,
      project.width,
      project.height,
      false,
      project.images,
    );
    context.drawImage(frame, 0, i * (height + 40));
    context.fillStyle = "#171717";
    context.font = "13px Arial";
    context.fillText(
      `${scene.name} | global ${Math.round(time)} ms | scene ${Math.round(local)} ms`,
      8,
      i * (height + 40) + height + 25,
      canvas.width - 16,
    );
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Cannot encode review frames.")),
      "image/png",
    ),
  );
}
