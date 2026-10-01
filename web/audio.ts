import type { AudioTrack } from "./model";

export function analyzeSamples(
  samples: Float32Array,
  sampleRate: number,
): AudioTrack {
  const hop = Math.max(1, Math.floor(sampleRate / 100)),
    energy: number[] = [];
  for (let i = 0; i < samples.length; i += hop) {
    let sum = 0;
    const end = Math.min(i + hop, samples.length);
    for (let j = i; j < end; j++) sum += samples[j] ** 2;
    energy.push(Math.sqrt(sum / (end - i)));
  }
  const onset = energy.map((v, i) =>
      Math.max(0, v - energy[Math.max(0, i - 1)]),
    ),
    hz = sampleRate / hop;
  let bestLag = 0,
    bestScore = 0;
  for (
    let lag = Math.floor((hz * 60) / 200);
    lag <= Math.floor((hz * 60) / 60);
    lag++
  ) {
    let score = 0;
    for (let i = lag; i < onset.length; i++) score += onset[i] * onset[i - lag];
    if (score > bestScore) {
      bestLag = lag;
      bestScore = score;
    }
  }
  const bpm = bestLag ? (60 * hz) / bestLag : 120,
    period = Math.max(1, Math.round((hz * 60) / bpm));
  let phase = 0,
    score = -1;
  for (let offset = 0; offset < period; offset++) {
    let sum = 0;
    for (let i = offset; i < onset.length; i += period) sum += onset[i];
    if (sum >= score) {
      phase = offset;
      score = sum;
    }
  }
  let barPhase = 0;
  score = -1;
  for (let offset = 0; offset < 4; offset++) {
    let sum = 0;
    for (let i = phase + offset * period; i < energy.length; i += period * 4)
      sum += energy[i];
    if (sum >= score) {
      barPhase = offset;
      score = sum;
    }
  }
  const duration_ms = Math.round((samples.length / sampleRate) * 1000),
    sections = [0];
  let previous = 0;
  for (let bar = 0; bar < Math.floor(duration_ms / (240000 / bpm)); bar++) {
    const start = Math.min(
        energy.length,
        phase + barPhase * period + bar * 4 * period,
      ),
      end = Math.min(start + 4 * period, energy.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += energy[i];
    const average = sum / Math.max(1, end - start),
      marker = Math.round((start / hz) * 1000);
    if (
      bar &&
      previous > 0.0001 &&
      (average / previous > 1.8 || average / previous < 0.5) &&
      marker - sections[sections.length - 1] > 2000
    )
      sections.push(marker);
    previous = average;
  }
  const peaks = [],
    chunk = Math.ceil(samples.length / 1600);
  for (let i = 0; i < samples.length; i += chunk) {
    let peak = 0;
    for (let j = i; j < Math.min(samples.length, i + chunk); j++)
      peak = Math.max(peak, Math.abs(samples[j]));
    peaks.push(Math.min(1, peak));
  }
  const total = onset.reduce((n, v) => n + v * v, 0);
  return {
    path: "",
    name: "",
    duration_ms,
    peaks,
    bpm,
    offset_ms: ((phase + barPhase * period) / hz) * 1000,
    beats_per_bar: 4,
    sections,
    confidence: total ? Math.min(1, bestScore / total) : 0,
  };
}
export async function decodeAudio(
  blob: Blob,
  sampleRate = 22050,
): Promise<AudioBuffer> {
  if (blob.size > 100000000)
    throw new Error("Audio imports are limited to 100 MB in the browser.");
  const context = new AudioContext({ sampleRate });
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (buffer.duration < 0.5 || buffer.duration > 600)
      throw new Error("Audio must last between 0.5 seconds and 10 minutes.");
    return buffer;
  } finally {
    await context.close();
  }
}
export async function analyzeAudio(blob: Blob): Promise<AudioTrack> {
  const buffer = await decodeAudio(blob),
    samples = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < samples.length; i++)
      samples[i] += data[i] / buffer.numberOfChannels;
  }
  return analyzeSamples(samples, buffer.sampleRate);
}
