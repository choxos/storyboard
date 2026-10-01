export const soundPresets = {
  click: "Click",
  pop: "Pop",
  ding: "Ding",
  whoosh: "Whoosh",
  impact: "Impact",
  riser: "Riser",
};
const rate = 24000;

export function readSound(data) {
  if (
    typeof data !== "string" ||
    data.length > 2000000 ||
    !/^data:audio\/wav;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new Error(
      "Sound effects must be embedded WAV clips up to 15 seconds.",
    );
  const bytes = Uint8Array.from(atob(data.slice(22)), (c) => c.charCodeAt(0));
  if (bytes.length < 44) throw new Error("Invalid sound data.");
  const view = new DataView(bytes.buffer);
  const text = (start, length) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  const channels = view.getUint16(22, true),
    frames = (bytes.length - 44) / (channels * 2);
  if (
    text(0, 4) !== "RIFF" ||
    text(8, 8) !== "WAVEfmt " ||
    text(36, 4) !== "data" ||
    view.getUint32(4, true) !== bytes.length - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    ![1, 2].includes(channels) ||
    view.getUint32(24, true) !== rate ||
    view.getUint32(28, true) !== rate * channels * 2 ||
    view.getUint16(32, true) !== channels * 2 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== bytes.length - 44 ||
    !Number.isInteger(frames) ||
    frames < 24 ||
    frames > rate * 15
  )
    throw new Error(
      "Use a valid 24 kHz PCM sound effect, at most 15 seconds long.",
    );
  return {
    bytes,
    view,
    channels,
    frames,
    duration_ms: Math.round((frames / rate) * 1000),
  };
}

export function makeSound(name, channels) {
  const frames = channels[0].length,
    count = channels.length;
  const bytes = new Uint8Array(44 + frames * count * 2),
    view = new DataView(bytes.buffer);
  const text = (offset, value) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < frames; i++)
    for (let channel = 0; channel < count; channel++)
      view.setInt16(
        44 + (i * count + channel) * 2,
        Math.round(Math.max(-1, Math.min(1, channels[channel][i])) * 32767),
        true,
      );
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16384)
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  const data = `data:audio/wav;base64,${btoa(binary)}`;
  const { duration_ms } = readSound(data);
  return { id: crypto.randomUUID(), name, data, duration_ms };
}

export async function importSound(file) {
  if (file.size > 20000000)
    throw new Error("Sound imports are limited to 20 MB.");
  const context = new AudioContext({ sampleRate: rate });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration < 0.001 || buffer.duration > 15)
      throw new Error(
        "Choose a sound effect between 1 ms and 15 seconds long.",
      );
    return makeSound(
      file.name,
      Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) =>
        buffer.getChannelData(i),
      ),
    );
  } finally {
    await context.close();
  }
}

export function synthSound(preset) {
  if (!Object.hasOwn(soundPresets, preset))
    throw new Error("Choose a sound preset.");
  const length = {
    click: 0.08,
    pop: 0.18,
    ding: 0.8,
    whoosh: 0.6,
    impact: 0.5,
    riser: 1.2,
  }[preset];
  const samples = new Float32Array(Math.round(length * rate));
  let seed = 1234567,
    filtered = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate,
      p = t / length;
    seed = (1664525 * seed + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    filtered += (noise - filtered) * 0.12;
    let value;
    switch (preset) {
      case "click":
        value =
          (noise * 0.6 + Math.sin(2 * Math.PI * 1800 * t) * 0.4) *
          Math.exp(-t * 100);
        break;
      case "pop":
        value =
          Math.sin(2 * Math.PI * (600 * t - 1000 * t * t)) * Math.exp(-t * 25);
        break;
      case "ding":
        value =
          (Math.sin(2 * Math.PI * 880 * t) +
            0.3 * Math.sin(2 * Math.PI * 1760 * t)) *
          Math.exp(-t * 5);
        break;
      case "whoosh":
        value = filtered * 4 * Math.sin(Math.PI * p) ** 2;
        break;
      case "impact":
        value =
          (Math.sin(2 * Math.PI * 65 * t) * 0.7 + filtered * 0.8) *
          Math.exp(-t * 14);
        break;
      case "riser":
        value =
          (filtered * 2 +
            Math.sin(2 * Math.PI * (180 * t + 500 * t * t)) * 0.2) *
          p;
        break;
    }
    samples[i] = value * 0.55 * Math.min(1, t / 0.003, (length - t) / 0.015);
  }
  return makeSound(soundPresets[preset], [samples]);
}
