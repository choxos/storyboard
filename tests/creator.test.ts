import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { canvasSizes } from "../ui/canvas.js";
import { sceneTemplates, createTemplate } from "../ui/templates.js";
import { alignmentDelta, moveElement } from "../ui/editing.js";
import { audioGain } from "../ui/audio-mix.js";
import { validateScene, validateProject, type Project } from "../web/model";
import { analyzeSamples } from "../web/audio";

test("editable templates validate in every canvas preset with unique scene and layer IDs", () => {
  const ids = new Set<string>();
  for (const [, width, height] of [
    ...Object.values(canvasSizes).flat(),
    ["small", 64, 64],
  ]) {
    for (const name of Object.keys(sceneTemplates)) {
      const document = createTemplate(
        name,
        Number(width),
        Number(height),
        "#ec713c",
      );
      validateScene(document.scene);
      expect(ids.has(document.scene.id)).toBe(false);
      ids.add(document.scene.id);
      expect(document.scene.elements.some((e) => e.kind === "text")).toBe(true);
      expect(
        document.scene.elements.every(
          (e) =>
            e.x >= 0 &&
            e.x <= Number(width) &&
            e.y >= 0 &&
            e.y <= Number(height),
        ),
      ).toBe(true);
      expect(document.scene.elements.some((e) => e.fill === "#ec713c")).toBe(
        true,
      );
    }
  }
});

test("canvas alignment uses visible bounds and moves the complete position animation", () => {
  const bounds = { x: 100, y: 40, width: 300, height: 120 };
  expect(alignmentDelta(bounds, 1000, 600, "center")).toEqual([250, 200]);
  expect(alignmentDelta(bounds, 1000, 600, "left")).toEqual([-50, 0]);
  expect(alignmentDelta(bounds, 1000, 600, "bottom")).toEqual([0, 410]);
  const layer = createTemplate("title", 1000, 600).scene.elements.find(
    (e) => e.kind === "text",
  )!;
  const track = layer.tracks.find((t) => t.property === "y")!;
  const before = track.keyframes.map((k) => k.value);
  const [dx, dy] = alignmentDelta(bounds, 1000, 600, "center");
  moveElement(layer, dx, dy);
  expect(track.keyframes.map((k) => k.value)).toEqual(
    before.map((v) => v + 200),
  );
});

test("sound mix preserves old projects and matches fades, mute, and shortened videos", () => {
  const project: Project = JSON.parse(
    readFileSync(new URL("../web/demo.storyboard", import.meta.url), "utf8"),
  );
  const audio = analyzeSamples(new Float32Array(22050 * 2), 22050);
  project.audio = audio;
  validateProject(project);
  expect(audioGain(audio, 500, 2000)).toBe(1);
  audio.mix = {
    volume: 0.4,
    muted: false,
    fade_in_ms: 1000,
    fade_out_ms: 1000,
  };
  validateProject(project);
  expect(audioGain(audio, 0, 2000)).toBe(0);
  expect(audioGain(audio, 500, 2000)).toBeCloseTo(0.2);
  expect(audioGain(audio, 1000, 2000)).toBeCloseTo(0.4);
  expect(audioGain(audio, 1750, 2000)).toBeCloseTo(0.1);
  expect(audioGain(audio, 500, 1000)).toBeCloseTo(0.1);
  expect(audioGain(audio, 2000, 2000)).toBe(0);
  audio.mix.muted = true;
  expect(audioGain(audio, 1000, 2000)).toBe(0);
  audio.mix.volume = 2;
  expect(() => validateProject(project)).toThrow();
  audio.mix.volume = 0.4;
  for (const extra of ["", "surprise"])
    expect(() => validateProject({ ...project, [extra]: true })).toThrow();
});
