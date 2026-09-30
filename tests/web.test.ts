import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  parseProject,
  parseReply,
  validateProject,
  type Easing,
  type Track,
} from "../web/model";
import { sample, sceneAt, svg } from "../web/render";
import { analyzeSamples } from "../web/audio";
import { composePrompt } from "../web/assistant";

const demo = () =>
  parseProject(
    readFileSync(new URL("../web/demo.storyboard", import.meta.url), "utf8"),
  );

test("browser opens native project and rejects unsafe or invalid edits", () => {
  const p = demo();
  expect(p.scenes.length).toBe(4);
  const invalid = [
    (v: typeof p) => {
      v.width = 1081;
    },
    (v: typeof p) => {
      v.width = v.height = 8192;
    },
    (v: typeof p) => {
      v.scenes[0].scene.elements[0].fill = "url(https://example.com/x)";
    },
    (v: typeof p) => {
      v.scenes[0].scene.elements[0].opacity = NaN;
    },
    (v: typeof p) => {
      v.scenes.push(structuredClone(v.scenes[0]));
    },
    (v: typeof p) => {
      v.scenes[0].scene.elements[0].tracks = [
        {
          property: "x",
          keyframes: [
            { time_ms: 2, value: 0, easing: "linear" },
            { time_ms: 1, value: 1, easing: "linear" },
          ],
        },
      ];
    },
  ];
  for (const mutate of invalid) {
    const value = demo();
    mutate(value);
    expect(() => validateProject(value)).toThrow();
  }
  expect(() =>
    parseProject(JSON.stringify({ ...p, script: "alert(1)" })),
  ).toThrow();
  for (const [width, height] of [
    [1080, 1920],
    [1080, 1080],
    [8192, 4320],
  ])
    validateProject({ ...p, width, height });
});

test("browser interpolation matches native cubic and step conventions", () => {
  for (const [easing, expected] of [
    ["linear", 25],
    ["ease_in", 1.5625],
    ["ease_out", 57.8125],
    ["ease_in_out", 6.25],
    ["step", 0],
  ] as [Easing, number][]) {
    const t: Track = {
      property: "x",
      keyframes: [
        { time_ms: 100, value: 0, easing: "linear" },
        { time_ms: 1100, value: 100, easing },
      ],
    };
    expect(sample(t, -100)).toBe(0);
    expect(sample(t, 350)).toBe(expected);
    expect(sample(t, 1100)).toBe(100);
    expect(sample(t, 9999)).toBe(100);
  }
  const p = demo();
  const first = p.scenes[0].scene;
  expect(sceneAt(p, first.duration_ms)[0].id).toBe(p.scenes[1].scene.id);
  expect(sceneAt(p, 999999)[0].id).toBe(p.scenes.at(-1)!.scene.id);
  first.elements[0].text = '<script>alert("x")</script>&';
  first.elements[0].id = '" onclick="alert(1)';
  const xml = svg(first, 1200, 1280, 720);
  expect(xml).not.toContain("<script>");
  expect(xml).toContain("&lt;script&gt;");
  expect(xml).toContain("&quot; onclick=&quot;");
});

test("browser beat detector recovers accented 120 BPM and handles silence", () => {
  const samples = new Float32Array(22050 * 12);
  for (let beat = 0; beat < 24; beat++)
    samples.fill(beat % 4 ? 0.4 : 0.9, beat * 11025, beat * 11025 + 220);
  const analysis = analyzeSamples(samples, 22050);
  expect(Math.abs(analysis.bpm - 120)).toBeLessThan(2);
  expect(analysis.confidence).toBeGreaterThan(0.7);
  expect(analysis.peaks.length).toBeLessThanOrEqual(1600);
  expect(analyzeSamples(new Float32Array(22050), 22050).confidence).toBe(0);
});

test("assistant exchange validates scene and project scope before applying", () => {
  const p = demo(),
    scene = structuredClone(p.scenes[0].scene);
  scene.elements[0].text = "Edited in browser";
  expect(
    parseReply(
      JSON.stringify({ summary: "Changed title", scenes: [scene] }),
      p,
      0,
    ).scenes[0].elements[0].text,
  ).toBe("Edited in browser");
  expect(p.scenes[0].scene.elements[0].text).not.toBe("Edited in browser");
  expect(() =>
    parseReply(
      JSON.stringify({ summary: "Invalid", scenes: [scene, scene] }),
      p,
      null,
    ),
  ).toThrow();
  scene.id = "changed-id";
  expect(() =>
    parseReply(JSON.stringify({ summary: "Invalid", scenes: [scene] }), p, 0),
  ).toThrow();
  const prompt = composePrompt(p, 0, "Make title blue");
  expect(prompt).toContain("Return exactly ONE scene");
  expect(prompt).toContain("Make title blue");
});
