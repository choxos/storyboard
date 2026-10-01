import type { Project, Scene, Track, ImageAsset } from "./model";

let decodedImages = new Set<string>();
export async function validateImageData(images: ImageAsset[]) {
  for (const asset of images) {
    if (decodedImages.has(asset.data)) continue;
    const image = new Image();
    image.src = asset.data;
    try {
      await image.decode();
    } catch {
      throw new Error(`Cannot decode image: ${asset.name}`);
    }
    if (
      image.naturalWidth !== asset.width ||
      image.naturalHeight !== asset.height
    )
      throw new Error("Image dimensions do not match its decoded pixels.");
  }
  decodedImages = new Set(images.map((asset) => asset.data));
}

export function sample(track: Track, time: number): number {
  const keys = track.keyframes;
  if (time <= keys[0].time_ms) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i];
    if (time <= b.time_ms) {
      let t = Math.max(
        0,
        Math.min(1, (time - a.time_ms) / (b.time_ms - a.time_ms)),
      );
      switch (b.easing) {
        case "ease_in":
          t = t ** 3;
          break;
        case "ease_out":
          t = 1 - (1 - t) ** 3;
          break;
        case "ease_in_out":
          t = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
          break;
        case "step":
          t = t < 1 ? 0 : 1;
      }
      return a.value + (b.value - a.value) * t;
    }
  }
  return keys[keys.length - 1].value;
}
export const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function svg(
  scene: Scene,
  time: number,
  width: number,
  height: number,
  images: ImageAsset[] = [],
): string {
  const elements = scene.elements
    .map((element) => {
      const e = { ...element };
      for (const t of element.tracks) e[t.property] = sample(t, time);
      const image = images.find((a) => a.id === e.image_id);
      const shape =
        e.kind === "image"
          ? image
            ? `<image x="${-e.width / 2}" y="${-e.height / 2}" width="${e.width}" height="${e.height}" preserveAspectRatio="xMidYMid meet" href="${escape(image.data)}"/>`
            : ""
          : e.kind === "rect"
            ? `<rect x="${-e.width / 2}" y="${-e.height / 2}" width="${e.width}" height="${e.height}" rx="${e.radius}"/>`
            : e.kind === "ellipse"
              ? `<ellipse rx="${e.width / 2}" ry="${e.height / 2}"/>`
              : e.kind === "path"
                ? `<path d="${escape(e.path)}"/>`
                : `<text text-anchor="middle" font-family="${escape(e.font_family || "Arial")}" font-size="${e.font_size}" font-weight="${e.font_weight}">${e.text
                    .replace(/\r\n/g, "\n")
                    .replace(/\n$/, "")
                    .split("\n")
                    .map(
                      (line, i) =>
                        `<tspan x="0" dy="${i ? e.font_size * 1.2 : 0}">${escape(line)}</tspan>`,
                    )
                    .join("")}</text>`;
      return `<g data-element="${escape(e.id)}" transform="translate(${e.x} ${e.y}) rotate(${e.rotation}) scale(${e.scale_x} ${e.scale_y})" opacity="${e.opacity}" fill="${escape(e.fill)}" stroke="${escape(e.stroke)}" stroke-width="${e.stroke_width}">${shape}</g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${escape(scene.background)}"/>${elements}</svg>`;
}
export function sceneAt(project: Project, time: number): [Scene, number] {
  let start = 0;
  for (const { scene } of project.scenes) {
    if (time < start + scene.duration_ms)
      return [scene, Math.max(0, time - start)];
    start += scene.duration_ms;
  }
  const last = project.scenes[project.scenes.length - 1].scene;
  return [last, last.duration_ms];
}
export async function drawFrame(
  context: CanvasRenderingContext2D,
  scene: Scene,
  time: number,
  width: number,
  height: number,
  transparent = false,
  images: ImageAsset[] = [],
) {
  const url = URL.createObjectURL(
    new Blob([svg(scene, time, width, height, images)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (transparent)
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    else {
      context.fillStyle = "white";
      context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    }
    context.drawImage(image, 0, 0, context.canvas.width, context.canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function checkSeams(project: Project): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = Math.max(
    1,
    Math.round((320 * project.height) / project.width),
  );
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable.");
  const result = [];
  for (let i = 1; i < project.scenes.length; i++) {
    const a = project.scenes[i - 1].scene,
      b = project.scenes[i].scene;
    await drawFrame(
      ctx,
      a,
      a.duration_ms,
      project.width,
      project.height,
      false,
      project.images,
    );
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    await drawFrame(
      ctx,
      b,
      0,
      project.width,
      project.height,
      false,
      project.images,
    );
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let changed = 0;
    for (let j = 0; j < before.length; j += 4)
      if ([0, 1, 2].some((k) => Math.abs(before[j + k] - after[j + k]) > 16))
        changed++;
    result.push((changed / (canvas.width * canvas.height)) * 100);
  }
  return result;
}

export async function frameImage(
  scene: Scene,
  time: number,
  width: number,
  height: number,
  images: ImageAsset[] = [],
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  await drawFrame(context, scene, time, width, height, true, images);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("PNG encoding failed. Try a smaller canvas.")),
      "image/png",
    ),
  );
}
