import type { Project, Reply } from "./model";
import { parseReply } from "./model";
import { download, pickFile } from "./files";

export function composePrompt(
  project: Project,
  index: number | null,
  request: string,
): string {
  const scenes =
    index === null
      ? project.scenes.map((d) => d.scene)
      : [project.scenes[index].scene];
  const audio = project.audio
    ? { ...project.audio, path: undefined, peaks: undefined }
    : null;
  return `You are editing vector motion graphics in Storyboard. Return only a JSON object with exactly two fields: summary (string) and scenes (array of scene objects).
${index === null ? "Return ALL scenes in playback order, maximum 100 scenes and 10 minutes total." : "Return exactly ONE scene and preserve its ID."}
Canvas: ${project.width} x ${project.height}. Art direction: ${project.art_direction}
Each scene has exactly: id (unique string), name (string), duration_ms (integer 100..120000), background (#RRGGBB or none), elements (array, maximum 250).
Every element must include all fields: id (unique string), kind (text|rect|ellipse|path), text (string), path (SVG path data string), x, y, width, height, fill, stroke, stroke_width, font_size, font_weight, radius, opacity, rotation, scale_x, scale_y, tracks.
Geometry is numeric. x/y are center coordinates; text uses centered x and baseline y. Paths use local coordinates. Colors are #RRGGBB or none. font_size is 1..1000, font_weight is integer 100..900, opacity is 0..1, sizes and radius are nonnegative. Use Arial. Set unused text/path to empty strings. Typical defaults: stroke=none, stroke_width=1, font_size=64, font_weight=700, radius=0, opacity=1, rotation=0, scale_x=1, scale_y=1, tracks=[].
Each track has exactly property (x|y|width|height|opacity|rotation|scale_x|scale_y) and keyframes. Each keyframe has exactly time_ms (integer), value (number), easing (linear|ease_in|ease_out|ease_in_out|step). Times strictly increase within scene duration; 1..100 keys per track; one track per property. Destination keyframe controls cubic easing. Hold first/last value outside keys. Preserve unrelated content and existing IDs. No scripts, HTML, URLs, images, tools, commands, or external resources.
Current scenes: ${JSON.stringify(scenes)}
Recent conversation: ${JSON.stringify((index === null ? project.chat : project.scenes[index].chat).slice(-8))}
Audio timing: ${JSON.stringify(audio)}
Request: ${request}`;
}
export function assistant(
  project: Project,
  index: number | null,
  prompt: string,
  provider: string,
  signal: AbortSignal,
): Promise<Reply> {
  if (!prompt.trim() || prompt.length > 20000)
    return Promise.reject(new Error("Use a prompt of 1 to 20,000 characters."));
  const prepared = composePrompt(project, index, prompt);
  return new Promise((resolve, reject) => {
    const dialog = document.createElement("dialog");
    dialog.className = "wide";
    dialog.id = "browser-assistant";
    dialog.innerHTML = `<div class="modal-head"><h2>Use ${provider === "codex" ? "Codex" : "Claude"}</h2><button id="assistant-close" aria-label="Close assistant">Close</button></div><div class="modal-body"><p>1. Copy this prompt into your chosen assistant. Choose model and effort there.</p><label>Prepared prompt<textarea id="prepared-prompt" rows="5" readonly></textarea></label><div class="form-row"><button id="copy-prompt">Copy prompt</button><button id="download-prompt">Download prompt</button></div><p>2. Paste the JSON response below, or load its JSON file. Review the new revision in your scene; Undo restores the previous version.</p><label>Assistant response<textarea id="assistant-response" rows="8" placeholder='{"summary":"What changed","scenes":[...]}'></textarea></label><p id="assistant-error" role="status" aria-live="polite"></p><p>Your project stays in this browser until you copy or download it. This website does not call an AI service or need API keys.</p></div><div class="modal-foot"><button id="load-response">Load JSON file</button><span class="spacer"></span><button id="apply-response" class="primary">Apply response</button></div>`;
    document.body.append(dialog);
    const field = <T extends HTMLElement>(selector: string) =>
      dialog.querySelector<T>(selector)!;
    field<HTMLTextAreaElement>("#prepared-prompt").value = prepared;
    const message = (text: string) => {
      field("#assistant-error").textContent = text;
    };
    field("#copy-prompt").onclick = async () => {
      try {
        await navigator.clipboard.writeText(prepared);
        message("Prompt copied. Paste it into your assistant.");
      } catch {
        field<HTMLTextAreaElement>("#prepared-prompt").select();
        message(
          "Clipboard unavailable. Copy the selected prompt manually or download it.",
        );
      }
    };
    field("#download-prompt").onclick = () => {
      download(
        new Blob([prepared], { type: "text/plain" }),
        "storyboard-prompt.txt",
      );
    };
    field("#load-response").onclick = async () => {
      try {
        const file = await pickFile(".json,.txt");
        if (file) {
          if (file.size > 20000000) throw new Error("Response is too large.");
          field<HTMLTextAreaElement>("#assistant-response").value =
            await file.text();
        }
      } catch (e) {
        message(String(e));
      }
    };
    field("#apply-response").onclick = () => {
      try {
        const reply = parseReply(
          field<HTMLTextAreaElement>("#assistant-response").value,
          project,
          index,
        );
        resolve(reply);
        dialog.close();
      } catch (e) {
        message(String(e));
      }
    };
    field("#assistant-close").onclick = () => dialog.close();
    const abort = () => dialog.close();
    signal.addEventListener("abort", abort, { once: true });
    dialog.addEventListener(
      "close",
      () => {
        signal.removeEventListener("abort", abort);
        dialog.remove();
        reject(
          new Error("Assistant closed. Your prompt and project are preserved."),
        );
      },
      { once: true },
    );
    dialog.showModal();
  });
}
