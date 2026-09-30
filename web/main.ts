import {
  parseProject,
  validateProject,
  validateScene,
  validateCanvas,
  type Project,
} from "./model";
import { svg, checkSeams, frameImage } from "./render";
import { analyzeAudio } from "./audio";
import { stored, storeFile, download, pickFile } from "./files";
import { exportVideo, videoFormat } from "./export";
import { assistant } from "./assistant";

const audioURLs = new Map<string, string>(),
  dropped = new Map<string, File>();
const progressListeners = new Set<(event: { payload: number }) => void>();
let controller = new AbortController();
const demo = async () =>
  parseProject(
    await (await fetch(new URL("./demo.storyboard", location.href))).text(),
  );
async function audioBlob(project: Project): Promise<Blob | null> {
  if (!project.audio || !project.audio.path.startsWith("browser-audio:"))
    return null;
  const blob = await stored(project.audio.path);
  return blob instanceof Blob ? blob : null;
}
async function prepareAudio(project: Project): Promise<string | null> {
  if (!project.audio) return null;
  const blob = await audioBlob(project);
  if (blob) {
    if (!audioURLs.has(project.audio.path))
      audioURLs.set(project.audio.path, URL.createObjectURL(blob));
    return null;
  }
  return `Soundtrack "${project.audio.name}" needs to be relinked with Replace. Audio is not embedded in project downloads.`;
}
async function selectedFile(
  path: unknown,
  accept: string,
): Promise<File | null> {
  if (typeof path === "string" && dropped.has(path)) {
    const file = dropped.get(path)!;
    dropped.delete(path);
    return file;
  }
  return pickFile(accept);
}
async function invoke(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (name === "bootstrap") {
    let project = await demo(),
      recovered = false,
      warning: string | null = null;
    try {
      const saved = await stored("recovery");
      if (saved !== undefined) {
        validateProject(saved);
        project = saved;
        recovered = true;
      }
    } catch (error) {
      warning = `Browser recovery unavailable: ${error}. Download projects to keep a copy.`;
    }
    warning ||= await prepareAudio(project);
    return {
      project,
      recovered,
      warning,
      providers: {},
      ffmpeg: Boolean(videoFormat()),
    };
  }
  if (name === "demo") return demo();
  if (name === "cancel_job") {
    controller.abort(new Error("Canceled. No video was downloaded."));
    return;
  }
  if (name === "cancel_model_discovery") return;
  if (name === "render_frame" || name === "export_frame") {
    validateScene(args.scene);
    const width = Number(args.width),
      height = Number(args.height),
      time = Number(args.timeMs);
    validateCanvas(width, height);
    if (!Number.isFinite(time)) throw new Error("Invalid frame time.");
    if (name === "render_frame") return svg(args.scene, time, width, height);
    if (args.format !== "png" && args.format !== "svg")
      throw new Error("Choose PNG or SVG.");
    const blob =
      args.format === "svg"
        ? new Blob([svg(args.scene, time, width, height)], {
            type: "image/svg+xml",
          })
        : await frameImage(args.scene, time, width, height);
    return download(
      blob,
      `${args.scene.name || "Frame"}-${Math.round(time)}ms.${args.format}`,
    );
  }
  if (name === "open_project") {
    const file = await selectedFile(args.path, ".storyboard,.json");
    if (!file) return null;
    if (file.size > 20000000)
      throw new Error("Project files are limited to 20 MB.");
    const project = parseProject(await file.text());
    return { project, path: file.name, warning: await prepareAudio(project) };
  }
  if (name === "import_audio") {
    controller = new AbortController();
    const signal = controller.signal;
    const file = await selectedFile(
      args.path,
      "audio/*,.wav,.mp3,.m4a,.aac,.flac,.aiff",
    );
    if (!file) return null;
    const audio = await analyzeAudio(file);
    signal.throwIfAborted();
    audio.path = `browser-audio:${crypto.randomUUID()}`;
    audio.name = file.name;
    await storeFile(audio.path, file);
    audioURLs.set(audio.path, URL.createObjectURL(file));
    return audio;
  }
  validateProject(args.project);
  const project = args.project;
  switch (name) {
    case "validate_project":
      return;
    case "save_recovery":
      return storeFile("recovery", project);
    case "save_project": {
      const copy = structuredClone(project);
      if (copy.audio) copy.audio.path = copy.audio.name;
      const text = JSON.stringify(copy, null, 2);
      parseProject(text);
      return download(
        new Blob([text], { type: "application/json" }),
        `${project.name || "Untitled"}.storyboard`,
      );
    }
    case "check_seams":
      return checkSeams(project);
    case "generate": {
      controller = new AbortController();
      const index = args.sceneIndex === null ? null : Number(args.sceneIndex);
      if (
        index !== null &&
        (!Number.isInteger(index) || !project.scenes[index])
      )
        throw new Error("Scene no longer exists.");
      return assistant(
        project,
        index,
        String(args.prompt),
        String(args.provider),
        controller.signal,
      );
    }
    case "export_video": {
      controller = new AbortController();
      const signal = controller.signal,
        blob = await audioBlob(project);
      if (project.audio && !blob)
        throw new Error(
          "Relink your soundtrack with Replace before exporting, or remove it.",
        );
      return exportVideo(project, blob, signal, (payload) =>
        progressListeners.forEach((callback) => callback({ payload })),
      );
    }
    default:
      throw new Error(`Unsupported browser command: ${name}`);
  }
}
const platform = {
  browser: true,
  videoLabel: videoFormat()?.extension.toUpperCase() || "video",
  core: { invoke, convertFileSrc: (path: string) => audioURLs.get(path) || "" },
  event: {
    listen: async (
      _name: string,
      callback: (event: { payload: number }) => void,
    ) => {
      progressListeners.add(callback);
      return () => progressListeners.delete(callback);
    },
  },
  webview: {
    getCurrentWebview: () => ({
      onDragDropEvent: async (
        callback: (event: {
          payload: { type: string; paths: string[] };
        }) => void,
      ) => {
        document.addEventListener("dragover", (event) => {
          if (event.dataTransfer?.types.includes("Files")) {
            event.preventDefault();
            callback({ payload: { type: "over", paths: [] } });
          }
        });
        document.addEventListener("dragleave", (event) => {
          if (!event.relatedTarget)
            callback({ payload: { type: "leave", paths: [] } });
        });
        document.addEventListener("drop", (event) => {
          const file = event.dataTransfer?.files[0];
          if (!file) return;
          event.preventDefault();
          dropped.set(file.name, file);
          callback({ payload: { type: "drop", paths: [file.name] } });
        });
      },
    }),
  },
  window: {
    getCurrentWindow: () => ({
      setFullscreen: async (enabled: boolean) => {
        if (enabled && document.documentElement.requestFullscreen)
          await document.documentElement.requestFullscreen();
        else if (!enabled && document.fullscreenElement)
          await document.exitFullscreen();
      },
    }),
  },
};
declare global {
  interface Window {
    storyboardWeb: typeof platform;
  }
}
window.storyboardWeb = platform;
await import("../ui/app.js");
