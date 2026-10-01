import { readSound } from "./sound-data.js";

export function cuePlacements(project) {
  const placements = [];
  let start = 0;
  for (const { scene } of project.scenes) {
    for (const cue of scene.sounds || []) {
      const sound = (project.sounds || []).find((a) => a.id === cue.sound_id);
      if (!sound) throw new Error("A sound cue references a missing clip.");
      const speed = 2 ** (cue.pitch / 12);
      placements.push({
        cue,
        sound,
        start: start + cue.at_ms,
        duration: Math.min(
          cue.duration_ms,
          (sound.duration_ms - cue.trim_start_ms) / speed,
        ),
        speed,
      });
    }
    start += scene.duration_ms;
  }
  return placements;
}

export function scheduleSounds(context, destination, project, window) {
  const buffers = new Map(),
    nodes = [];
  for (const place of cuePlacements(project)) {
    const { cue, sound, speed } = place;
    const start = Math.max(window.from, place.start),
      end = Math.min(window.to, place.start + place.duration);
    if (end <= start || cue.volume === 0) continue;
    let buffer = buffers.get(sound.id);
    if (!buffer) {
      const decoded = readSound(sound.data);
      buffer = context.createBuffer(decoded.channels, decoded.frames, 24000);
      for (let channel = 0; channel < decoded.channels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < decoded.frames; i++)
          samples[i] =
            decoded.view.getInt16(
              44 + (i * decoded.channels + channel) * 2,
              true,
            ) / 32768;
      }
      buffers.set(sound.id, buffer);
    }
    const source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = speed;
    gain.gain.value = cue.volume;
    source.connect(gain).connect(destination);
    source.start(
      window.at + (start - window.from) / 1000,
      (cue.trim_start_ms + (start - place.start) * speed) / 1000,
    );
    source.stop(window.at + (end - window.from) / 1000);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    nodes.push(source);
  }
  return () => nodes.forEach((node) => node.stop());
}

let context,
  stop,
  generation = 0;
export function stopSounds() {
  generation++;
  stop?.();
  stop = undefined;
}
export async function playSounds(project, from, to) {
  stopSounds();
  if (!project.scenes.some((d) => d.scene.sounds?.length)) return;
  context ||= new AudioContext();
  const current = generation;
  await context.resume();
  if (current !== generation) return;
  stop = scheduleSounds(context, context.destination, project, {
    from,
    to,
    at: context.currentTime,
  });
}

export async function previewSound(sound) {
  const project = {
    sounds: [sound],
    scenes: [
      {
        scene: {
          duration_ms: sound.duration_ms,
          sounds: [
            {
              sound_id: sound.id,
              at_ms: 0,
              volume: 0.5,
              pitch: 0,
              trim_start_ms: 0,
              duration_ms: sound.duration_ms,
            },
          ],
        },
      },
    ],
  };
  await playSounds(project, 0, sound.duration_ms);
}
