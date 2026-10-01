import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProject, validateProject } from "../web/model";
import {
  makeSound,
  readSound,
  soundPresets,
  synthSound,
} from "../ui/sound-data.js";
import { cuePlacements, scheduleSounds } from "../ui/sound-playback.js";

test("portable effects validate, follow scene order, and schedule trimmed pitched tails", () => {
  const project = parseProject(
    readFileSync(new URL("../web/demo.storyboard", import.meta.url), "utf8"),
  );
  project.sounds = Object.keys(soundPresets).map(synthSound);
  for (const sound of project.sounds)
    expect(readSound(sound.data).duration_ms).toBe(sound.duration_ms);
  // 12012 frames is 500.5 ms; the native validator rounds it up to 501.
  expect(makeSound("half", [new Float32Array(12012)]).duration_ms).toBe(501);
  const sound = project.sounds.find((s) => s.name === "Riser")!;
  project.scenes[0].scene.sounds = [
    {
      id: "cue",
      sound_id: sound.id,
      at_ms: 3900,
      trim_start_ms: 200,
      duration_ms: 700,
      volume: 0.4,
      pitch: 12,
    },
  ];
  const restored = parseProject(JSON.stringify(project));
  expect(cuePlacements(restored)[0]).toMatchObject({
    start: 3900,
    duration: 500,
    speed: 2,
  });
  const starts: number[][] = [],
    stops: number[] = [],
    rates: number[] = [];
  const context = {
    createBuffer: (_channels: number, frames: number) => ({
      getChannelData: () => new Float32Array(frames),
    }),
    createGain: () => ({
      gain: { value: 0 },
      connect: () => {},
      disconnect: () => {},
    }),
    createBufferSource: () => {
      const rate = { value: 1 };
      return {
        buffer: null,
        playbackRate: rate,
        connect: (gain: object) => gain,
        disconnect: () => {},
        start: (...args: number[]) => {
          starts.push(args);
          rates.push(rate.value);
        },
        stop: (at: number) => stops.push(at),
      };
    },
  };
  scheduleSounds(context, {}, restored, { from: 4100, to: 8000, at: 10 });
  expect(starts).toEqual([[10, 0.6]]);
  expect(stops).toEqual([10.3]);
  expect(rates).toEqual([2]);
  restored.scenes.reverse();
  expect(cuePlacements(restored)[0].start).toBe(15900);
  for (const patch of [
    { pitch: 13 },
    { volume: -1 },
    { at_ms: 4000 },
    { trim_start_ms: 1200 },
    { sound_id: "missing" },
  ]) {
    const bad = structuredClone(project);
    Object.assign(bad.scenes[0].scene.sounds![0], patch);
    expect(() => validateProject(bad)).toThrow();
  }
  expect(() =>
    readSound(sound.data.replace("audio/wav", "audio/mpeg")),
  ).toThrow();
  expect(() =>
    validateProject({ ...project, sounds: [{ ...sound, duration_ms: 9000 }] }),
  ).toThrow();
});
