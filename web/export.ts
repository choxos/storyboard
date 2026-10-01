import type { Project } from "./model";
import { drawFrame, sceneAt } from "./render";
import { decodeAudio } from "./audio";
import { download } from "./files";
import { scheduleSounds } from "../ui/sound-playback.js";

export function videoFormat(): { mime: string; extension: string } | null {
  if (
    typeof MediaRecorder === "undefined" ||
    !HTMLCanvasElement.prototype.captureStream
  )
    return null;
  for (const mime of [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ])
    if (MediaRecorder.isTypeSupported(mime))
      return { mime, extension: mime.startsWith("video/mp4") ? "mp4" : "webm" };
  return null;
}
export async function exportVideo(
  project: Project,
  audio: Blob | null,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<string> {
  const format = videoFormat();
  if (!format)
    throw new Error(
      "This browser cannot record video. Use a current desktop browser or the macOS app.",
    );
  if (
    project.width * project.height > 3840 * 2160 ||
    Math.max(project.width, project.height) > 3840
  )
    throw new Error(
      "Browser video export supports up to 3840 px per side and 4K total pixels. Choose a smaller canvas or use the macOS app for larger exports.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable.");
  const stream = canvas.captureStream(project.fps),
    chunks: Blob[] = [];
  let audioContext: AudioContext | undefined,
    source: AudioBufferSourceNode | undefined,
    fadeIn: GainNode | undefined,
    fadeOut: GainNode | undefined,
    recorder: MediaRecorder | undefined;
  let destination: MediaStreamAudioDestinationNode | undefined,
    stopSounds: (() => void) | undefined,
    started = false;
  const visible = () => {
    if (document.hidden)
      throw new Error(
        "Export stopped because the tab was hidden. Keep this tab visible while recording.",
      );
    signal.throwIfAborted();
  };
  try {
    if (audio || project.scenes.some((d) => d.scene.sounds?.length)) {
      audioContext = new AudioContext();
      // Decode at the output rate; the 22050 Hz analysis rate would muffle the export.
      const buffer = audio
        ? await decodeAudio(audio, audioContext.sampleRate)
        : null;
      signal.throwIfAborted();
      await audioContext.resume();
      destination = audioContext.createMediaStreamDestination();
      if (buffer) {
        source = audioContext.createBufferSource();
        source.buffer = buffer;
        fadeIn = audioContext.createGain();
        fadeOut = audioContext.createGain();
        source.connect(fadeIn).connect(fadeOut).connect(destination);
      }
      for (const track of destination.stream.getAudioTracks())
        stream.addTrack(track);
    }
    const total = project.scenes.reduce((n, d) => n + d.scene.duration_ms, 0);
    const [first] = sceneAt(project, 0);
    await drawFrame(
      ctx,
      first,
      0,
      project.width,
      project.height,
      false,
      project.images,
    );
    visible();
    recorder = new MediaRecorder(stream, {
      mimeType: format.mime,
      videoBitsPerSecond: Math.min(
        40000000,
        Math.max(3000000, project.width * project.height * project.fps * 0.12),
      ),
    });
    let recordingError: Error | null = null;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder!.onstop = () => resolve();
      recorder!.onerror = () => {
        recordingError = new Error(
          "Browser video encoding failed. Try a smaller canvas.",
        );
        resolve();
      };
    });
    recorder.start(1000);
    const audioStart = audioContext?.currentTime ?? 0;
    if (audioContext && destination)
      stopSounds = scheduleSounds(audioContext, destination, project, {
        from: 0,
        to: total,
        at: audioStart,
      });
    if (source && audioContext && fadeIn && fadeOut && project.audio) {
      const start = audioStart,
        mix = project.audio.mix;
      const end =
        Math.min(
          total,
          project.audio.duration_ms - (project.audio.start_ms || 0),
        ) / 1000;
      const volume = mix?.muted ? 0 : (mix?.volume ?? 1);
      const fadeInTime = Math.min((mix?.fade_in_ms ?? 0) / 1000, end);
      const fadeOutTime = Math.min((mix?.fade_out_ms ?? 0) / 1000, end);
      fadeIn.gain.setValueAtTime(fadeInTime ? 0 : volume, start);
      if (fadeInTime)
        fadeIn.gain.linearRampToValueAtTime(volume, start + fadeInTime);
      fadeOut.gain.setValueAtTime(1, start);
      if (fadeOutTime) {
        fadeOut.gain.setValueAtTime(1, start + end - fadeOutTime);
        fadeOut.gain.linearRampToValueAtTime(0, start + end);
      }
      source.start(start, (project.audio.start_ms || 0) / 1000);
      started = true;
    }
    const start = performance.now();
    try {
      while (true) {
        visible();
        if (recordingError) throw recordingError;
        const tick = performance.now();
        const elapsed = audioContext
          ? (audioContext.currentTime - audioStart) * 1000
          : tick - start;
        if (elapsed >= total) break;
        const [scene, local] = sceneAt(project, elapsed);
        await drawFrame(
          ctx,
          scene,
          local,
          project.width,
          project.height,
          false,
          project.images,
        );
        progress(elapsed / total);
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.max(0, 1000 / project.fps - (performance.now() - tick)),
          ),
        );
      }
    } finally {
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
    }
    visible();
    if (recordingError) throw recordingError;
    const blob = new Blob(chunks, { type: format.mime });
    if (!blob.size) throw new Error("Browser returned an empty video.");
    progress(1);
    return download(
      blob,
      `${project.name || "Storyboard"}.${format.extension}`,
    );
  } finally {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    // stop() throws on a source that never started, hiding the real error.
    if (started) source?.stop();
    stopSounds?.();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext?.close();
  }
}
