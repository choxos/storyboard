import { test } from "bun:test";
import assert from "node:assert/strict";
import { canvasSizes, resizeCanvas } from "../ui/canvas.js";

test("all presets fit the encoder limits; resize preserves timing and scales history", () => {
  const sizes = Object.values(canvasSizes).flat();
  assert.ok(sizes.length >= 40);
  for (const [, width, height] of sizes) {
    assert.ok(width >= 64 && height >= 64 && width <= 8192 && height <= 8192);
    assert.equal((width % 2) + (height % 2), 0);
    assert.ok(width * height <= 8192 * 4320);
  }
  const scene = {
    elements: [
      {
        kind: "path",
        x: 50,
        y: 30,
        width: 20,
        height: 10,
        font_size: 12,
        radius: 4,
        stroke_width: 2,
        scale_x: 1,
        scale_y: 1,
        tracks: [
          { property: "x", keyframes: [{ time_ms: 750, value: 80 }] },
          { property: "scale_y", keyframes: [{ time_ms: 1000, value: 2 }] },
        ],
      },
    ],
  };
  const project = {
    width: 100,
    height: 100,
    scenes: [{ scene, revisions: [{ scene: structuredClone(scene) }] }],
  };
  resizeCanvas(project, 200, 400);
  for (const s of [
    project.scenes[0].scene,
    project.scenes[0].revisions[0].scene,
  ]) {
    const e = s.elements[0];
    assert.deepEqual(
      [e.x, e.y, e.scale_x, e.scale_y, e.stroke_width],
      [100, 120, 2, 4, 2],
    );
    assert.deepEqual(e.tracks[0].keyframes[0], { time_ms: 750, value: 160 });
    assert.deepEqual(e.tracks[1].keyframes[0], { time_ms: 1000, value: 8 });
  }
  assert.deepEqual([project.width, project.height], [200, 400]);
});
