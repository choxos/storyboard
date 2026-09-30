# Storyboard

A local macOS motion graphics editor, built with Rust and Tauri. Prompt Claude or Codex scene by scene, adjust animation to the millisecond, bring in a soundtrack, and export an MP4.

Inspired by [Caleb Porzio's editor](https://x.com/calebporzio/status/2104945478055989489). This is an independent implementation using the supplied screenshot and walkthrough as workflow references.

## Run

Requires macOS 12+, stable Rust (tested with 1.98.1), Xcode Command Line Tools, and Bun. FFmpeg is needed for audio analysis and MP4 export. Install and sign in to either or both AI CLIs:

```sh
brew install ffmpeg
claude auth login
codex login
bun install --frozen-lockfile
bun run dev
```

The editor, manual layer tools, project files, and preview work without an AI login. AI requests use your CLI account and its usage limits. Storyboard does not collect or store API keys. The selected scene or project, recent conversation, art direction, and audio timing metadata are sent to the selected provider. Audio samples are not uploaded.

Build an application bundle:

```sh
bun run build
open src-tauri/target/release/bundle/macos/Storyboard.app
```

The bundle is built for the current Mac architecture. It is locally signed, not notarized for distribution. Finder-launched apps find `claude`, `codex`, and `ffmpeg` in PATH, `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`, or `/usr/local/bin`.

## Edit

- **Scene / Project:** prompt one scene or generate and revise the entire storyboard. Pick Claude or Codex beside Send, then choose a model from the provider's current catalog or use **CLI default**. Model selection is remembered separately for each provider.
- **Thinking effort:** choose an explicit model to see the effort levels its CLI reports. Choices are remembered per provider and model. **CLI default** leaves effort unchanged. Higher effort can take longer and use more quota; models without effort support keep their default behavior.
- **Layers & timing:** edit text, shapes, colors, geometry, and keyframe times, values, and easing. Double-click a visible layer to open its inspector. Duration edits proportionally retime existing keyframes.
- **Versions / Undo:** restore previous scene revisions; undo project changes. Up to 50 saved revisions and 100 chat messages per scene. Project undo holds 30 changes for the current session.
- **Filmstrip:** add, duplicate, delete, drag to reorder, or use Option+Left/Right to move the selected scene.
- **This scene / Whole video:** loop the current scene or play the sequence. The numeric playhead accepts exact milliseconds. Space plays or pauses. Arrow keys step by a frame. Present enters fullscreen; Escape returns.
- **Canvas:** choose from 47 grouped sizes for landscape video, portrait, square, social posts and banners, cinema, ultrawide, and presentations, from SD through 8K. Custom dimensions cover other sizes. Existing layers, animation coordinates, and saved revisions scale to fit. Changes can be undone.
- **Art direction:** set the visual brief, project name, canvas size, and frame rate.
- **Check seams:** compare outgoing and incoming boundary frames. High pixel differences may be intentional cuts, not errors.

## Live models

Model choices are requested when the app opens, when the provider changes, and when you click **Refresh models**. Storyboard starts a fresh CLI process and asks Codex's [`model/list`](https://developers.openai.com/codex/app-server/#list-models-modellist) RPC or Claude's [Agent SDK initialization catalog](https://platform.claude.com/docs/en/agent-sdk/typescript). Codex pagination is followed. Claude aliases display their resolved model when provided.

There is no bundled list of model names or fallback catalog. Availability comes from the installed CLI and its authenticated account, including that CLI's own catalog caching and rollout rules. Update the CLI if its catalog differs from newly announced releases. Refresh failures appear beside the selector; stale choices are not presented as a successful refresh. Model discovery does not send a prompt or generate a completion, and Storyboard does not read authentication credentials. Only the last selected model ID is saved, not the catalog.

## Sound and rhythm

Drop a local audio file into the window or choose **Add a soundtrack**. WAV, MP3, M4A, AAC, AIFF, and FLAC are supported by the importer; playback depends on macOS WebKit's codec support.

Rust analyzes an onset envelope to estimate tempo and downbeat phase. Strong changes in bar energy suggest section boundaries. These are editable heuristics, not guaranteed musical transcription. Silence and weak rhythms produce low confidence. Use **Beat grid** to correct BPM, beats per bar, downbeat offset, and section markers.

**Snap cuts** aligns scene ends to estimated downbeats and retimes their animation. **Snap motion** aligns keyframes to the global beat grid, including each scene's start offset. Colliding keyframes merge, keeping the last value. Both operations can be undone. The Snap checkbox also snaps timeline dragging.

## Save and render

Command+S saves a `.storyboard` JSON project. Command+Shift+S saves a copy; Command+O opens one. Files include scene data, chat, versions, and audio analysis. Audio is linked by path, not embedded. Keep the original audio available, or use Replace to relink it.

Edits also save a recovery project in macOS Application Support under `dev.storyboard.studio`. Reopening restores it. Explicit project saves and recovery writes use atomic file replacement. Invalid data is rejected before replacement.

**Render → Export MP4** exports H.264 with AAC audio at the project resolution and frame rate. Short soundtracks receive silence padding; long soundtracks are trimmed to video duration. The final destination is replaced only after successful encoding. Preview SVG and exported frames share the same Rust interpolation and scene renderer. Text rasterization can differ slightly between WebKit and resvg.

## Scene format and limits

Scenes contain text, rectangles, ellipses, and SVG paths with tracks for position, size, opacity, rotation, and scale. Text uses Arial. Colors are `#RRGGBB` or `none`. Elements use center coordinates; text uses a centered baseline; paths use local SVG coordinates. The destination keyframe determines interval easing. Frames outside a track hold its first or last value.

AI output is schema constrained and validated before application. It cannot insert executable HTML or JavaScript into the preview. Claude runs with tools, MCP servers, hooks, and session persistence disabled. Codex runs in an ephemeral temporary directory with a read-only sandbox and user configuration disabled.

This version is a vector motion editor. It does not execute arbitrary generated web apps, import video or image layers, or offer 3D compositing. Limits: 100 scenes, 250 elements per scene, 10-minute projects and audio, 2-minute individual scenes, and 20 MB project files. Canvas dimensions must be even, 64–8192 pixels per side, with at most 35,389,440 pixels total (8192 × 4320, or its portrait equivalent). Frame rates: 24, 30, 60. Large canvases increase rendering time and memory use. Presets use square pixels and are not an exhaustive catalog of every platform's changing requirements.

## Verify

Checked on Apple Silicon on September 29, 2026: nine Rust tests and one JavaScript test passed, Clippy passed with warnings denied, and the release bundle passed strict code-signature verification. Real Claude and Codex requests each produced a validated scene edit with an explicit model and low effort. Live CLI catalogs supplied models and their supported effort levels. Native checks covered save/recovery, revisions, undo, exact seeking, audio import and calibration, snapping, playback across scene boundaries, seam comparison, and MP4 export with H.264/AAC. Canvas checks covered portrait, square, custom dimensions, and rejection of odd sizes. Separate exports verified 1080 × 1920 and 1080 × 1080 H.264 frames; an 8192 × 4320 PNG rendered successfully.

On this machine, Claude 2.1.285 model discovery succeeded from the terminal but repeatedly timed out during initialization in the Finder-launched app. The app reports that failure without replacing the catalog with a prepared list or losing the current prompt. Codex discovery and effort selection worked in the native app. Similar Claude startup hangs are reported upstream ([launchd startup](https://github.com/anthropics/claude-code/issues/76052), [blocked file open](https://github.com/anthropics/claude-code/issues/89272)); these reports do not establish the exact cause on this machine. Claude's native flow remains unverified beyond the visible timeout handling. A longer Codex project-wide request was canceled; cancellation preserved the project and prompt. Full-project AI generation has not been verified end to end.

```sh
bun run test
bun run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Dialog regression check: make an unsaved edit, open **Art direction → Load example**, and choose **Cancel**. The edit must remain. Repeat and choose **Discard changes**. The four-scene, 16-second example must load with no soundtrack. This checks that closing the settings dialog cannot cancel the new confirmation.

The executable also exposes small headless tools for reproducible rendering and integration checks:

```sh
src-tauri/target/debug/storyboard --help
src-tauri/target/debug/storyboard --models claude
src-tauri/target/debug/storyboard --models codex
src-tauri/target/debug/storyboard --demo /tmp/demo.storyboard
src-tauri/target/debug/storyboard --check /tmp/demo.storyboard
src-tauri/target/debug/storyboard --render /tmp/demo.storyboard 1500 /tmp/frame.png
src-tauri/target/debug/storyboard --export /tmp/demo.storyboard /tmp/demo.mp4
```

`--analyze AUDIO` prints audio timing JSON. `--generate claude|codex PROJECT PROMPT OUTPUT [MODEL [EFFORT]]` runs a real provider edit on the first scene and saves the result to OUTPUT. It uses the account's normal quota. Effort reaches Claude through `--effort` and Codex through `model_reasoning_effort`; neither is overridden when **CLI default** is selected.

Source layout: `src-tauri/src/model.rs` defines and validates project data; `render.rs` evaluates keyframes and draws SVG; `audio.rs` estimates timing; `ai.rs` calls providers; `export.rs` renders MP4; `storage.rs` writes projects; `lib.rs` connects native commands. `ui/` contains the WebKit interface without a frontend framework.
