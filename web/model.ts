export type Property =
  | "x"
  | "y"
  | "width"
  | "height"
  | "opacity"
  | "rotation"
  | "scale_x"
  | "scale_y";
export type Easing = "linear" | "ease_in" | "ease_out" | "ease_in_out" | "step";
export interface Keyframe {
  time_ms: number;
  value: number;
  easing: Easing;
}
export interface Track {
  property: Property;
  keyframes: Keyframe[];
}
export interface Element {
  id: string;
  kind: "text" | "rect" | "ellipse" | "path";
  text: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  stroke_width: number;
  font_size: number;
  font_weight: number;
  radius: number;
  opacity: number;
  rotation: number;
  scale_x: number;
  scale_y: number;
  tracks: Track[];
}
export interface Scene {
  id: string;
  name: string;
  duration_ms: number;
  background: string;
  elements: Element[];
}
export interface Chat {
  role: string;
  text: string;
  provider: string;
}
export interface SceneDocument {
  scene: Scene;
  revisions: { label: string; scene: Scene }[];
  chat: Chat[];
}
export interface AudioTrack {
  path: string;
  name: string;
  duration_ms: number;
  peaks: number[];
  bpm: number;
  offset_ms: number;
  beats_per_bar: number;
  sections: number[];
  confidence: number;
}
export interface Project {
  version: number;
  name: string;
  width: number;
  height: number;
  fps: number;
  art_direction: string;
  scenes: SceneDocument[];
  chat: Chat[];
  audio: AudioTrack | null;
}
export interface Reply {
  summary: string;
  scenes: Scene[];
}

const properties = [
  "x",
  "y",
  "width",
  "height",
  "opacity",
  "rotation",
  "scale_x",
  "scale_y",
];
const easings = ["linear", "ease_in", "ease_out", "ease_in_out", "step"];
function require(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function object(value: unknown, keys: string): Record<string, unknown> {
  require(value !== null &&
    typeof value === "object" &&
    !Array.isArray(value), "Expected an object.");
  const v = value as Record<string, unknown>,
    expected = keys.split(" ");
  require(Object.keys(v).length === expected.length &&
    expected.every((k) =>
      Object.hasOwn(v, k),
    ), "Missing or unknown project fields.");
  return v;
}
function string(v: unknown, max: number, min = 0): asserts v is string {
  require(typeof v === "string" &&
    new TextEncoder().encode(v).length <= max &&
    v.length >= min, "Invalid or oversized text.");
}
function number(
  v: unknown,
  min: number,
  max: number,
  integer = false,
): asserts v is number {
  require(typeof v === "number" &&
    Number.isFinite(v) &&
    v >= min &&
    v <= max &&
    (!integer || Number.isInteger(v)), "Invalid number or geometry.");
}
function array(v: unknown, max: number, min = 0): asserts v is unknown[] {
  require(Array.isArray(v) &&
    v.length >= min &&
    v.length <= max, "Invalid list length.");
}
function color(v: unknown) {
  require(typeof v === "string" &&
    /^(none|#[0-9a-f]{6})$/i.test(v), "Colors must be #RRGGBB or none.");
}
export function validateCanvas(w: number, h: number) {
  number(w, 64, 8192, true);
  number(h, 64, 8192, true);
  require(w % 2 === 0 &&
    h % 2 === 0 &&
    w * h <=
      8192 *
        4320, "Use even canvas dimensions, up to 35,389,440 total pixels.");
}
export function validateScene(value: unknown): asserts value is Scene {
  const s = object(value, "id name duration_ms background elements");
  string(s.id, 100, 1);
  string(s.name, 200);
  number(s.duration_ms, 100, 120000, true);
  color(s.background);
  array(s.elements, 250);
  const ids = new Set();
  for (const raw of s.elements) {
    const e = object(
      raw,
      "id kind text path x y width height fill stroke stroke_width font_size font_weight radius opacity rotation scale_x scale_y tracks",
    );
    string(e.id, 100, 1);
    require(!ids.has(e.id), "Element IDs must be unique.");
    ids.add(e.id);
    require(["text", "rect", "ellipse", "path"].includes(
      String(e.kind),
    ), "Invalid element kind.");
    string(e.text, 10000);
    string(e.path, 50000);
    color(e.fill);
    color(e.stroke);
    for (const k of ["x", "y", "rotation", "scale_x", "scale_y"])
      number(e[k], -100000, 100000);
    for (const k of ["width", "height", "stroke_width", "radius"])
      number(e[k], 0, 100000);
    number(e.font_size, 1, 1000);
    number(e.font_weight, 100, 900, true);
    number(e.opacity, 0, 1);
    array(e.tracks, 8);
    const seen = new Set();
    for (const rawTrack of e.tracks) {
      const t = object(rawTrack, "property keyframes");
      require(properties.includes(String(t.property)) &&
        !seen.has(
          t.property,
        ), "Animation properties must be supported and unique.");
      seen.add(t.property);
      array(t.keyframes, 100, 1);
      let previous = -1;
      for (const rawKey of t.keyframes) {
        const k = object(rawKey, "time_ms value easing");
        number(k.time_ms, 0, s.duration_ms, true);
        require(k.time_ms >
          previous, "Keyframe times must increase within the scene.");
        previous = k.time_ms;
        number(
          k.value,
          ["width", "height", "opacity"].includes(String(t.property))
            ? 0
            : -100000,
          t.property === "opacity" ? 1 : 100000,
        );
        require(easings.includes(String(k.easing)), "Invalid easing.");
      }
    }
  }
}
function chat(value: unknown) {
  array(value, 100);
  for (const raw of value) {
    const m = object(raw, "role text provider");
    string(m.role, 100);
    string(m.text, 50000);
    string(m.provider, 200);
  }
}
export function validateProject(value: unknown): asserts value is Project {
  const p = object(
    value,
    "version name width height fps art_direction scenes chat audio",
  );
  require(p.version === 1, "Unsupported project version.");
  string(p.name, 200);
  string(p.art_direction, 20000);
  number(p.width, 64, 8192, true);
  number(p.height, 64, 8192, true);
  validateCanvas(p.width, p.height);
  require([24, 30, 60].includes(Number(p.fps)) &&
    typeof p.fps === "number", "Use 24, 30, or 60 fps.");
  array(p.scenes, 100, 1);
  const ids = new Set();
  let duration = 0;
  for (const raw of p.scenes) {
    const d = object(raw, "scene revisions chat");
    validateScene(d.scene);
    require(!ids.has(d.scene.id), "Scene IDs must be unique.");
    ids.add(d.scene.id);
    duration += d.scene.duration_ms;
    array(d.revisions, 50);
    for (const rawRevision of d.revisions) {
      const r = object(rawRevision, "label scene");
      string(r.label, 50000);
      validateScene(r.scene);
    }
    chat(d.chat);
  }
  require(duration <= 600000, "Projects are limited to 10 minutes.");
  chat(p.chat);
  if (p.audio !== null) {
    const a = object(
      p.audio,
      "path name duration_ms peaks bpm offset_ms beats_per_bar sections confidence",
    );
    string(a.path, 10000);
    string(a.name, 1000);
    number(a.duration_ms, 1, 600000, true);
    number(a.bpm, 30, 300);
    number(a.offset_ms, -600000, 600000);
    number(a.beats_per_bar, 1, 12, true);
    number(a.confidence, 0, 1);
    array(a.peaks, 4000);
    array(a.sections, 1000);
    a.peaks.forEach((v) => number(v, 0, 1));
    a.sections.forEach((v) => number(v, 0, Number(a.duration_ms), true));
  }
}
export function parseProject(text: string): Project {
  require(new TextEncoder().encode(text).length <=
    20000000, "Project files are limited to 20 MB.");
  const p: unknown = JSON.parse(text);
  validateProject(p);
  return p;
}
export function parseReply(
  text: string,
  project: Project,
  index: number | null,
): Reply {
  require(new TextEncoder().encode(text).length <=
    20000000, "Response is too large.");
  const r = object(
    JSON.parse(
      text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1"),
    ),
    "summary scenes",
  );
  string(r.summary, 50000);
  array(r.scenes, 100, 1);
  r.scenes.forEach(validateScene);
  if (index !== null)
    require(r.scenes.length === 1 &&
      (r.scenes[0] as Scene).id ===
        project.scenes[index].scene
          .id, "Return exactly one scene, preserving its ID.");
  const reply = r as unknown as Reply;
  const candidate = structuredClone(project);
  if (index !== null) candidate.scenes[index].scene = reply.scenes[0];
  else
    candidate.scenes = reply.scenes.map((scene) => ({
      scene,
      revisions: [],
      chat: [],
    }));
  validateProject(candidate);
  return reply;
}
