import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  moveElement,
  applyMotionPreset,
  motionPresets,
} from "../ui/editing.js";
import { validateScene } from "../web/model";
import { sample } from "../web/render";

const scene = () =>
  JSON.parse(
    readFileSync(new URL("../web/demo.storyboard", import.meta.url), "utf8"),
  ).scenes[0].scene;

test("movement shifts the complete motion path and leaves other tracks intact", () => {
  const element = scene().elements[0],
    before = structuredClone(element);
  moveElement(element, 24, -10);
  expect(element.x).toBe(before.x + 24);
  expect(element.y).toBe(before.y - 10);
  for (let i = 0; i < element.tracks.length; i++) {
    const track = element.tracks[i],
      original = before.tracks[i];
    for (const time of [0, 300, 700, 4000])
      expect(sample(track, time)).toBeCloseTo(
        sample(original, time) +
          (track.property === "y" ? -10 : track.property === "x" ? 24 : 0),
        8,
      );
  }
  moveElement(element, -24, 10);
  expect(element).toEqual(before);
});

test("an entrance preset and fade out combine on one opacity track", () => {
  const s = scene();
  s.duration_ms = 4000;
  s.elements = [s.elements[0]];
  const e = s.elements[0];
  e.tracks = [];
  applyMotionPreset(e, "slide-from-left", 4000, 50);
  applyMotionPreset(e, "fade-out", 4000, 50);
  applyMotionPreset(e, "fade-in", 4000, 50);
  validateScene(s);
  const opacity = e.tracks.find((t) => t.property === "opacity");
  expect([0, 600, 3400, 4000].map((t) => sample(opacity, t))).toEqual([
    0,
    e.opacity,
    e.opacity,
    0,
  ]);
  const x = e.tracks.find((t) => t.property === "x");
  expect([sample(x, 0), sample(x, 600)]).toEqual([e.x - 50, e.x]);
});

test("all motion presets stay valid on short and long scenes and preserve unrelated tracks", () => {
  for (const duration of [100, 600, 4000, 120000])
    for (const preset of Object.keys(motionPresets)) {
      const s = scene();
      s.duration_ms = duration;
      s.elements = [s.elements[0]];
      const e = s.elements[0];
      e.tracks = [
        {
          property: "rotation",
          keyframes: [{ time_ms: 0, value: 20, easing: "linear" }],
        },
      ];
      applyMotionPreset(e, preset, duration, 72);
      validateScene(s);
      expect(
        e.tracks.find((t) => t.property === "rotation").keyframes[0].value,
      ).toBe(20);
      const opacity = e.tracks.find((t) => t.property === "opacity");
      expect(sample(opacity, duration)).toBe(
        preset === "fade-out" ? 0 : e.opacity,
      );
      applyMotionPreset(e, preset, duration, 72);
      validateScene(s);
      expect(new Set(e.tracks.map((t) => t.property)).size).toBe(
        e.tracks.length,
      );
    }
});
