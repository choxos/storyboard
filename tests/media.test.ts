import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProject, validateProject, type ImageAsset } from "../web/model";
import { svg } from "../web/render";
import { createElement } from "../ui/templates.js";
import { composePrompt } from "../web/assistant";
import { frameTimes } from "../web/review";

const demo = () =>
  parseProject(
    readFileSync(new URL("../web/demo.storyboard", import.meta.url), "utf8"),
  );
const png = readFileSync(
  new URL("../src-tauri/icons/icon.png", import.meta.url),
);
const image: ImageAsset = {
  id: "logo",
  name: "Logo",
  data: `data:image/png;base64,${png.toString("base64")}`,
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
};

test("embedded image and font survive project roundtrip and reach SVG rendering", () => {
  // Given an imported image reused by two layers and a selected font.
  const project = demo();
  project.images = [image];
  const scene = project.scenes[0].scene;
  scene.elements[0].font_family = "Georgia";
  scene.elements.push(
    createElement(1280, 720, {
      kind: "image",
      image_id: "logo",
      width: 200,
      height: 100,
    }),
  );
  scene.elements.push(
    createElement(1280, 720, {
      kind: "image",
      image_id: "logo",
      width: 100,
      height: 50,
    }),
  );
  // When the project is saved, opened, and rendered.
  const restored = parseProject(JSON.stringify(project));
  const frame = svg(restored.scenes[0].scene, 1000, 1280, 720, restored.images);
  // Then both references resolve from one embedded asset and font reaches the renderer.
  expect(restored.images).toEqual([image]);
  expect(frame.match(/<image /g)?.length).toBe(2);
  expect(frame).toContain(`href="${image.data}"`);
  expect(frame).toContain('font-family="Georgia"');
  const prompt = composePrompt(project, 1, "At the playhead", 6500);
  expect(prompt).toContain(
    "Playhead: global 6500 ms. Scope start: 4000 ms. Local playhead: 2500 ms.",
  );
  expect(prompt).toContain('"id":"logo"');
  expect(prompt).not.toContain(image.data);
  expect(frameTimes(project, 1, 6500)).toEqual([4000, 6500, 8000 - 1000 / 30]);
  expect(frameTimes(project, null, 99999)).toEqual([0, 16000 - 1000 / 30]);
});

test("project rejects external images, malformed PNG dimensions, and missing assets", () => {
  // Given an image layer and its source.
  const project = demo();
  project.images = [structuredClone(image)];
  const damaged = Buffer.from(png);
  damaged[damaged.indexOf("IDAT") + 4] ^= 1;
  expect(() =>
    validateProject({
      ...project,
      images: [
        {
          ...image,
          data: `data:image/png;base64,${damaged.toString("base64")}`,
        },
      ],
    }),
  ).toThrow("corrupted");
  project.scenes[0].scene.elements.push(
    createElement(1280, 720, { kind: "image", image_id: "logo" }),
  );
  // When untrusted project data corrupts a source or reference, parsing must reject it.
  for (const images of [
    [],
    [{ ...image, data: "https://example.com/tracker.png" }],
    [{ ...image, width: 90000 }],
    [image, image],
  ])
    expect(() => validateProject({ ...project, images })).toThrow();
  project.scenes[0].scene.elements[0].font_family = 'Arial" onload="alert(1)';
  expect(() => validateProject(project)).toThrow();
});
