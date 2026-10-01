import { canvasSizes, resizeCanvas } from "./canvas.js";
import {
  moveElement,
  motionPresets,
  applyMotionPreset,
  alignmentDelta,
} from "./editing.js";
import { sceneTemplates, createTemplate, createElement } from "./templates.js";
import { audioGain } from "./audio-mix.js";
import { fontFamilies, importImage } from "./media.js";
import { soundPresets, synthSound, importSound } from "./sound-data.js";
import {
  playSounds,
  stopSounds,
  previewSound,
  cuePlacements,
} from "./sound-playback.js";

const api = window.__TAURI__ || window.storyboardWeb;
const browser = !!api?.browser;
const invoke = (name, args = {}) =>
  api.core.invoke(
    name,
    ["render_frame", "export_frame"].includes(name)
      ? { images: s.project?.images || [], ...args }
      : args,
  );
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clone = (value) => structuredClone(value);
const icons = {
  film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 4l3 5m3-5 3 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14m8-14v14" stroke-width="4"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h10a6 6 0 0 1 0 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  music:
    '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  sliders:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="white"/><circle cx="15" cy="17" r="3" fill="white"/>',
  spark:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  save: '<path d="M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',
  folder: '<path d="M3 6h7l2 3h9v11H3zM3 6V4h7l2 2h7v3"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  palette:
    '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r="1"/><circle cx="14" cy="7" r="1"/><circle cx="17" cy="12" r="1"/><path d="M12 21c-4-4 4-5 0-8"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
const s = {
  project: null,
  selected: 0,
  time: 0,
  mode: "scene",
  scope: "scene",
  tab: "scenes",
  playing: false,
  started: 0,
  startTime: 0,
  busy: false,
  reviewFrames: true,
  dirty: false,
  path: null,
  undo: [],
  redo: [],
  revision: 0,
  frameRequest: 0,
  thumbRequest: 0,
  snap: false,
  presenting: false,
  recovered: false,
  provider: localStorage.getItem("provider") || "claude",
  models: JSON.parse(localStorage.getItem("models") || "{}"),
  efforts: JSON.parse(localStorage.getItem("efforts") || "{}"),
  catalogs: {},
  modelRequests: {},
  persist: Promise.resolve(),
  persistTimer: 0,
  layer: null,
  layerScene: null,
  drag: null,
};
const audio = new Audio();
s.drafts = {};
s.playToken = 0;
s.jobPromise = Promise.resolve();
function job(name, args) {
  s.jobPromise = invoke(name, args);
  return s.jobPromise;
}
let toastTimer;
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = String(message);
  el.className = `visible${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), error ? 12000 : 4500);
}
const doc = () => s.project.scenes[s.selected];
const duration = () =>
  s.project.scenes.reduce((n, d) => n + d.scene.duration_ms, 0);
const sceneStart = (index = s.selected) =>
  s.project.scenes.slice(0, index).reduce((n, d) => n + d.scene.duration_ms, 0);
const limit = () => (s.mode === "scene" ? doc().scene.duration_ms : duration());
const globalTime = () => (s.mode === "scene" ? sceneStart() + s.time : s.time);
const seconds = (ms) => `${(ms / 1000).toFixed(2)}s`;
const uid = () => crypto.randomUUID();

function shell() {
  $("#app").innerHTML = `
    <header class="topbar"><div class="brand"><span class="brand-mark">${icon("film")}</span>Storyboard</div>
      <button id="project-title" class="project-name" data-action="project-settings"></button>
      <button data-action="new">${icon("plus")}New project</button>
      <button class="icon" data-action="open" title="Open project (Command+O)" aria-label="Open project">${icon("folder")}</button>
      <button class="icon" data-action="save" title="Save project (Command+S)" aria-label="Save project">${icon("save")}</button>
      <nav class="segment" aria-label="Workspace"><button data-tab="scenes">Scenes</button><button data-tab="render">Render</button></nav>
      <span class="spacer"></span><button id="canvas-settings" data-action="canvas-settings" aria-label="Canvas size"></button><button data-action="project-settings">${icon("palette")}Art direction</button>
      <button class="copy-path" data-action="copy-path">${icon("copy")}Copy path</button><button class="primary" data-action="present">${icon("expand")}Present</button>
    </header>
    <main class="workspace"><section class="preview-pane" aria-label="Video preview"><div class="meta" id="scene-meta"></div>
      <div class="canvas-tools" id="canvas-tools" aria-label="Canvas editing tools"></div>
      <div class="canvas-well"><div class="canvas" id="canvas" tabindex="0" role="group" aria-label="Scene preview" aria-describedby="canvas-hint"></div></div>
      <div class="transport"><div class="segment dark" aria-label="Playback scope"><button data-mode="scene">This scene</button><button data-mode="project">Whole video</button></div>
        <button class="play" data-action="play" aria-label="Play" title="Play or pause (Space)">${icon("play")}</button>
        <div class="timecode"><input id="time-ms" type="number" min="0" step="1" aria-label="Playhead in milliseconds" title="Exact playhead position in milliseconds"><span class="muted">ms / <span id="total-time"></span></span></div>
        <div class="scrubber"><input id="scrub" type="range" min="0" step="1" value="0" aria-label="Scrub timeline"><div class="ticks" id="ticks"></div></div>
        <button class="quiet icon hidden" id="exit-present" data-action="present" aria-label="Exit presentation" title="Exit presentation (Escape)">${icon("close")}</button>
      </div><div class="audio-lane" id="audio-lane"></div>
    </section><aside class="sidebar" id="sidebar" aria-label="Scene editor"></aside></main>
    <section class="filmstrip" id="filmstrip" aria-label="Scenes"></section>
    <footer class="statusbar"><span id="save-state"></span><span id="project-stats"></span><span class="spacer"></span><span id="job-status"></span><button class="quiet" data-action="shortcuts">Keyboard shortcuts</button></footer>`;
  new ResizeObserver(fitCanvas).observe($(".canvas-well"));
  if (browser)
    $(".brand").insertAdjacentHTML(
      "beforeend",
      '<small class="muted">Web</small>',
    );
  $("#scrub").addEventListener("input", (e) =>
    seek(Number(e.target.value), s.snap),
  );
  $("#time-ms").addEventListener("change", (e) => seek(Number(e.target.value)));
  $("#canvas").addEventListener("dblclick", (e) => {
    const id = e.target.closest("[data-element]")?.dataset.element || s.layer;
    if (
      doc().scene.elements.find((element) => element.id === id)?.kind === "text"
    )
      editText(id);
    else openInspector(id);
  });
  $("#canvas").addEventListener("pointerdown", beginDrag);
  $("#canvas").addEventListener("pointermove", dragLayer);
  $("#canvas").addEventListener("pointerup", () => finishDrag(true));
  $("#canvas").addEventListener("pointercancel", () => finishDrag(false));
  $("#canvas").addEventListener("lostpointercapture", () => finishDrag(false));
  document.addEventListener("click", click);
  document.addEventListener("keydown", keys);
  document.addEventListener("change", change);
  $("#filmstrip").addEventListener("dragstart", (e) => {
    const card = e.target.closest("[data-scene]");
    if (card) {
      e.dataTransfer.setData("text/storyboard-scene", card.dataset.scene);
      e.dataTransfer.effectAllowed = "move";
    }
  });
  $("#filmstrip").addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("text/storyboard-scene"))
      e.preventDefault();
  });
  $("#filmstrip").addEventListener("drop", (e) => {
    const from = e.dataTransfer.getData("text/storyboard-scene");
    const card = e.target.closest("[data-scene]");
    if (from !== "" && card) {
      e.preventDefault();
      reorder(Number(from), Number(card.dataset.scene));
    }
  });
}

function fitCanvas() {
  const well = $(".canvas-well");
  if (!well || !s.project) return;
  const ratio = s.project.width / s.project.height;
  const width = Math.min(well.clientWidth, (well.clientHeight - 10) * ratio);
  $("#canvas").style.width = `${Math.max(1, width)}px`;
  $("#canvas").style.aspectRatio = String(ratio);
  drawSelection();
}
function refresh() {
  s.selected = Math.min(s.selected, s.project.scenes.length - 1);
  s.time = Math.min(s.time, limit());
  $("#project-title").innerHTML =
    `${esc(s.project.name)}${s.dirty ? ' <span aria-label="Unsaved changes">*</span>' : ""}${icon("chevron")}`;
  document.title = `${s.project.name}${s.dirty ? " *" : ""} · Storyboard`;
  $("#canvas-settings").innerHTML =
    `Canvas <span class="canvas-dimensions">${s.project.width} × ${s.project.height}</span>`;
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === s.tab));
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) => b.classList.toggle("active", b.dataset.mode === s.mode));
  sidebar();
  layerTools();
  filmstrip();
  audioLane();
  transport();
  status();
  fitCanvas();
  requestFrame();
}
function status() {
  $("#save-state").innerHTML =
    `<span class="dot"></span>${s.dirty ? "Unsaved changes" : s.path ? "Saved" : s.recovered ? "Recovered session" : "Example project"}`;
  $("#project-stats").textContent =
    `${s.project.scenes.length} scenes · ${seconds(duration())} · ${s.project.width} × ${s.project.height} · ${s.project.fps} fps`;
  $("#job-status").innerHTML = s.busy
    ? '<span class="busy-indicator"></span>Working locally'
    : "";
}
function transport() {
  audio.volume = audioGain(s.project.audio, globalTime(), duration());
  audio.muted = !!s.project.audio?.mix?.muted;
  $("#scene-meta").innerHTML =
    `<strong>Scene ${s.selected + 1} of ${s.project.scenes.length}</strong> · ${esc(doc().scene.name)}${s.mode === "scene" ? " · loops" : ""}`;
  const play = $('[data-action="play"]');
  play.innerHTML = icon(s.playing ? "pause" : "play");
  play.setAttribute("aria-label", s.playing ? "Pause" : "Play");
  $("#scrub").max = limit();
  $("#scrub").value = s.time;
  $("#time-ms").max = limit();
  if (document.activeElement !== $("#time-ms"))
    $("#time-ms").value = Math.round(s.time);
  $("#total-time").textContent = seconds(limit());
  $("#ticks").innerHTML = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (t) =>
        `<span>${((limit() * t) / 1000).toFixed(limit() < 5000 ? 1 : 0)}s</span>`,
    )
    .join("");
  $("#audio-playhead")?.setAttribute(
    "x1",
    String((globalTime() / duration()) * 1000),
  );
  if ($("#still-frame-time"))
    $("#still-frame-time").textContent =
      `${doc().scene.name} at ${Math.round(s.mode === "scene" ? s.time : s.time - sceneStart())} ms`;
  $("#audio-playhead")?.setAttribute(
    "x2",
    String((globalTime() / duration()) * 1000),
  );
}
async function requestFrame() {
  const request = ++s.frameRequest;
  const scene = clone(doc().scene);
  if (s.drag?.sceneId === scene.id) {
    const element = scene.elements.find((e) => e.id === s.drag.id);
    if (element) moveElement(element, s.drag.dx, s.drag.dy);
  }
  const local = s.mode === "scene" ? s.time : s.time - sceneStart();
  try {
    const svg = await invoke("render_frame", {
      scene,
      timeMs: Math.max(0, local),
      width: s.project.width,
      height: s.project.height,
    });
    if (request === s.frameRequest) {
      $("#canvas").innerHTML = svg;
      $("#canvas").setAttribute(
        "aria-label",
        `${scene.name} at ${Math.round(local)} milliseconds`,
      );
      drawSelection();
    }
  } catch (e) {
    pause();
    toast(e, true);
  }
}
function selectedElement() {
  return s.layerScene === doc().scene.id
    ? doc().scene.elements.find((e) => e.id === s.layer)
    : null;
}
function layerTools() {
  if (!selectedElement()) s.layer = null;
  $("#canvas-tools").innerHTML =
    `<label>Layer<select id="canvas-layer" aria-label="Select canvas layer"><option value="">Select a layer</option>${doc()
      .scene.elements.map(
        (e, i) =>
          `<option value="${esc(e.id)}" ${s.layer === e.id ? "selected" : ""}>${esc(e.text.slice(0, 30) || `${e.kind} ${i + 1}`)}</option>`,
      )
      .join(
        "",
      )}</select></label><button data-action="edit-selected" ${s.layer && !s.busy ? "" : "disabled"}>Edit layer</button><button class="quiet" data-action="clear-selection" ${s.layer ? "" : "disabled"}>Deselect</button><span id="canvas-hint">${s.layer ? "Drag to move · Arrows nudge · Shift: 10 px" : "Click a layer or choose one above"}</span>`;
  $("#canvas-layer").disabled = s.busy;
  $("#canvas-layer").onchange = () => {
    selectLayer($("#canvas-layer").value || null);
    $("#canvas").focus({ preventScroll: true });
  };
  const element = selectedElement();
  $("#canvas-tools").insertAdjacentHTML(
    "beforeend",
    `<button data-action="images" ${s.busy ? "disabled" : ""}>Image / logo</button>`,
  );
  if (element) {
    $('[data-action="edit-selected"]').insertAdjacentHTML(
      "beforebegin",
      `${element.kind === "text" ? '<button data-action="edit-text">Edit text</button>' : ""}<select id="align-layer" aria-label="Align selected layer"><option value="">Align to canvas</option><option value="horizontal">Center horizontally</option><option value="vertical">Center vertically</option><option value="center">Center both</option><option value="left">Left margin</option><option value="right">Right margin</option><option value="top">Top margin</option><option value="bottom">Bottom margin</option></select>`,
    );
    $("#align-layer").disabled = s.busy;
    $("#align-layer").onchange = (event) =>
      alignSelected(event.target.value).catch((error) => toast(error, true));
  }
}
async function alignSelected(alignment) {
  if (!alignment || s.busy || s.editing || s.drag) return;
  pause();
  await requestFrame();
  const node = [...$("#canvas").querySelectorAll("[data-element]")].find(
    (e) => e.dataset.element === s.layer,
  );
  if (!node) return;
  const bounds = node.getBoundingClientRect(),
    inverse = $("#canvas > svg").getScreenCTM().inverse();
  const start = new DOMPoint(bounds.left, bounds.top).matrixTransform(inverse),
    end = new DOMPoint(bounds.right, bounds.bottom).matrixTransform(inverse);
  const [dx, dy] = alignmentDelta(
    {
      x: start.x,
      y: start.y,
      width: end.x - start.x,
      height: end.y - start.y,
    },
    s.project.width,
    s.project.height,
    alignment,
  );
  await moveSelected(dx, dy);
  $("#canvas").focus({ preventScroll: true });
}

function editText(id = s.layer) {
  if (s.busy || s.editing) return;
  const element = doc().scene.elements.find((e) => e.id === id);
  if (element?.kind !== "text") return;
  selectLayer(id);
  let fill = element.fill;
  const d = modal(
    "Edit text",
    `<label>Words<textarea id="quick-text" rows="4" maxlength="10000">${esc(element.text)}</textarea></label><div class="form-row three"><label>Font size<input id="quick-size" type="number" min="1" max="1000" value="${element.font_size}" step="any"></label><label>Weight<select id="quick-weight">${[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => `<option value="${weight}" ${weight === element.font_weight ? "selected" : ""}>${weight === 400 ? "Regular" : weight === 700 ? "Bold" : weight}</option>`).join("")}</select></label><label>Text color<input id="quick-color" type="color" value="${fill === "none" ? "#18181b" : fill}"></label></div><p>Line breaks create new lines. Position and animation stay as you designed them.</p>`,
    '<button id="apply-text" class="primary">Apply text</button>',
  );
  $("#quick-text")
    .closest("label")
    .insertAdjacentHTML(
      "afterend",
      `<label>Font family<select id="quick-font">${fontOptions(element.font_family)}</select></label>`,
    );
  $("#quick-color").oninput = (event) => {
    fill = event.target.value;
  };
  if (element.font_weight % 100) {
    $("#quick-weight").add(
      new Option(
        String(element.font_weight),
        String(element.font_weight),
        true,
        true,
      ),
    );
  }
  $("#apply-text").onclick = async () => {
    if (!$("#quick-size").reportValidity()) return;
    const text = $("#quick-text").value,
      size = Number($("#quick-size").value),
      weight = Number($("#quick-weight").value);
    if (
      await commit(() => {
        revision(doc(), "Before editing text");
        Object.assign(
          doc().scene.elements.find((e) => e.id === id),
          {
            text,
            font_size: size,
            font_weight: weight,
            font_family: $("#quick-font").value,
            fill,
          },
        );
      })
    )
      d.close();
  };
  $("#quick-text").focus();
  $("#quick-text").select();
}

function fontOptions(selected = "Arial") {
  return fontFamilies
    .map(
      (family) =>
        `<option ${family === selected ? "selected" : ""}>${family}</option>`,
    )
    .join("");
}

function openImages() {
  if (s.busy) return;
  const project = s.project,
    scene = doc().scene,
    version = s.revision;
  const d = modal(
    "Images & logos",
    `<p>Import PNG, JPEG, or WebP. Images are embedded in your project and fit within 2048 px. Select an image below to add an editable layer.</p><div class="image-library">${(project.images || []).map((image) => `<button data-image-id="${esc(image.id)}"><img src="${esc(image.data)}" alt=""><span>${esc(image.name)}</span><small>${image.width} × ${image.height}</small></button>`).join("") || "<p>No images yet. Import a photo or logo to start.</p>"}</div><p id="image-error" role="alert"></p>`,
    '<button id="import-image" class="primary">Import image</button>',
    true,
  );
  const add = async (image, imported = false) => {
    if (!d.open || s.revision !== version || doc().scene.id !== scene.id)
      return;
    const scale = Math.min(
      (project.width * 0.6) / image.width,
      (project.height * 0.6) / image.height,
      1,
    );
    const layer = createElement(project.width, project.height, {
      kind: "image",
      text: "",
      image_id: image.id,
      width: image.width * scale,
      height: image.height * scale,
    });
    if (
      await commit(() => {
        revision(doc(), "Before adding image");
        if (imported) (s.project.images ||= []).push(image);
        doc().scene.elements.push(layer);
        s.layer = layer.id;
        s.layerScene = scene.id;
      })
    )
      d.close();
  };
  d.querySelectorAll("[data-image-id]").forEach((button) => {
    button.onclick = () =>
      add(project.images.find((image) => image.id === button.dataset.imageId));
  });
  $("#import-image").insertAdjacentHTML(
    "afterend",
    '<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>',
  );
  $("#import-image").onclick = () => $("#image-file").click();
  $("#image-file").onchange = async (event) => {
    const button = $("#import-image"),
      error = $("#image-error");
    button.disabled = true;
    error.textContent = "";
    try {
      const file = event.target.files[0];
      if (file && d.open) await add(await importImage(file), true);
    } catch (e) {
      error.textContent = String(e);
    } finally {
      button.disabled = false;
      event.target.value = "";
    }
  };
}
function selectLayer(id) {
  pause();
  s.layer = id;
  s.layerScene = doc().scene.id;
  layerTools();
  drawSelection();
}
function drawSelection() {
  $("#selection-outline")?.remove();
  if (!s.project || !selectedElement() || s.playing || s.presenting) return;
  const canvas = $("#canvas");
  const node = [...canvas.querySelectorAll("[data-element]")].find(
    (e) => e.dataset.element === s.layer,
  );
  if (!node) return;
  const box = node.getBoundingClientRect(),
    parent = canvas.getBoundingClientRect();
  const outline = document.createElement("div");
  outline.id = "selection-outline";
  outline.setAttribute("aria-hidden", "true");
  Object.assign(outline.style, {
    left: `${box.left - parent.left}px`,
    top: `${box.top - parent.top}px`,
    width: `${Math.max(1, box.width)}px`,
    height: `${Math.max(1, box.height)}px`,
  });
  canvas.append(outline);
}
function beginDrag(event) {
  if (event.button !== 0 || s.busy || s.editing || s.presenting || s.drag)
    return;
  const id = event.target.closest("[data-element]")?.dataset.element;
  selectLayer(id || null);
  if (!id) return;
  const canvas = $("#canvas"),
    box = canvas.getBoundingClientRect();
  canvas.focus({ preventScroll: true });
  s.drag = {
    id,
    sceneId: doc().scene.id,
    pointer: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    sx: s.project.width / box.width,
    sy: s.project.height / box.height,
    dx: 0,
    dy: 0,
    moved: false,
  };
  canvas.setPointerCapture(event.pointerId);
}
function dragLayer(event) {
  const drag = s.drag;
  if (!drag || drag.pointer !== event.pointerId) return;
  const dx = event.clientX - drag.x,
    dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  drag.moved = true;
  drag.dx = Math.round(dx * drag.sx);
  drag.dy = Math.round(dy * drag.sy);
  if (event.shiftKey) {
    if (Math.abs(dx) >= Math.abs(dy)) drag.dy = 0;
    else drag.dx = 0;
  }
  if (!drag.frame)
    drag.frame = requestAnimationFrame(() => {
      drag.frame = 0;
      if (s.drag === drag) requestFrame();
    });
}
async function finishDrag(apply) {
  const drag = s.drag;
  if (!drag) return;
  s.drag = null;
  cancelAnimationFrame(drag.frame);
  const canvas = $("#canvas");
  if (canvas.hasPointerCapture(drag.pointer))
    canvas.releasePointerCapture(drag.pointer);
  if (
    apply &&
    drag.moved &&
    (drag.dx || drag.dy) &&
    drag.sceneId === doc().scene.id
  ) {
    await moveSelected(drag.dx, drag.dy);
  } else if (drag.moved) requestFrame();
}
function moveSelected(dx, dy) {
  const element = selectedElement();
  if (!element) return;
  return commit(() => {
    revision(doc(), "Before moving a layer");
    moveElement(element, dx, dy);
  });
}
function filmstrip() {
  $("#filmstrip").innerHTML =
    s.project.scenes
      .map(
        (d, i) =>
          `<button class="scene-card ${i === s.selected ? "selected" : ""}" data-scene="${i}" draggable="true" aria-label="Scene ${i + 1}: ${esc(d.scene.name)}" aria-pressed="${i === s.selected}"><div class="thumb" id="thumb-${i}"><span class="scene-number">${i + 1}</span></div><div class="card-caption"><span class="card-name">${esc(d.scene.name)}</span><span class="card-time">${seconds(d.scene.duration_ms)}</span></div></button>`,
      )
      .join("") +
    `<button class="add-scene" data-action="add">${icon("plus")}Add scene</button>`;
  const request = ++s.thumbRequest;
  Promise.all(
    s.project.scenes.map(async (d, i) => {
      const svg = await invoke("render_frame", {
        scene: d.scene,
        timeMs: Math.min(2000, d.scene.duration_ms * 0.65),
        width: s.project.width,
        height: s.project.height,
      });
      if (request === s.thumbRequest && $(`#thumb-${i}`))
        $(`#thumb-${i}`).insertAdjacentHTML("afterbegin", svg);
    }),
  ).catch((e) => toast(e, true));
}
function sidebar() {
  const previousPrompt = $("#prompt");
  if (previousPrompt?.dataset.draftKey)
    s.drafts[previousPrompt.dataset.draftKey] = previousPrompt.value;
  if (s.tab === "render") {
    $("#sidebar").innerHTML =
      `<div class="render-panel"><h2>Ready for the big screen.</h2><p>Every frame uses the same Rust animation engine as your preview. Export an H.264 MP4 with your soundtrack.</p><dl><dt>Canvas</dt><dd>${s.project.width} × ${s.project.height}</dd><dt>Duration</dt><dd>${seconds(duration())}</dd><dt>Scenes</dt><dd>${s.project.scenes.length}</dd><dt>Audio</dt><dd>${s.project.audio ? esc(s.project.audio.name) : "No soundtrack"}</dd></dl><label>Frame rate<select id="fps">${[24, 30, 60].map((n) => `<option ${n === s.project.fps ? "selected" : ""}>${n}</option>`).join("")}</select></label><button class="primary" data-action="export" ${s.busy ? "disabled" : ""}>Export MP4</button><button data-action="seams" ${s.busy ? "disabled" : ""}>Check scene seams</button><div class="progress"><div id="export-progress"></div></div><p id="export-status">${s.ffmpeg ? "FFmpeg ready. Choose a destination to render." : "Install FFmpeg with brew install ffmpeg, then reopen Storyboard."}</p><button data-action="cancel" class="${s.busy ? "" : "hidden"}">Cancel export</button><p>Projects are saved separately as editable .storyboard files.</p></div>`;
    $('[data-action="export"]').insertAdjacentHTML(
      "afterend",
      `<div class="still-exports"><button data-action="export-png" ${s.busy ? "disabled" : ""}>Save PNG frame</button><button data-action="export-svg" ${s.busy ? "disabled" : ""}>Save SVG frame</button></div><p class="muted">Current frame: <span id="still-frame-time">${esc(doc().scene.name)} at ${Math.round(s.mode === "scene" ? s.time : s.time - sceneStart())} ms</span>. Uses full canvas resolution.</p>`,
    );
    if (s.frameExport) $('[data-action="cancel"]').classList.add("hidden");
    if (browser) {
      $(".render-panel > p").textContent =
        "Record video in this browser with your soundtrack. Keep this tab visible. Recording runs in real time; busy devices may drop frames. Use the desktop app for frame-exact export.";
      $('[data-action="export"]').textContent = `Export ${api.videoLabel}`;
      $("#export-status").textContent = s.ffmpeg
        ? "Ready. Browser export supports up to 4K; download starts when recording finishes."
        : "Video recording is unavailable in this browser.";
    }
    return;
  }
  const chat = s.scope === "scene" ? doc().chat : s.project.chat;
  $("#sidebar").innerHTML =
    `<div class="sidebar-head"><div class="segment"><button data-scope="scene" class="${s.scope === "scene" ? "active" : ""}">Scene</button><button data-scope="project" class="${s.scope === "project" ? "active" : ""}">Project</button></div><span class="sidebar-title">${esc(s.scope === "scene" ? doc().scene.name : s.project.name)}</span><span class="duration">${seconds(s.scope === "scene" ? doc().scene.duration_ms : duration())}</span></div>
    <div class="tools"><button data-action="undo" ${s.undo.length && !s.busy ? "" : "disabled"} title="Undo (Command+Z)">${icon("undo")}Undo</button>${s.scope === "scene" ? `<button data-action="versions">${icon("clock")}Versions (${doc().revisions.length})</button><button class="icon" data-action="duplicate" aria-label="Duplicate scene" title="Duplicate scene">${icon("copy")}</button><button class="icon danger" data-action="delete" aria-label="Delete scene" title="Delete scene" ${s.project.scenes.length === 1 ? "disabled" : ""}>${icon("trash")}</button>` : '<button data-action="seams">Check seams</button>'}<span class="spacer"></span><button class="quiet" data-action="clear-chat" title="Clear conversation">Clear chat</button></div>
    <div class="chat" id="chat">${chat.length ? chat.map((m) => `<div class="message ${m.role === "user" ? "user" : ""}"><small>${esc(m.role === "user" ? "You" : m.provider)}</small>${esc(m.text)}</div>`).join("") : `<div class="welcome"><div class="spark">${icon("spark")}</div><h2>${s.scope === "scene" ? "A scene starts with a thought." : "Think in scenes."}</h2><p>${s.scope === "scene" ? "Describe what should change. Refine the motion, the words, or one precise moment. Every iteration stays in your history." : "Describe the whole story. Claude or Codex can create, reorder, and refine scenes together."}</p><button class="suggestion" data-prompt="${s.scope === "scene" ? "Hold the headline for 500 ms, then bring the shapes in one at a time." : "Create a 15-second product launch with five scenes, clean typography, and precise transitions."}">${s.scope === "scene" ? "Hold the headline a little longer" : "Create a 15-second product launch"}</button><button class="suggestion" data-prompt="${s.scope === "scene" ? "Make the motion quieter. Use gentle easing and let everything settle by 1800 ms." : "Make every scene flow into the next. Keep the palette and visual rhythm consistent."}">${s.scope === "scene" ? "Give the motion room to breathe" : "Find a consistent visual rhythm"}</button><button class="suggestion" data-action="inspector">${icon("sliders")} Edit layers & exact timing</button></div>`}${s.busy ? '<p class="muted"><span class="busy-indicator"></span>Designing your next frame...</p>' : ""}</div>
    <div class="composer"><div id="model-picker"></div><div class="composer-box"><textarea id="prompt" aria-label="Prompt" placeholder="${s.scope === "scene" ? "What should change? e.g. “Slide the card in at 750 ms.”" : "Describe your video, or ask for changes across every scene."}" ${s.busy ? "disabled" : ""}></textarea><div class="composer-bottom"><select id="provider" aria-label="AI provider" ${s.busy ? "disabled" : ""}><option value="claude" ${s.provider === "claude" ? "selected" : ""}>Claude</option><option value="codex" ${s.provider === "codex" ? "selected" : ""}>Codex</option></select><span class="spacer"></span><button data-action="${s.busy ? "cancel" : "send"}" class="primary">${s.busy ? "Cancel" : "Send"}</button></div></div><div class="composer-hint"><span>⌘↵ to send</span><button class="quiet" data-action="inspector" style="font-size:10px;padding:0">Layers & timing</button><span>Uses your CLI login</span></div></div>`;
  $('[data-action="undo"]').insertAdjacentHTML(
    "afterend",
    `<button class="icon redo" data-action="redo" aria-label="Redo" title="Redo (Command+Shift+Z)" ${s.redo.length && !s.busy ? "" : "disabled"}>${icon("undo")}</button>`,
  );
  modelPicker();
  $("#model-picker").insertAdjacentHTML(
    "afterend",
    `<label class="check frame-review"><input id="review-frames" type="checkbox" ${s.reviewFrames ? "checked" : ""} ${s.busy ? "disabled" : ""}>${browser ? "Include rendered frame review" : "Review rendered frames (2 AI passes)"}</label>`,
  );
  $("#review-frames").onchange = (event) => {
    s.reviewFrames = event.target.checked;
  };
  if (browser) {
    $('[data-action="send"]')?.replaceChildren("Prepare prompt");
    $(".composer-hint > span:last-child").textContent =
      "Copy prompt, paste response";
  }
  const draftKey = s.scope === "project" ? "project" : doc().scene.id;
  $("#prompt").dataset.draftKey = draftKey;
  $("#prompt").value = s.drafts[draftKey] || "";
  if (chat.length || s.busy) $("#chat").scrollTop = $("#chat").scrollHeight;
}

function modelPicker() {
  const host = $("#model-picker");
  if (!host) return;
  if (browser) {
    host.innerHTML =
      '<p class="browser-note">Use Claude or Codex in your own app, then paste its JSON response here. Select model and effort there.</p>';
    return;
  }
  const catalog = s.catalogs[s.provider] || {};
  const models = catalog.models || [];
  const selected = s.models[s.provider] || "";
  const model = models.find((m) => m.id === selected);
  const available = Boolean(model);
  const levels = model?.efforts || [];
  const savedEffort = s.efforts[`${s.provider}:${selected}`] || "";
  const effort = levels.some((level) => level.id === savedEffort)
    ? savedEffort
    : "";
  const label = s.provider === "claude" ? "Claude" : "Codex";
  const status = catalog.loading
    ? `Loading ${label} models…`
    : catalog.error ||
      (catalog.fetched_at
        ? `${models.length} models from ${label} · ${new Date(catalog.fetched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
        : `Refresh to load ${label} models.`);
  host.innerHTML = `<div class="model-controls"><select id="model" aria-label="Model" aria-describedby="model-status" ${catalog.loading || s.busy ? "disabled" : ""}><option value="" ${!selected ? "selected" : ""}>CLI default</option>${selected && !available ? `<option value="${esc(selected)}" selected disabled>${esc(selected)} · ${catalog.loading ? "checking" : "unavailable"}</option>` : ""}${models.map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""} title="${esc(m.description)}">${esc(m.name)}${m.resolved_model && m.resolved_model !== m.id ? ` (${esc(m.resolved_model)})` : ""}</option>`).join("")}</select><button class="icon quiet" data-action="refresh-models" aria-label="Refresh models" title="Refresh models from ${label}" ${catalog.loading || s.busy ? "disabled" : ""}>${icon("clock")}</button></div><p id="model-status" class="model-status ${catalog.error ? "danger" : ""}" role="status">${esc(status)}</p>`;
  const sendButton = $('[data-action="send"]');
  host.insertAdjacentHTML(
    "beforeend",
    `<label class="effort-control">Thinking effort<select id="effort" aria-label="Thinking effort" title="Higher effort can improve complex edits but takes longer and uses more quota." ${!levels.length || catalog.loading || s.busy ? "disabled" : ""}><option value="" ${!effort ? "selected" : ""}>${!selected ? "Choose a model first" : !levels.length ? "Model default only" : `CLI default${model.default_effort ? ` (${esc(model.default_effort)})` : ""}`}</option>${levels.map((level) => `<option value="${esc(level.id)}" ${level.id === effort ? "selected" : ""} title="${esc(level.description)}">${esc(level.id)}</option>`).join("")}</select></label>`,
  );
  if (sendButton)
    sendButton.disabled = Boolean(selected && (catalog.loading || !available));
}

function loadModels(provider = s.provider) {
  if (browser) return Promise.resolve();
  if (s.closing) return Promise.resolve();
  if (s.modelRequests[provider]) {
    if (provider === s.provider) modelPicker();
    return s.modelRequests[provider];
  }
  s.catalogs[provider] = { loading: true, models: [] };
  if (provider === s.provider) modelPicker();
  const request = invoke("model_catalog", { provider })
    .then((catalog) => {
      s.catalogs[provider] = { ...catalog, loading: false };
    })
    .catch((error) => {
      s.catalogs[provider] = {
        loading: false,
        models: [],
        error: String(error),
      };
    })
    .finally(() => {
      delete s.modelRequests[provider];
      if (!s.closing && provider === s.provider) modelPicker();
    });
  s.modelRequests[provider] = request;
  return request;
}

function soundLane(lane) {
  const cues = cuePlacements(s.project);
  lane.insertAdjacentHTML(
    "beforeend",
    `<div class="sound-lane"><button data-action="sounds">Sound effects${cues.length ? ` (${cues.length})` : ""}</button><div class="sound-markers" aria-label="Timed sound effects">${cues.map(({ cue, sound, start }) => `<button class="sound-marker" data-cue="${esc(cue.id)}" data-sound-time="${start}" style="left:${(start / duration()) * 100}%" title="${esc(sound.name)} at ${(start / 1000).toFixed(3)} s" aria-label="${esc(sound.name)} at ${(start / 1000).toFixed(3)} seconds">♪</button>`).join("")}</div></div>`,
  );
  lane.querySelectorAll("[data-cue]").forEach((button) => {
    button.onclick = () => {
      s.mode = "project";
      seek(Number(button.dataset.soundTime));
      refresh();
      openSounds(button.dataset.cue);
    };
  });
}

function openSounds(selectedId) {
  if (s.busy) return;
  const sceneId = doc().scene.id,
    version = s.revision;
  const cues = clone(doc().scene.sounds || []),
    assets = [...(s.project.sounds || [])];
  const local = Math.min(
    doc().scene.duration_ms - 1,
    Math.max(0, Math.round(globalTime() - sceneStart())),
  );
  const d = modal(
    "Sound effects",
    `<p>Add effects at the playhead (${(local / 1000).toFixed(3)} s in this scene). Cues move with their scene. Tails can continue across cuts.</p><div class="form-row"><label>Clip<select id="sound-library"></select></label><button id="preview-sound">Preview clip</button><button id="add-sound">Add at playhead</button></div><input id="sound-file" type="file" accept="audio/*" hidden><button id="import-sound">Import clip (up to 15 s)</button><div id="sound-cues"></div><p id="sound-error" role="alert"></p>`,
    '<button id="apply-sounds" class="primary">Apply sound effects</button>',
    true,
  );
  d.addEventListener("close", stopSounds, { once: true });
  const library = $("#sound-library");
  const fillLibrary = () => {
    library.innerHTML = `<optgroup label="Built-in effects">${Object.entries(
      soundPresets,
    )
      .map(([id, name]) => `<option value="preset:${id}">${name}</option>`)
      .join(
        "",
      )}</optgroup><optgroup label="Project clips">${assets.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}</optgroup>`;
  };
  const chosen = () =>
    library.value.startsWith("preset:")
      ? synthSound(library.value.slice(7))
      : assets.find((a) => a.id === library.value);
  const renderCues = () => {
    $("#sound-cues").innerHTML = cues.length
      ? cues
          .map(
            (cue) =>
              `<fieldset class="sound-cue" data-sound-cue="${esc(cue.id)}"><legend>${esc(assets.find((a) => a.id === cue.sound_id).name)}</legend><div class="sound-fields"><label>At (s)<input data-field="at_ms" type="number" min="0" max="${(doc().scene.duration_ms - 1) / 1000}" step="0.001" value="${cue.at_ms / 1000}"></label><label>Trim start (s)<input data-field="trim_start_ms" type="number" min="0" max="${(assets.find((a) => a.id === cue.sound_id).duration_ms - 1) / 1000}" step="0.001" value="${cue.trim_start_ms / 1000}"></label><label>Length (s)<input data-field="duration_ms" type="number" min="0.001" max="30" step="0.001" value="${cue.duration_ms / 1000}"></label><label>Volume (%)<input data-field="volume" type="number" min="0" max="100" step="1" value="${Math.round(cue.volume * 100)}"></label><label>Pitch (semitones)<input data-field="pitch" type="number" min="-12" max="12" step="1" value="${cue.pitch}"></label></div><button data-preview-cue="${esc(cue.id)}">Preview cue</button><button data-remove-cue="${esc(cue.id)}">Remove</button></fieldset>`,
          )
          .join("")
      : "<p>No sound effects in this scene.</p>";
    d.querySelectorAll("[data-field]").forEach((input) => {
      input.oninput = () => {
        const cue = cues.find(
          (c) => c.id === input.closest("[data-sound-cue]").dataset.soundCue,
        );
        const key = input.dataset.field;
        cue[key] =
          key === "volume"
            ? Number(input.value) / 100
            : Math.round(Number(input.value) * (key === "pitch" ? 1 : 1000));
      };
    });
    d.querySelectorAll("[data-remove-cue]").forEach((button) => {
      button.onclick = () => {
        stopSounds();
        cues.splice(
          cues.findIndex((c) => c.id === button.dataset.removeCue),
          1,
        );
        renderCues();
      };
    });
    d.querySelectorAll("[data-preview-cue]").forEach((button) => {
      button.onclick = () => {
        if (
          ![...d.querySelectorAll("[data-field]")].every((input) =>
            input.reportValidity(),
          )
        )
          return;
        const cue = cues.find((c) => c.id === button.dataset.previewCue);
        playSounds(
          {
            sounds: assets,
            scenes: [
              {
                scene: {
                  duration_ms: cue.duration_ms,
                  sounds: [{ ...cue, at_ms: 0 }],
                },
              },
            ],
          },
          0,
          cue.duration_ms,
        ).catch((e) => {
          $("#sound-error").textContent = String(e);
        });
      };
    });
  };
  $("#preview-sound").onclick = () =>
    previewSound(chosen()).catch((e) => {
      $("#sound-error").textContent = String(e);
    });
  $("#add-sound").onclick = () => {
    let asset = chosen();
    asset = assets.find((a) => a.data === asset.data) || asset;
    if (!assets.some((a) => a.id === asset.id)) assets.push(asset);
    cues.push({
      id: crypto.randomUUID(),
      sound_id: asset.id,
      at_ms: local,
      trim_start_ms: 0,
      duration_ms: asset.duration_ms,
      volume: 0.7,
      pitch: 0,
    });
    fillLibrary();
    library.value = asset.id;
    renderCues();
    $("#sound-cues").lastElementChild?.scrollIntoView({ block: "nearest" });
  };
  $("#import-sound").onclick = () => $("#sound-file").click();
  $("#sound-file").onchange = async (event) => {
    const button = $("#import-sound");
    button.disabled = true;
    try {
      const file = event.target.files[0];
      if (file) {
        const asset = await importSound(file);
        if (d.open) {
          assets.push(asset);
          fillLibrary();
          library.value = asset.id;
        }
      }
    } catch (e) {
      $("#sound-error").textContent = String(e);
    } finally {
      button.disabled = false;
      event.target.value = "";
    }
  };
  $("#apply-sounds").onclick = async () => {
    if (
      ![...d.querySelectorAll("[data-field]")].every((input) =>
        input.reportValidity(),
      )
    )
      return;
    if (s.revision !== version || doc().scene.id !== sceneId) {
      $("#sound-error").textContent = "Project changed. Reopen sound effects.";
      return;
    }
    if (
      await commit(() => {
        revision(doc(), "Before sound edits");
        s.project.sounds = assets;
        doc().scene.sounds = cues;
      })
    )
      d.close();
  };
  fillLibrary();
  renderCues();
  if (selectedId)
    [...d.querySelectorAll("[data-sound-cue]")]
      .find((el) => el.dataset.soundCue === selectedId)
      ?.scrollIntoView({ block: "nearest" });
}

function audioLane() {
  const a = s.project.audio;
  const lane = $("#audio-lane");
  lane.classList.toggle("loaded", !!a);
  if (!a) {
    lane.innerHTML = `<button data-action="import">${icon("music")}Add a soundtrack</button><span class="audio-note">Drop audio anywhere. Find beats, downbeats, and sections.</span>`;
    soundLane(lane);
    return;
  }
  lane.innerHTML = `<div class="audio-header">${icon("music")}<span class="audio-name">${esc(a.name)}</span><span>${a.bpm.toFixed(1)} BPM</span><button data-action="audio-grid">Beat grid</button><label class="check"><input id="snap" type="checkbox" ${s.snap ? "checked" : ""}>Snap</label><button data-action="snap-cuts">Snap cuts</button><button data-action="snap-motion">Snap motion</button><span class="spacer"></span><button class="quiet" data-action="import" aria-label="Replace soundtrack">Replace</button><button class="quiet" data-action="remove-audio" aria-label="Remove soundtrack">${icon("close")}</button></div><svg class="waveform" id="waveform" viewBox="0 0 1000 42" preserveAspectRatio="none" role="img" aria-label="Audio waveform with estimated beat markers"></svg>`;
  $('[data-action="audio-grid"]').insertAdjacentHTML(
    "beforebegin",
    `<button data-action="audio-mix">Volume ${Math.round((a.mix?.volume ?? 1) * 100)}%</button><button data-action="mute-audio" aria-pressed="${!!a.mix?.muted}">${a.mix?.muted ? "Unmute" : "Mute"}</button>`,
  );
  let wave = "";
  const total = duration();
  for (let x = 0; x < 1000; x += 2) {
    const time = (x / 1000) * total + (a.start_ms || 0);
    const index = Math.floor((time / a.duration_ms) * a.peaks.length);
    const h = (a.peaks[index] || 0) * 18;
    wave += `M${x},${21 - h}v${2 * h || 1}`;
  }
  let lines = "";
  const step = 60000 / a.bpm;
  const offset = a.offset_ms - (a.start_ms || 0);
  const first = Math.floor(-offset / step);
  for (let n = first; n < Math.ceil((total - offset) / step); n++) {
    const t = offset + n * step;
    if (t < 0) continue;
    const x = (t / total) * 1000;
    lines += `<line x1="${x}" x2="${x}" y1="0" y2="42" stroke="${n % a.beats_per_bar === 0 ? "#8c71ba" : "#c0b6d4"}" stroke-width="${n % a.beats_per_bar === 0 ? 1.5 : 0.6}"/>`;
  }
  const sections = a.sections
    .map((t) => t - (a.start_ms || 0))
    .filter((t) => t > 0 && t < total)
    .map((t) => `<path d="M${(t / total) * 1000},0l4,5h-8z" fill="#d07a56"/>`)
    .join("");
  $("#waveform").innerHTML =
    `${lines}<path d="${wave}" stroke="#9f98ac" stroke-width="1"/>${sections}<line id="audio-playhead" x1="0" x2="0" y1="0" y2="42" stroke="#477df5" stroke-width="2"/>`;
  $("#waveform").addEventListener("pointerdown", (e) => {
    pause();
    s.mode = "project";
    const box = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - box.left) / box.width) * total, s.snap);
    refresh();
  });
  soundLane(lane);
}

function setAudio() {
  audio.pause();
  audio.removeAttribute("src");
  if (s.project.audio) {
    audio.src = api.core.convertFileSrc(s.project.audio.path);
    audio.load();
  }
}
audio.addEventListener("error", () => {
  if (s.project?.audio)
    toast(
      "Soundtrack cannot be played. Relink it with Replace, or use WAV, MP3, or M4A.",
      true,
    );
});
function syncAudio() {
  playSounds(
    s.project,
    globalTime(),
    s.mode === "scene" ? sceneStart() + limit() : duration(),
  ).catch((e) => toast(`Sound playback failed: ${e.message}`, true));
  if (!s.project.audio) return;
  const time = (globalTime() + (s.project.audio.start_ms || 0)) / 1000;
  if (time < s.project.audio.duration_ms / 1000) {
    audio.currentTime = Math.max(0, time);
    audio
      .play()
      .catch((e) => toast(`Audio playback failed: ${e.message}`, true));
  } else audio.pause();
}
function pause() {
  s.playing = false;
  s.playToken++;
  audio.pause();
  stopSounds();
  if (s.project) transport();
}
function play() {
  if (s.playing) {
    pause();
    return;
  }
  if (s.time >= limit()) s.time = 0;
  s.startTime = s.time;
  s.started = performance.now();
  s.playing = true;
  syncAudio();
  transport();
  tick(++s.playToken);
}
async function tick(token) {
  if (!s.playing || token !== s.playToken) return;
  const now = performance.now();
  if (s.project.audio && !audio.paused && audio.readyState >= 2) {
    s.time = Math.max(
      0,
      audio.currentTime * 1000 -
        (s.project.audio.start_ms || 0) -
        (s.mode === "scene" ? sceneStart() : 0),
    );
    s.startTime = s.time;
    s.started = now;
  } else {
    s.time = s.startTime + now - s.started;
  }
  if (s.time >= limit()) {
    if (s.mode === "scene") {
      s.time %= limit();
      s.startTime = s.time;
      s.started = now;
      syncAudio();
    } else {
      s.time = limit();
      pause();
    }
  }
  if (s.mode === "project") selectAtTime();
  transport();
  await requestFrame();
  if (s.playing && token === s.playToken)
    requestAnimationFrame(() => tick(token));
}
function selectAtTime() {
  let start = 0;
  let index = s.project.scenes.length - 1;
  for (let i = 0; i < s.project.scenes.length; i++) {
    if (s.time < start + s.project.scenes[i].scene.duration_ms) {
      index = i;
      break;
    }
    start += s.project.scenes[i].scene.duration_ms;
  }
  if (index !== s.selected) {
    s.selected = index;
    sidebar();
    layerTools();
    document.querySelectorAll("[data-scene]").forEach((b) => {
      b.classList.toggle("selected", Number(b.dataset.scene) === index);
      b.setAttribute("aria-pressed", String(Number(b.dataset.scene) === index));
    });
    $(`[data-scene="${index}"]`)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }
}
function snapped(time, downbeats = false) {
  const a = s.project.audio;
  if (!a) return time;
  const step = (60000 / a.bpm) * (downbeats ? a.beats_per_bar : 1);
  const offset = a.offset_ms - (a.start_ms || 0);
  return Math.max(0, offset + Math.round((time - offset) / step) * step);
}
function seek(time, snap = false) {
  pause();
  if (!Number.isFinite(time)) return;
  const start = s.mode === "scene" ? sceneStart() : 0;
  s.time = Math.max(
    0,
    Math.min(limit(), snap ? snapped(time + start) - start : time),
  );
  if (s.mode === "project") selectAtTime();
  transport();
  requestFrame();
}
function select(index) {
  pause();
  s.selected = index;
  s.time = s.mode === "project" ? sceneStart() : 0;
  refresh();
}

function persist() {
  clearTimeout(s.persistTimer);
  const project = clone(s.project);
  s.persist = s.persist
    .catch(() => {})
    .then(() => invoke("save_recovery", { project }));
  s.persist.catch((e) => toast(`Recovery save failed: ${e}`, true));
  return s.persist;
}
async function commit(mutator) {
  if (s.busy || s.editing || s.drag) {
    toast("Finish or cancel the current change first.");
    return false;
  }
  pause();
  s.editing = true;
  const before = clone(s.project);
  const selected = s.selected;
  try {
    mutator();
    await invoke("validate_project", { project: s.project });
    s.undo.push(before);
    if (s.undo.length > 30) s.undo.shift();
    s.redo = [];
    s.dirty = true;
    s.revision++;
    clearTimeout(s.persistTimer);
    s.persistTimer = setTimeout(persist, 300);
    refresh();
    return true;
  } catch (e) {
    s.project = before;
    s.selected = selected;
    refresh();
    toast(e, true);
    return false;
  } finally {
    s.editing = false;
  }
}
function revision(d, label) {
  d.revisions.push({ label, scene: clone(d.scene) });
  if (d.revisions.length > 50) d.revisions.shift();
}
function history(redo = false) {
  if (s.busy || s.editing || s.drag) return;
  const source = redo ? s.redo : s.undo;
  const dest = redo ? s.undo : s.redo;
  if (!source.length) return;
  pause();
  dest.push(clone(s.project));
  s.project = source.pop();
  s.selected = Math.min(s.selected, s.project.scenes.length - 1);
  s.time = 0;
  s.dirty = true;
  s.revision++;
  setAudio();
  persist();
  refresh();
}
function blankScene(width = s.project.width, height = s.project.height) {
  return {
    scene: {
      id: uid(),
      name: "Untitled scene",
      duration_ms: 3000,
      background: "#fafafa",
      elements: [createElement(width, height)],
    },
    revisions: [],
    chat: [],
  };
}
function retime(scene, newDuration) {
  const ratio = newDuration / scene.duration_ms;
  for (const cue of scene.sounds || [])
    cue.at_ms = Math.min(newDuration - 1, Math.round(cue.at_ms * ratio));
  for (const e of scene.elements)
    for (const t of e.tracks) {
      const unique = new Map();
      for (const k of t.keyframes) {
        k.time_ms = Math.min(newDuration, Math.round(k.time_ms * ratio));
        unique.set(k.time_ms, k);
      }
      t.keyframes = [...unique.values()].sort((a, b) => a.time_ms - b.time_ms);
    }
  scene.duration_ms = newDuration;
}
function reorder(from, to) {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= s.project.scenes.length ||
    to >= s.project.scenes.length
  )
    return;
  commit(() => {
    const [d] = s.project.scenes.splice(from, 1);
    s.project.scenes.splice(to, 0, d);
    s.selected = to;
    s.time = 0;
  });
}

async function send() {
  const prompt = $("#prompt").value.trim();
  if (!prompt || s.busy) return;
  const provider = s.provider;
  const model = $("#model")?.value.trim() || "";
  const effort = $("#effort")?.value || "";
  if (model && !s.catalogs[provider]?.models?.some((m) => m.id === model)) {
    toast("Choose a model from the current list, or use CLI default.", true);
    return;
  }
  if (
    effort &&
    !s.catalogs[provider]?.models
      ?.find((m) => m.id === model)
      ?.efforts?.some((level) => level.id === effort)
  ) {
    toast("Choose an effort level supported by this model.", true);
    return;
  }
  s.models[provider] = model;
  localStorage.setItem("models", JSON.stringify(s.models));
  const scope = s.scope;
  const index = s.selected;
  const snapshot = clone(s.project);
  const version = s.revision;
  const draftKey = $("#prompt").dataset.draftKey;
  pause();
  s.busy = true;
  sidebar();
  status();
  try {
    const reply = await job("generate", {
      project: snapshot,
      request: {
        scene_index: scope === "scene" ? index : null,
        provider,
        model,
        effort,
        prompt,
        playhead_ms: globalTime(),
        review_frames: s.reviewFrames,
      },
    });
    if (version !== s.revision)
      throw new Error(
        "Project changed during generation. Result was not applied.",
      );
    s.drafts[draftKey] = "";
    if ($("#prompt")?.dataset.draftKey === draftKey) $("#prompt").value = "";
    s.busy = false;
    await commit(() => {
      if (scope === "scene") {
        const d = s.project.scenes[index];
        revision(d, `${provider}: ${prompt.slice(0, 70)}`);
        d.scene = reply.scenes[0];
        d.chat.push(
          { role: "user", text: prompt, provider },
          { role: "assistant", text: reply.summary, provider },
        );
        d.chat = d.chat.slice(-100);
      } else {
        const existing = new Map(s.project.scenes.map((d) => [d.scene.id, d]));
        s.project.scenes = reply.scenes.map((scene) => {
          const d = existing.get(scene.id);
          if (!d) return { scene, revisions: [], chat: [] };
          revision(d, `${provider}: project revision`);
          d.scene = scene;
          return d;
        });
        s.project.chat.push(
          { role: "user", text: prompt, provider },
          { role: "assistant", text: reply.summary, provider },
        );
        s.project.chat = s.project.chat.slice(-100);
        s.selected = 0;
      }
      s.time = 0;
    });
    toast("New revision ready. Play it, refine it, or undo.");
  } catch (e) {
    toast(String(e), true);
    s.busy = false;
    sidebar();
    if ($("#prompt")) $("#prompt").value = prompt;
  } finally {
    s.busy = false;
    status();
  }
}

async function save(as = false) {
  pause();
  try {
    const path = await invoke("save_project", {
      project: s.project,
      path: as ? null : s.path,
    });
    if (!path) return false;
    s.path = path;
    s.dirty = false;
    persist();
    refresh();
    toast("Project saved.");
    return true;
  } catch (e) {
    toast(e, true);
    return false;
  }
}
async function mayReplace() {
  if (!s.dirty) return true;
  const choice = await question(
    "Save your work?",
    "Save this project before replacing it. Your unsaved changes belong to the current project.",
    [
      ["cancel", "Cancel"],
      ["discard", "Discard changes"],
      ["save", "Save project"],
    ],
  );
  return choice === "save" ? await save() : choice === "discard";
}
async function open(path = null) {
  if (s.busy || !(await mayReplace())) return;
  try {
    const result = await invoke("open_project", { path });
    if (!result) return;
    pause();
    s.project = result.project;
    s.path = result.path;
    s.selected = 0;
    s.time = 0;
    s.dirty = false;
    s.undo = [];
    s.redo = [];
    s.revision++;
    setAudio();
    persist();
    refresh();
    if (result.warning) toast(result.warning, true);
  } catch (e) {
    toast(e, true);
  }
}
async function newProject() {
  if (s.busy || !(await mayReplace())) return;
  openTemplates(true);
}

function canvasSizeOptions() {
  return (
    '<option value="">Custom dimensions</option>' +
    Object.entries(canvasSizes)
      .map(
        ([group, sizes]) =>
          `<optgroup label="${esc(group)}">${sizes.map(([name, w, h]) => `<option value="${w}x${h}">${esc(name)} · ${w} × ${h}</option>`).join("")}</optgroup>`,
      )
      .join("")
  );
}

function openTemplates(newProject = false) {
  if (s.busy || s.editing) return;
  let selected = "title",
    request = 0;
  const choices = {
    ...sceneTemplates,
    blank: {
      name: "Blank scene",
      description: "Start with one text layer and no animation.",
    },
  };
  const d = modal(
    newProject ? "Start a new project" : "Add a scene",
    `${newProject ? `<label>Project name<input id="starter-name" value="Untitled project" maxlength="200"></label><label>Canvas size<select id="starter-size">${canvasSizeOptions()}</select></label><div class="form-row"><label>Width (px)<input id="starter-width" type="number" min="64" max="8192" step="2" value="${s.project.width}"></label><label>Height (px)<input id="starter-height" type="number" min="64" max="8192" step="2" value="${s.project.height}"></label></div>` : `<p>Adds after the current scene at ${s.project.width} × ${s.project.height}. Existing scenes stay intact.</p>`}<div class="starter-heading"><p>Pick a starting layout. Every word, shape, and animation is editable.</p><label>Accent<input id="starter-accent" type="color" value="#4776f5"></label></div><div class="template-grid">${Object.entries(
      choices,
    )
      .map(
        ([id, choice]) =>
          `<button class="template-card" data-template="${id}" aria-pressed="${id === selected}"><span class="template-thumb" id="template-${id}"></span><strong>${esc(choice.name)}</strong><small>${esc(choice.description)}</small></button>`,
      )
      .join("")}</div><p id="starter-status" role="status"></p>`,
    `<button id="create-starter" class="primary">${newProject ? "Create project" : "Add scene"}</button>`,
    true,
  );
  const grid = d.querySelector(".template-grid");
  const dimensions = () =>
    newProject
      ? [Number($("#starter-width").value), Number($("#starter-height").value)]
      : [s.project.width, s.project.height];
  const make = (id, width, height) =>
    id === "blank"
      ? blankScene(width, height)
      : createTemplate(id, width, height, $("#starter-accent").value);
  const preview = async () => {
    const ticket = ++request;
    const [width, height] = dimensions();
    const valid =
      Number.isInteger(width) &&
      Number.isInteger(height) &&
      width >= 64 &&
      height >= 64 &&
      width <= 8192 &&
      height <= 8192 &&
      width % 2 === 0 &&
      height % 2 === 0 &&
      width * height <= 8192 * 4320;
    $("#create-starter").disabled = !valid;
    $("#starter-status").textContent = valid
      ? `${choices[selected].name} · ${selected === "blank" ? "3" : "4"} seconds`
      : "Use even canvas dimensions from 64 to 8192 px, up to 35.4 megapixels.";
    if (!valid) return;
    try {
      const frames = await Promise.all(
        Object.keys(choices).map(async (id) => [
          id,
          await invoke("render_frame", {
            scene: make(id, width, height).scene,
            timeMs: 1200,
            width,
            height,
          }),
        ]),
      );
      if (ticket !== request || !grid.isConnected || !d.open) return;
      for (const [id, svg] of frames) $(`#template-${id}`).innerHTML = svg;
    } catch (error) {
      if (ticket === request && grid.isConnected)
        $("#starter-status").textContent = String(error);
    }
  };
  d.querySelectorAll("[data-template]").forEach((button) => {
    button.onclick = () => {
      selected = button.dataset.template;
      d.querySelectorAll("[data-template]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b === button)),
      );
      const [width, height] = dimensions();
      $("#starter-status").textContent =
        `${choices[selected].name} · ${selected === "blank" ? "3" : "4"} seconds · ${width} × ${height}`;
    };
  });
  $("#starter-accent").oninput = preview;
  if (newProject) {
    const match = () => {
      $("#starter-size").value =
        `${$("#starter-width").value}x${$("#starter-height").value}`;
      preview();
    };
    $("#starter-width").oninput = match;
    $("#starter-height").oninput = match;
    $("#starter-size").value = `${s.project.width}x${s.project.height}`;
    $("#starter-size").onchange = () => {
      const value = $("#starter-size").value;
      if (value) {
        const [width, height] = value.split("x");
        $("#starter-width").value = width;
        $("#starter-height").value = height;
        preview();
      } else $("#starter-width").focus();
    };
  }
  $("#create-starter").onclick = async () => {
    const [width, height] = dimensions();
    const document = make(selected, width, height);
    if (newProject) {
      const project = {
        ...s.project,
        name: $("#starter-name").value || "Untitled project",
        width,
        height,
        scenes: [document],
        audio: null,
        images: [],
        sounds: [],
        chat: [],
      };
      try {
        await invoke("validate_project", { project });
      } catch (error) {
        toast(error, true);
        return;
      }
      s.project = project;
      s.path = null;
      s.selected = 0;
      s.time = Math.min(1200, document.scene.duration_ms);
      s.dirty = true;
      s.undo = [];
      s.redo = [];
      s.snap = false;
      s.layer = null;
      s.revision++;
      setAudio();
      persist();
      refresh();
      d.close();
    } else if (
      await commit(() => {
        s.project.scenes.splice(s.selected + 1, 0, document);
        s.selected++;
        s.time = s.mode === "scene" ? 1200 : sceneStart() + 1200;
      })
    )
      d.close();
  };
  preview();
}
async function importAudio(path = null) {
  if (s.busy) return;
  pause();
  s.busy = true;
  status();
  toast("Analyzing soundtrack...");
  try {
    const a = await job("import_audio", { path });
    s.busy = false;
    if (a) {
      await commit(() => {
        s.project.audio = a;
      });
      setAudio();
      toast(
        `Estimated ${a.bpm.toFixed(1)} BPM. Review downbeat offset and sections in Beat grid.`,
      );
    }
  } catch (e) {
    toast(e, true);
  } finally {
    s.busy = false;
    status();
  }
}
async function exportVideo() {
  if (s.busy) return;
  pause();
  s.busy = true;
  sidebar();
  status();
  try {
    const path = await job("export_video", { project: s.project });
    if (path) {
      if ($("#export-status"))
        $("#export-status").textContent = `Saved to ${path}`;
      toast(`${browser ? "Video download ready" : "MP4 exported"}: ${path}`);
    } else if ($("#export-status"))
      $("#export-status").textContent = "Export canceled.";
  } catch (e) {
    toast(e, true);
    if ($("#export-status")) $("#export-status").textContent = String(e);
  } finally {
    s.busy = false;
    status();
    for (const action of ["export", "export-png", "export-svg"])
      $(`[data-action="${action}"]`)?.removeAttribute("disabled");
    $('[data-action="seams"]')?.removeAttribute("disabled");
    $('[data-action="cancel"]')?.classList.add("hidden");
  }
}

async function exportStill(format) {
  if (s.busy || s.drag) return;
  pause();
  s.busy = true;
  s.frameExport = true;
  sidebar();
  status();
  let message = "Frame export canceled.";
  try {
    const path = await job("export_frame", {
      scene: clone(doc().scene),
      timeMs: Math.max(0, s.mode === "scene" ? s.time : s.time - sceneStart()),
      width: s.project.width,
      height: s.project.height,
      format,
    });
    if (path)
      message = `${format.toUpperCase()} ${browser ? "download ready" : "saved"}: ${path}`;
    toast(message);
  } catch (error) {
    message = String(error);
    toast(message, true);
  } finally {
    s.busy = false;
    s.frameExport = false;
    sidebar();
    status();
    if ($("#export-status")) $("#export-status").textContent = message;
  }
}

function modal(title, body, footer = "", wide = false) {
  pause();
  const previous = $("#modal");
  if (previous.open) previous.close();
  // A queued close event must not settle a later confirmation.
  const d = document.createElement("dialog");
  d.id = "modal";
  previous.replaceWith(d);
  d.className = wide ? "wide" : "";
  d.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button class="quiet icon" data-close aria-label="Close dialog">${icon("close")}</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ""}`;
  d.showModal();
  d.querySelector("[data-close]").onclick = () => d.close();
  return d;
}
function question(title, message, choices) {
  return new Promise((resolve) => {
    const d = modal(
      title,
      `<p>${esc(message)}</p>`,
      choices
        .map(
          ([value, label], i) =>
            `<button data-choice="${value}" class="${i === choices.length - 1 ? "primary" : ""}">${label}</button>`,
        )
        .join(""),
    );
    d.querySelectorAll("[data-choice]").forEach(
      (b) =>
        (b.onclick = () => {
          resolve(b.dataset.choice);
          d.close();
        }),
    );
    d.addEventListener("close", () => resolve("cancel"), { once: true });
  });
}

function openProjectSettings(focusCanvas = false) {
  if (s.busy) return;
  const p = s.project;
  const d = modal(
    "Project & canvas",
    `<label>Project name<input id="project-name-input" value="${esc(p.name)}" maxlength="200"></label><label>Canvas size<select id="canvas-size">${canvasSizeOptions()}</select></label><div class="form-row three"><label>Width (px)<input type="number" id="canvas-width" value="${p.width}" min="64" max="8192" step="2"></label><label>Height (px)<input type="number" id="canvas-height" value="${p.height}" min="64" max="8192" step="2"></label><label>Frame rate<select id="project-fps">${[24, 30, 60].map((n) => `<option ${n === p.fps ? "selected" : ""}>${n}</option>`).join("")}</select></label></div><p>47 common formats, with square pixels. Custom sizes use even dimensions from 64 to 8192 px, up to 35.4 megapixels. Large canvases take longer to export.</p><p>Canvas changes scale existing layers, animation coordinates, and saved revisions to fit. Audio stays on the same timeline.</p><label>Art direction<textarea id="art-direction" rows="3" maxlength="20000">${esc(p.art_direction)}</textarea></label>`,
    `<button id="load-example">Load example</button><span class="spacer"></span><button id="save-settings" class="primary">Apply</button>`,
  );
  const matchSize = () => {
    const value = `${$("#canvas-width").value}x${$("#canvas-height").value}`;
    $("#canvas-size").value = Object.values(canvasSizes)
      .flat()
      .some(([, w, h]) => `${w}x${h}` === value)
      ? value
      : "";
  };
  matchSize();
  $("#canvas-size").onchange = () => {
    const value = $("#canvas-size").value;
    if (!value) {
      $("#canvas-width").focus();
      return;
    }
    const [width, height] = value.split("x");
    $("#canvas-width").value = width;
    $("#canvas-height").value = height;
  };
  $("#canvas-width").oninput = matchSize;
  $("#canvas-height").oninput = matchSize;
  if (focusCanvas) $("#canvas-size").focus();
  $("#save-settings").onclick = async () => {
    const name = $("#project-name-input").value;
    const direction = $("#art-direction").value;
    const width = Number($("#canvas-width").value),
      height = Number($("#canvas-height").value),
      fps = Number($("#project-fps").value);
    if (
      await commit(() => {
        const p = s.project;
        resizeCanvas(p, width, height);
        p.name = name || "Untitled project";
        p.art_direction = direction;
        p.width = width;
        p.height = height;
        p.fps = fps;
      })
    )
      d.close();
  };
  $("#load-example").onclick = async () => {
    d.close();
    if (await mayReplace()) {
      s.project = await invoke("demo");
      s.selected = 0;
      s.time = 0;
      s.path = null;
      s.dirty = false;
      s.undo = [];
      s.redo = [];
      setAudio();
      persist();
      refresh();
    }
  };
}

function versions() {
  const d = doc();
  modal(
    "Scene versions",
    d.revisions.length
      ? d.revisions
          .map(
            (r, i) =>
              `<div class="revision"><span>${i + 1}. ${esc(r.label)}</span><button data-restore="${i}">Restore</button></div>`,
          )
          .reverse()
          .join("")
      : "<p>Previous versions appear here after an AI edit or a manual layer change.</p>",
  );
  document.querySelectorAll("[data-restore]").forEach(
    (b) =>
      (b.onclick = async () => {
        const scene = clone(d.revisions[Number(b.dataset.restore)].scene);
        if (
          await commit(() => {
            revision(d, "Before restoring a version");
            d.scene = scene;
            s.time = 0;
          })
        )
          $("#modal").close();
      }),
  );
}

function audioGrid() {
  const a = s.project.audio;
  if (!a) return;
  const d = modal(
    "Find the downbeat",
    `<p>Tempo, downbeat phase, and section changes are estimates from audio energy. Check them by ear. Set the first strong beat to the correct millisecond, then snap cuts or animation keyframes.</p><div class="form-row three"><label>Tempo (BPM)<input type="number" id="bpm" min="30" max="300" step="0.1" value="${a.bpm.toFixed(2)}"></label><label>Downbeat offset (ms)<input type="number" id="beat-offset" step="1" value="${Math.round(a.offset_ms)}"></label><label>Beats per bar<input type="number" id="meter" min="1" max="12" value="${a.beats_per_bar}"></label></div><label>Section boundaries (ms, comma-separated)<textarea id="sections">${a.sections.join(", ")}</textarea></label><p>Beat confidence: ${Math.round(a.confidence * 100)}%. Section markers indicate strong energy changes, not guaranteed musical phrases.</p>`,
    `<button id="offset-playhead">Use playhead as downbeat</button><span class="spacer"></span><button id="apply-grid" class="primary">Apply grid</button>`,
  );
  $("#offset-playhead").onclick = () =>
    ($("#beat-offset").value = Math.round(globalTime() + (a.start_ms || 0)));
  $("#sections")
    .closest("label")
    .insertAdjacentHTML(
      "afterend",
      "<p>Downbeat and section times refer to the original audio file. The soundtrack start offset shifts them into video time.</p>",
    );
  $("#apply-grid").onclick = async () => {
    const bpm = Number($("#bpm").value),
      offset = Number($("#beat-offset").value),
      meter = Number($("#meter").value),
      sections = $("#sections")
        .value.split(",")
        .filter((v) => v.trim())
        .map(Number)
        .sort((a, b) => a - b);
    if (
      await commit(() => {
        Object.assign(s.project.audio, {
          bpm,
          offset_ms: offset,
          beats_per_bar: meter,
          sections,
        });
      })
    )
      d.close();
  };
}

function soundMix() {
  const track = s.project.audio;
  if (!track || s.busy) return;
  const mix = {
    volume: 1,
    muted: false,
    fade_in_ms: 0,
    fade_out_ms: 0,
    ...track.mix,
  };
  const d = modal(
    "Soundtrack & mix",
    `<p>${esc(track.name)}. These settings apply to playback and exported video.</p><label>Volume <output id="mix-volume-value">${Math.round(mix.volume * 100)}%</output><input id="mix-volume" type="range" min="0" max="100" step="1" value="${Math.round(mix.volume * 100)}"></label><label class="check"><input id="mix-muted" type="checkbox" ${mix.muted ? "checked" : ""}>Mute soundtrack</label><div class="form-row"><label>Fade in (seconds)<input id="mix-in" type="number" min="0" max="600" step="0.1" value="${mix.fade_in_ms / 1000}"></label><label>Fade out (seconds)<input id="mix-out" type="number" min="0" max="600" step="0.1" value="${mix.fade_out_ms / 1000}"></label></div><p>Fade in starts with the video. Fade out finishes when the video or remaining soundtrack ends, whichever comes first. Long fades shorten to fit; overlapping fades combine.</p>`,
    '<button id="reset-mix">Reset mix</button><span class="spacer"></span><button id="apply-mix" class="primary">Apply mix</button>',
  );
  $("#mix-volume")
    .closest("label")
    .insertAdjacentHTML(
      "beforebegin",
      `<label>Start in track (seconds)<input id="mix-start" type="number" min="0" max="${(track.duration_ms - 1) / 1000}" step="0.001" value="${(track.start_ms || 0) / 1000}"></label><p>Skip the beginning of the song. Waveform, beat markers, playback, and exports use this start time.</p>`,
    );
  const volumeLabel = () => {
    $("#mix-volume-value").textContent = `${$("#mix-volume").value}%`;
  };
  $("#mix-volume").oninput = volumeLabel;
  $("#reset-mix").onclick = () => {
    $("#mix-volume").value = 100;
    $("#mix-muted").checked = false;
    $("#mix-in").value = $("#mix-out").value = 0;
    $("#mix-start").value = 0;
    volumeLabel();
  };
  $("#apply-mix").onclick = async () => {
    if (
      !$("#mix-in").reportValidity() ||
      !$("#mix-out").reportValidity() ||
      !$("#mix-start").reportValidity()
    )
      return;
    const value = {
      volume: Number($("#mix-volume").value) / 100,
      muted: $("#mix-muted").checked,
      fade_in_ms: Math.round(Number($("#mix-in").value) * 1000),
      fade_out_ms: Math.round(Number($("#mix-out").value) * 1000),
    };
    if (
      await commit(() => {
        s.project.audio.mix = value;
        s.project.audio.start_ms = Math.round(
          Number($("#mix-start").value) * 1000,
        );
      })
    )
      d.close();
  };
}

function snapCuts() {
  if (!s.project.audio) return;
  commit(() => {
    let original = 0,
      newStart = 0;
    for (const d of s.project.scenes) {
      original += d.scene.duration_ms;
      const end = Math.max(newStart + 100, Math.round(snapped(original, true)));
      revision(d, "Before snapping cuts");
      retime(d.scene, end - newStart);
      newStart = end;
    }
    s.time = 0;
  });
}
function snapMotion() {
  if (!s.project.audio) return;
  commit(() => {
    let start = 0;
    for (const d of s.project.scenes) {
      revision(d, "Before snapping motion");
      for (const e of d.scene.elements)
        for (const t of e.tracks) {
          const keys = new Map();
          for (const k of t.keyframes) {
            const time = Math.max(
              0,
              Math.min(
                d.scene.duration_ms,
                Math.round(snapped(start + k.time_ms) - start),
              ),
            );
            keys.set(time, { ...k, time_ms: time });
          }
          t.keyframes = [...keys.values()].sort(
            (a, b) => a.time_ms - b.time_ms,
          );
        }
      start += d.scene.duration_ms;
    }
    s.time = 0;
  });
}

async function checkSeams() {
  if (s.busy) return;
  toast("Comparing frames at scene boundaries...");
  try {
    const result = await invoke("check_seams", { project: s.project });
    modal(
      "Scene seams",
      `<p>Pixel difference between each outgoing final frame and the next incoming first frame, measured at 320 px wide. Intentional cuts can have a high difference.</p>${result.map((r, i) => `<div class="revision"><span>${esc(s.project.scenes[i].scene.name)} → ${esc(s.project.scenes[i + 1].scene.name)}</span><strong>${r.toFixed(2)}%</strong></div>`).join("") || "<p>Add a second scene to compare a seam.</p>"}`,
    );
  } catch (e) {
    toast(e, true);
  }
}

function click(e) {
  const b = e.target.closest("button");
  if (!b) return;
  if (s.drag) return;
  if (b.dataset.scene !== undefined) {
    select(Number(b.dataset.scene));
    return;
  }
  if (b.dataset.tab) {
    s.tab = b.dataset.tab;
    refresh();
    return;
  }
  if (b.dataset.mode) {
    pause();
    const global = globalTime();
    s.mode = b.dataset.mode;
    s.time = s.mode === "scene" ? Math.max(0, global - sceneStart()) : global;
    refresh();
    return;
  }
  if (b.dataset.scope) {
    s.scope = b.dataset.scope;
    sidebar();
    return;
  }
  if (b.dataset.prompt) {
    $("#prompt").value = b.dataset.prompt;
    $("#prompt").focus();
    return;
  }
  const action = b.dataset.action;
  if (!action) return;
  if (s.busy && !["play", "present", "cancel", "copy-path"].includes(action)) {
    toast("Finish or cancel the current job first.");
    return;
  }
  const actions = {
    play,
    new: newProject,
    open: () => open(),
    save: () => save(),
    send,
    undo: () => history(),
    redo: () => history(true),
    "edit-selected": () => openInspector(s.layer),
    "edit-text": () => editText(),
    "clear-selection": () => selectLayer(null),
    shortcuts: () =>
      modal(
        "Keyboard shortcuts",
        `<dl class="shortcut-list"><dt>Space</dt><dd>Play or pause</dd><dt>Left / Right</dt><dd>Step one frame when no layer is selected</dd><dt>Arrow keys</dt><dd>Move selected layer by 1 pixel</dd><dt>Shift + Arrow keys</dt><dd>Move selected layer by 10 pixels</dd><dt>Shift + Drag</dt><dd>Move along one axis</dd><dt>Escape</dt><dd>Cancel a drag, deselect, or exit presentation</dd><dt>Command / Ctrl + Z</dt><dd>Undo</dd><dt>Command / Ctrl + Shift + Z</dt><dd>Redo</dd><dt>Command / Ctrl + S</dt><dd>Save project</dd><dt>Command / Ctrl + O</dt><dd>Open project</dd><dt>Command / Ctrl + Enter</dt><dd>${browser ? "Prepare assistant prompt" : "Send prompt"}</dd><dt>Option / Alt + Left / Right</dt><dd>Reorder selected scene</dd></dl><p>Dragging, nudging, and alignment shift the layer's entire position animation. Double-click text to edit its words; use Edit layer for keyframes. Align uses the visible layer bounds at the playhead, with 5% canvas margins. Use the Layer selector to reach overlapping or transparent layers.</p>`,
      ),
    versions,
    "project-settings": openProjectSettings,
    "canvas-settings": () => openProjectSettings(true),
    "refresh-models": () => loadModels(),
    inspector: () => openInspector(),
    images: openImages,
    sounds: () => openSounds(),
    import: () => importAudio(),
    export: exportVideo,
    "export-png": () => exportStill("png"),
    "export-svg": () => exportStill("svg"),
    seams: checkSeams,
    "audio-grid": audioGrid,
    "audio-mix": soundMix,
    "mute-audio": () =>
      commit(() => {
        const track = s.project.audio;
        if (track)
          track.mix = {
            volume: 1,
            fade_in_ms: 0,
            fade_out_ms: 0,
            ...track.mix,
            muted: !track.mix?.muted,
          };
      }),
    "snap-cuts": snapCuts,
    "snap-motion": snapMotion,
    add: () => openTemplates(),
    duplicate: () =>
      commit(() => {
        const copy = clone(doc());
        copy.scene.id = uid();
        copy.scene.name += " copy";
        copy.revisions = [];
        copy.chat = [];
        s.project.scenes.splice(s.selected + 1, 0, copy);
        s.selected++;
        s.time = 0;
      }),
    delete: () => {
      if (s.project.scenes.length > 1)
        commit(() => {
          s.project.scenes.splice(s.selected, 1);
          s.selected = Math.min(s.selected, s.project.scenes.length - 1);
          s.time = 0;
        });
    },
    "clear-chat": () =>
      commit(() => {
        if (s.scope === "scene") doc().chat = [];
        else s.project.chat = [];
      }),
    "remove-audio": async () => {
      if (
        await commit(() => {
          s.project.audio = null;
          s.snap = false;
        })
      )
        setAudio();
    },
    "copy-path": () => {
      if (!s.path) {
        toast("Save your project to give it a file path.");
        return;
      }
      navigator.clipboard
        .writeText(s.path)
        .then(() => toast("Project path copied."))
        .catch((e) => toast(e, true));
    },
    cancel: () => invoke("cancel_job").then(() => toast("Canceling...")),
    present: async () => {
      s.presenting = !s.presenting;
      document.body.classList.toggle("presenting", s.presenting);
      $("#exit-present").classList.toggle("hidden", !s.presenting);
      try {
        await api.window.getCurrentWindow().setFullscreen(s.presenting);
      } catch (e) {
        toast(e, true);
      }
      fitCanvas();
    },
  };
  const result = actions[action]?.();
  if (result?.catch) result.catch((e) => toast(e, true));
}

function openInspector(elementId) {
  if (s.busy) return;
  const current = doc();
  let draft = clone(current.scene);
  let selected = Math.max(
    0,
    draft.elements.findIndex((e) => e.id === elementId),
  );
  const d = modal(
    "Layers & timing",
    `<div class="form-row"><label>Scene name<input id="scene-name" value="${esc(draft.name)}" maxlength="200"></label><label>Duration (ms)<input id="scene-duration" type="number" min="100" max="120000" step="1" value="${draft.duration_ms}"></label></div><div class="form-row"><label>Background<input type="color" id="scene-background" value="${draft.background === "none" ? "#ffffff" : draft.background}"></label><label>New layer<select id="new-layer-kind"><option value="text">Text</option><option value="rect">Rectangle</option><option value="ellipse">Ellipse</option><option value="path">SVG path</option></select></label></div><div class="inspector"><div class="layer-list" id="layer-list"></div><div class="layer-form" id="layer-form"></div></div>`,
    `<button id="add-layer">Add layer</button><button id="remove-layer" class="danger">Remove layer</button><span class="spacer"></span><button id="apply-layers" class="primary">Apply changes</button>`,
    true,
  );
  function draw() {
    $("#layer-list").innerHTML = draft.elements
      .map(
        (e, i) =>
          `<button data-layer="${i}" class="${i === selected ? "active" : ""}" title="${esc(e.id)}" aria-pressed="${i === selected}">${i + 1}. ${esc(e.text?.slice(0, 22) || e.kind)}</button>`,
      )
      .join("");
    document.querySelectorAll("[data-layer]").forEach(
      (b) =>
        (b.onclick = () => {
          selected = Number(b.dataset.layer);
          draw();
        }),
    );
    const el = draft.elements[selected];
    $("#remove-layer").disabled = !el;
    if (!el) {
      $("#layer-form").innerHTML =
        "<p>No layers. Add text or a shape to start.</p>";
      return;
    }
    const number = (property, label, min, step = "1") =>
      `<label>${label}<input type="number" data-prop="${property}" value="${el[property]}" ${min !== undefined ? `min="${min}"` : ""} step="${step}"></label>`;
    $("#layer-form").innerHTML =
      `${el.kind === "text" ? `<label>Text<textarea data-prop="text" rows="2">${esc(el.text)}</textarea></label>` : ""}${el.kind === "path" ? `<label>SVG path data<textarea data-prop="path" rows="2">${esc(el.path)}</textarea></label>` : ""}<div class="form-row three">${number("x", "Center X")}${number("y", el.kind === "text" ? "Baseline Y" : "Center Y")}${number("rotation", "Rotation (deg)", undefined, "0.1")}</div><div class="form-row three">${number("width", "Width", 0)}${number("height", "Height", 0)}${number("radius", "Corner radius", 0)}</div><div class="form-row three">${number("opacity", "Opacity", 0, "0.01")}${number("scale_x", "Scale X", undefined, "0.01")}${number("scale_y", "Scale Y", undefined, "0.01")}</div><div class="form-row three"><label>Fill<input data-prop="fill" value="${esc(el.fill)}" placeholder="#RRGGBB or none"></label><label>Stroke<input data-prop="stroke" value="${esc(el.stroke)}"></label>${number("stroke_width", "Stroke width", 0, "0.5")}</div>${el.kind === "text" ? `<div class="form-row">${number("font_size", "Font size", 1)}${number("font_weight", "Font weight", 100, "100")}</div>` : ""}<p>Keyframes override base values. Times are milliseconds from this scene's start. Each destination keyframe sets the easing into it.</p><div id="tracks"></div><div class="form-row"><label>Animate<select id="track-property">${[
        "x",
        "y",
        "width",
        "height",
        "opacity",
        "rotation",
        "scale_x",
        "scale_y",
      ]
        .filter((p) => !el.tracks.some((t) => t.property === p))
        .map((p) => `<option>${p}</option>`)
        .join(
          "",
        )}</select></label><button id="add-track">Add animation</button></div>`;
    $("#layer-form").insertAdjacentHTML(
      "afterbegin",
      `<div class="layer-actions"><button id="duplicate-layer" ${draft.elements.length >= 250 ? "disabled" : ""}>Duplicate layer</button><button id="layer-back" ${selected === 0 ? "disabled" : ""}>Send backward</button><button id="layer-forward" ${selected === draft.elements.length - 1 ? "disabled" : ""}>Bring forward</button></div><p>Later layers draw in front. Duplicate keeps motion and offsets position by 24 px.</p><div class="form-row"><label>Motion preset<select id="motion-preset">${Object.entries(
        motionPresets,
      )
        .map(([id, name]) => `<option value="${id}">${name}</option>`)
        .join(
          "",
        )}</select></label><button id="apply-preset">Apply preset</button></div><p>Presets use up to 600 ms and replace only their affected tracks. Base values set the final position, scale, and opacity. Other tracks remain unchanged.</p>`,
    );
    if (el.kind === "text")
      $("#layer-form").insertAdjacentHTML(
        "afterbegin",
        `<label>Font family<select data-prop="font_family">${fontOptions(el.font_family)}</select></label>`,
      );
    if (el.kind === "image")
      $("#layer-form").insertAdjacentHTML(
        "afterbegin",
        `<label>Image<select data-prop="image_id">${(s.project.images || []).map((image) => `<option value="${esc(image.id)}" ${image.id === el.image_id ? "selected" : ""}>${esc(image.name)}</option>`).join("")}</select></label><p>Image keeps its proportions inside the width and height. Use Image / logo above the canvas to import another.</p>`,
      );
    $("#duplicate-layer").onclick = () => {
      const copy = clone(el);
      copy.id = uid();
      moveElement(copy, 24, 24);
      draft.elements.splice(selected + 1, 0, copy);
      selected++;
      draw();
    };
    const orderLayer = (delta) => {
      const [layer] = draft.elements.splice(selected, 1);
      selected += delta;
      draft.elements.splice(selected, 0, layer);
      draw();
    };
    $("#layer-back").onclick = () => orderLayer(-1);
    $("#layer-forward").onclick = () => orderLayer(1);
    $("#apply-preset").onclick = () => {
      applyMotionPreset(
        el,
        $("#motion-preset").value,
        draft.duration_ms,
        Math.round(s.project.height * 0.1),
      );
      draw();
    };
    document.querySelectorAll("[data-prop]").forEach(
      (input) =>
        (input.onchange = () => {
          el[input.dataset.prop] =
            input.type === "number" ? Number(input.value) : input.value;
        }),
    );
    $("#tracks").innerHTML = el.tracks
      .map(
        (t, ti) =>
          `<h4>${esc(t.property)} <button class="quiet danger" data-remove-track="${ti}" style="font-size:10px;padding:0 6px">Remove track</button></h4><table class="keyframes"><thead><tr><th>Time (ms)</th><th>Value</th><th>Easing</th><th></th></tr></thead><tbody>${t.keyframes.map((k, ki) => `<tr><td><input type="number" min="0" step="1" data-key="${ti},${ki},time_ms" value="${k.time_ms}" aria-label="${t.property} keyframe ${ki + 1} time"></td><td><input type="number" step="any" data-key="${ti},${ki},value" value="${k.value}" aria-label="${t.property} keyframe ${ki + 1} value"></td><td><select data-key="${ti},${ki},easing" aria-label="${t.property} keyframe ${ki + 1} easing">${["linear", "ease_in", "ease_out", "ease_in_out", "step"].map((e) => `<option ${e === k.easing ? "selected" : ""}>${e}</option>`).join("")}</select></td><td><button data-remove-key="${ti},${ki}" aria-label="Remove keyframe">×</button></td></tr>`).join("")}</tbody></table><button data-add-key="${ti}" style="font-size:11px;margin:7px 0">Add keyframe</button>`,
      )
      .join("");
    document.querySelectorAll("[data-key]").forEach(
      (input) =>
        (input.onchange = () => {
          const [ti, ki, prop] = input.dataset.key.split(",");
          el.tracks[ti].keyframes[ki][prop] =
            prop === "easing" ? input.value : Number(input.value);
        }),
    );
    document.querySelectorAll("[data-remove-track]").forEach(
      (b) =>
        (b.onclick = () => {
          el.tracks.splice(Number(b.dataset.removeTrack), 1);
          draw();
        }),
    );
    document.querySelectorAll("[data-remove-key]").forEach(
      (b) =>
        (b.onclick = () => {
          const [ti, ki] = b.dataset.removeKey.split(",").map(Number);
          el.tracks[ti].keyframes.splice(ki, 1);
          if (!el.tracks[ti].keyframes.length) el.tracks.splice(ti, 1);
          draw();
        }),
    );
    document.querySelectorAll("[data-add-key]").forEach(
      (b) =>
        (b.onclick = () => {
          const track = el.tracks[Number(b.dataset.addKey)];
          const last = track.keyframes.at(-1);
          const time = Math.min(draft.duration_ms, last.time_ms + 250);
          if (time === last.time_ms) {
            toast(
              "Move the last keyframe earlier, or extend scene duration first.",
            );
            return;
          }
          track.keyframes.push({
            time_ms: time,
            value: last.value,
            easing: "ease_out",
          });
          draw();
        }),
    );
    $("#add-track").onclick = () => {
      const property = $("#track-property").value;
      if (!property) return;
      el.tracks.push({
        property,
        keyframes: [
          {
            time_ms: 0,
            value: property === "opacity" ? 0 : el[property],
            easing: "linear",
          },
          {
            time_ms: Math.min(1000, draft.duration_ms),
            value: el[property],
            easing: "ease_out",
          },
        ],
      });
      draw();
    };
  }
  draw();
  $("#scene-duration").onchange = () => {
    const value = Number($("#scene-duration").value);
    if (Number.isInteger(value) && value >= 100 && value <= 120000) {
      retime(draft, value);
      draw();
    } else toast("Duration must be 100 to 120000 milliseconds.", true);
  };
  $("#add-layer").onclick = () => {
    const el = blankScene().scene.elements[0];
    el.kind = $("#new-layer-kind").value;
    if (el.kind !== "text") {
      el.text = "";
      el.width = 240;
      el.height = 160;
      el.fill = "#4c7ff7";
      el.radius = 14;
    }
    if (el.kind === "path") {
      el.path = "M -80 60 L 0 -70 L 80 60 Z";
    }
    draft.elements.push(el);
    selected = draft.elements.length - 1;
    draw();
  };
  $("#remove-layer").onclick = () => {
    draft.elements.splice(selected, 1);
    selected = Math.max(0, selected - 1);
    draw();
  };
  $("#apply-layers").onclick = async () => {
    draft.name = $("#scene-name").value || "Untitled scene";
    draft.background = $("#scene-background").value;
    for (const e of draft.elements)
      for (const t of e.tracks)
        t.keyframes.sort((a, b) => a.time_ms - b.time_ms);
    if (
      await commit(() => {
        const current = doc();
        revision(current, "Before manual layer edit");
        current.scene = clone(draft);
        s.layer = draft.elements[selected]?.id || null;
        s.layerScene = current.scene.id;
        s.time = 0;
      })
    )
      d.close();
  };
}

function change(e) {
  if (e.target.id === "provider") {
    s.provider = e.target.value;
    localStorage.setItem("provider", s.provider);
    loadModels();
  }
  if (e.target.id === "model") {
    s.models[s.provider] = e.target.value.trim();
    localStorage.setItem("models", JSON.stringify(s.models));
    modelPicker();
  }
  if (e.target.id === "effort") {
    s.efforts[`${s.provider}:${s.models[s.provider] || ""}`] = e.target.value;
    localStorage.setItem("efforts", JSON.stringify(s.efforts));
  }
  if (e.target.id === "snap") s.snap = e.target.checked;
  if (e.target.id === "fps")
    commit(() => {
      s.project.fps = Number(e.target.value);
    });
}
function keys(e) {
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  const cmd = e.metaKey || e.ctrlKey;
  if (s.drag) {
    if (e.key === "Escape") {
      e.preventDefault();
      finishDrag(false);
    }
    return;
  }
  if (e.key === "Escape" && s.presenting) {
    $('[data-action="present"]').click();
    return;
  }
  if (document.querySelector("dialog[open]")) return;
  if (cmd && e.key === "Enter" && $("#prompt")) {
    e.preventDefault();
    send();
    return;
  }
  if (cmd && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save(e.shiftKey);
    return;
  }
  if (cmd && e.key.toLowerCase() === "o") {
    e.preventDefault();
    open();
    return;
  }
  if (cmd && e.key.toLowerCase() === "n") {
    e.preventDefault();
    newProject();
    return;
  }
  if (typing) return;
  if (e.key === "Escape" && s.layer) {
    e.preventDefault();
    selectLayer(null);
    return;
  }
  if (
    selectedElement() &&
    !s.presenting &&
    !e.altKey &&
    !cmd &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
  ) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    moveSelected(
      e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
      e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
    );
    return;
  }
  if (cmd && e.key.toLowerCase() === "z") {
    e.preventDefault();
    history(e.shiftKey);
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    play();
  }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    if (e.altKey) {
      reorder(
        s.selected,
        Math.max(0, Math.min(s.project.scenes.length - 1, s.selected + delta)),
      );
    } else seek(s.time + (delta * 1000) / s.project.fps);
  }
  if (e.key === "Home") {
    e.preventDefault();
    seek(0);
  }
}

async function start() {
  if (!api) {
    $("#app").innerHTML =
      '<p class="loading">Open Storyboard.app, or run <code>bun run dev</code>. This editor uses its native Rust backend.</p>';
    return;
  }
  const boot = await invoke("bootstrap");
  s.project = boot.project;
  s.providers = boot.providers;
  s.ffmpeg = boot.ffmpeg;
  s.recovered = boot.recovered;
  s.dirty = boot.recovered;
  s.time = Math.min(1200, doc().scene.duration_ms);
  shell();
  setAudio();
  refresh();
  if (boot.warning) toast(boot.warning, true);
  loadModels();
  await api.event.listen("export-progress", ({ payload }) => {
    if ($("#export-progress"))
      $("#export-progress").style.width = `${payload * 100}%`;
    if ($("#export-status"))
      $("#export-status").textContent =
        `Rendering ${Math.round(payload * 100)}%`;
  });
  await api.webview.getCurrentWebview().onDragDropEvent(({ payload }) => {
    document.body.classList.toggle(
      "drop-over",
      payload.type === "enter" || payload.type === "over",
    );
    if (payload.type === "drop") {
      document.body.classList.remove("drop-over");
      const path = payload.paths[0];
      if (/\.(storyboard|json)$/i.test(path)) open(path);
      else importAudio(path);
    }
  });
  if (browser) {
    window.addEventListener("beforeunload", (event) => {
      if (s.dirty || s.busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        pause();
        persist();
      }
    });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && s.presenting) {
        s.presenting = false;
        document.body.classList.remove("presenting");
        $("#exit-present").classList.add("hidden");
        fitCanvas();
      }
    });
    return;
  }
  await api.window.getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    s.closing = true;
    pause();
    await invoke("cancel_model_discovery");
    await Promise.allSettled(Object.values(s.modelRequests));
    if (s.busy) {
      await invoke("cancel_job");
      await s.jobPromise.catch(() => {});
    }
    try {
      await persist();
      await api.window.getCurrentWindow().destroy();
    } catch {
      s.closing = false;
      toast(
        "Recovery could not be saved. Save your project before closing.",
        true,
      );
    }
  });
}
start().catch((e) => {
  console.error(e);
  $("#app").innerHTML =
    `<p class="loading">Storyboard could not open: ${esc(e)}</p>`;
});
