export function moveElement(element, dx, dy) {
  element.x += dx;
  element.y += dy;
  for (const track of element.tracks) {
    const delta = track.property === "x" ? dx : track.property === "y" ? dy : 0;
    if (delta) for (const key of track.keyframes) key.value += delta;
  }
}

export function alignmentDelta(bounds, width, height, alignment) {
  const marginX = width * 0.05,
    marginY = height * 0.05;
  const horizontal = {
    left: marginX - bounds.x,
    right: width - marginX - bounds.x - bounds.width,
    horizontal: (width - bounds.width) / 2 - bounds.x,
    center: (width - bounds.width) / 2 - bounds.x,
  };
  const vertical = {
    top: marginY - bounds.y,
    bottom: height - marginY - bounds.y - bounds.height,
    vertical: (height - bounds.height) / 2 - bounds.y,
    center: (height - bounds.height) / 2 - bounds.y,
  };
  return [horizontal[alignment] || 0, vertical[alignment] || 0];
}

export const motionPresets = {
  "fade-in": "Fade in",
  "slide-up": "Slide up",
  "drop-in": "Drop in",
  "slide-from-left": "Slide in from left",
  "slide-from-right": "Slide in from right",
  "pop-in": "Pop in",
  "fade-out": "Fade out",
};

export function applyMotionPreset(element, preset, duration, distance) {
  if (!Object.hasOwn(motionPresets, preset))
    throw new Error("Unknown motion preset.");
  const length = Math.min(600, duration);
  const [start, end] =
    preset === "fade-out" ? [duration - length, duration] : [0, length];
  const tracks = [];
  const track = (property, from, to) => {
    // Keys outside the preset window survive, so an entrance and an exit can share a track.
    const kept =
      element.tracks
        .find((t) => t.property === property)
        ?.keyframes.filter((k) => k.time_ms < start || k.time_ms > end) ?? [];
    tracks.push({
      property,
      keyframes: [
        { time_ms: start, value: from, easing: "linear" },
        { time_ms: end, value: to, easing: "ease_out" },
        ...kept,
      ].sort((a, b) => a.time_ms - b.time_ms),
    });
  };
  if (preset === "fade-out") track("opacity", element.opacity, 0);
  else track("opacity", 0, element.opacity);
  if (preset === "slide-up") track("y", element.y + distance, element.y);
  if (preset === "drop-in") track("y", element.y - distance, element.y);
  if (preset === "slide-from-left")
    track("x", element.x - distance, element.x);
  if (preset === "slide-from-right")
    track("x", element.x + distance, element.x);
  if (preset === "pop-in") {
    track("scale_x", element.scale_x * 0.75, element.scale_x);
    track("scale_y", element.scale_y * 0.75, element.scale_y);
  }
  element.tracks = element.tracks
    .filter((t) => !tracks.some((next) => next.property === t.property))
    .concat(tracks);
}
