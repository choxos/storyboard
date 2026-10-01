# Storyboard

A motion graphics editor for the browser and macOS. Build a storyboard, edit text, images, vector layers, and keyframes, add music and timed sound effects, and export video. Work with Claude or Codex scene by scene, or edit everything by hand.

**[Open the web editor](https://choxos.github.io/storyboard/)** · [Run the macOS app](#macos-app) · [Develop the web version](#web-development)

|                | Browser                                                               | macOS                                                    |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| Engine         | TypeScript, SVG, Canvas, Web Audio                                    | Rust, Tauri, resvg, FFmpeg                               |
| Editing        | Direct dragging, motion presets, layers, keyframes, 47 canvas presets | Same editor and project format                           |
| Claude / Codex | Copy a prepared prompt and paste the JSON response                    | Direct CLI requests with live model and effort lists     |
| Audio          | Local files decoded by your browser; editable beat estimates          | Local files decoded with FFmpeg; editable beat estimates |
| Video          | MP4 when supported, otherwise WebM; real-time recording up to 4K      | Frame-exact H.264/AAC MP4, up to 8K canvas limits        |
| Still frames   | Full-resolution PNG and SVG at the playhead                           | Same formats with atomic file replacement                |
| Storage        | Project downloads and IndexedDB recovery                              | Project files and atomic local recovery                  |

No application server, account, or API key is needed for the web editor. Project content and audio stay in your browser until you choose to copy or download them. GitHub Pages serves the static application files.

Inspired by [Caleb Porzio's editor](https://x.com/calebporzio/status/2104945478055989489). This is an independent implementation using the supplied screenshot and walkthrough as workflow references.

## Browser workflow

1. Choose **New project**, pick a canvas and an editable scene template, or open a `.storyboard` file from the desktop app. **Add scene** offers the same layouts without replacing your project.
2. Double-click text to change its words, font, size, weight, and color. Use **Image / logo** to import PNG, JPEG, or WebP. Drag layers or use **Align to canvas** to place them. Use **Layers & timing** for shapes, stacking order, motion presets, and exact animation. **Canvas** offers 47 common formats and custom dimensions.
3. For AI edits, choose Claude or Codex, describe the change, and click **Prepare prompt**. Context includes the current playhead and available assets. With **Include rendered frame review** enabled, download the sample sheet and attach it with the prompt. Paste the JSON response, then **Preview response & prepare review** to see candidate frames and prepare another visual review. Apply when satisfied. Invalid responses are rejected, and applied edits create a revision and can be undone.
4. Add a local soundtrack. Set its start position, **Volume**, mute, and fades, then review estimated tempo and downbeats in **Beat grid** before snapping cuts or motion. **Sound effects** adds presets or imported clips at the playhead, with editable timing, trim, volume, and pitch.
5. **Save** downloads an editable project. **Render** records video with progress and cancellation, or saves the current frame as PNG or SVG. Keep the tab visible while recording video.

GitHub Pages cannot launch desktop CLIs. Direct AI calls and live CLI catalogs belong to the macOS app. The browser edition deliberately asks for no API keys.

Browser video format is detected through [`MediaRecorder.isTypeSupported`](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static). Recording runs in real time, and frame cadence depends on device load. The project frame rate is the requested capture rate, not a frame-exact encoding guarantee. Browser export accepts at most 3840 pixels per side and 8,294,400 total pixels. Larger canvases remain editable; use the desktop app to render them. Codec availability, audio import formats, and fullscreen behavior vary by browser. Desktop Chrome or Edge is recommended for recording; narrow screens support editing in a stacked layout.

Recovery, including imported audio, is stored in IndexedDB for this site and browser profile. Clearing site data removes it. Download project copies regularly. `.storyboard` downloads embed images and short sound effects. The full soundtrack remains linked; use **Replace** to relink it after opening a downloaded project. Browser downloads contain the soundtrack filename instead of a native absolute path.

## Web development

Requires Bun 1.3.14 or newer. No Rust or FFmpeg installation is needed for this build.

```sh
bun install --frozen-lockfile
bun run dev:web
# Open http://127.0.0.1:4173/storyboard/
```

`dev:web` builds once and serves locally. Rerun `bun run build:web` and reload after edits.

```sh
bun run test:web
bun run check:web
bun run build:web
```

The build produces `dist/`, with relative URLs for repository subpaths. TypeScript browser modules are checked in strict mode; the existing JavaScript UI is shared with the desktop app. No frontend framework or runtime dependency is required.

### GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) tests and builds the browser edition, uploads `dist/`, and deploys through GitHub Pages on pushes to `main` or manual dispatch. In a fork, choose **Settings → Pages → Build and deployment → Source: GitHub Actions**, then run **Publish browser editor**. See GitHub's [custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## macOS app

Requires macOS 12+, stable Rust (tested with 1.98.1), Xcode Command Line Tools, and Bun. FFmpeg is needed for audio analysis and MP4 export. Install and sign in to either or both AI CLIs:

```sh
brew install ffmpeg
claude auth login
codex login
bun install --frozen-lockfile
bun run dev
```

The editor, manual layer tools, project files, and preview work without an AI login. AI requests use your CLI account and its usage limits. Storyboard does not collect or store API keys. The selected scene or project, recent conversation, art direction, playhead, asset names, and audio timing metadata are sent to the selected provider. **Review rendered frames** also sends rendered images, including visible imported images, and uses two AI requests: an edit followed by visual review of the candidate. Disable it for a text-only single request. Audio samples are not uploaded.

Build an application bundle:

```sh
bun run build
open src-tauri/target/release/bundle/macos/Storyboard.app
```

The bundle is built for the current Mac architecture. It is locally signed, not notarized for distribution. Finder-launched apps find `claude`, `codex`, and `ffmpeg` in PATH, `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`, or `/usr/local/bin`.

## Shared editing tools

- **Scene templates:** opening title, announcement, quote, big number, three steps, and call to action, plus a blank scene. Pick an accent color and preview each layout. Templates adapt to landscape, square, and portrait canvases, use editable vector layers, and include starter motion. Canceling leaves the current project intact; adding a scene can be undone.
- **Quick text editing:** double-click visible text or select a text layer and choose **Edit text**. Change words, line breaks, font family, size, weight, and color while keeping position and animation. Choose Arial, Georgia, Times New Roman, Courier New, Verdana, or Trebuchet MS. Fonts use the system installation; unavailable fonts may fall back. Changes create a saved revision and one undo step.
- **Images and logos:** import PNG, JPEG, or WebP through **Image / logo**, or reuse an existing project image. Imports normalize to embedded PNG, preserve transparency, and fit within 2048 pixels per side. Image layers support the same transforms and motion tracks as shapes. Images stay in the project for saved revisions even after a layer is removed.
- **Rendered frame review:** native Claude and Codex receive beginning, playhead, and final-frame samples of the chosen scope, then inspect candidate samples before returning the final edit. Repeated sample times merge. The browser prepares downloadable labeled sheets and review prompts for manual exchange. This checks sampled visuals, not every frame or audio quality.
- **Scene / Project:** prompt one scene or revise the entire storyboard. Browser users exchange JSON through **Prepare prompt**. In the macOS app, pick Claude or Codex beside Send, then choose a live model or **CLI default**.
- **Thinking effort (macOS):** choose an explicit model to see effort levels reported by its CLI. Choices are remembered per provider and model. **CLI default** leaves effort unchanged. Higher effort can take longer and use more quota; models without effort support keep their default behavior.
- **Layers & timing:** edit text, images, shapes, colors, geometry, and keyframe times, values, and easing. **Edit layer** opens the selected layer's inspector; double-clicking a shape also opens it. Duration edits proportionally retime existing keyframes and sound cue start times.
- **Canvas editing:** click a layer to select it, then drag it to move. Arrow keys nudge by 1 pixel; Shift+Arrow nudges by 10. Shift constrains a drag to one axis. Escape cancels a drag or deselects. Moves shift the entire position animation and create one undo step per drag. The **Layer** selector reaches overlapping and transparent layers.
- **Alignment:** center a selected layer horizontally, vertically, or both, or align to a 5% left, right, top, or bottom canvas margin. Alignment uses its visible bounds at the current playhead, including transforms and multiline text, and moves the entire position animation together.
- **Layer order:** duplicate the selected layer with its motion and a 24-pixel offset. **Send backward** and **Bring forward** change stacking order. Later layers draw in front.
- **Motion presets:** **Fade in**, **Slide up**, **Pop in**, and **Fade out** create up to 600 ms of motion. They replace only affected tracks, preserve other animation, and use the layer's base position, scale, and opacity. Fade out ends at the scene boundary. Short scenes use their full duration.
- **Versions / Undo / Redo:** restore previous scene revisions or undo and redo project changes. Up to 50 saved revisions and 100 chat messages per scene. Project undo holds 30 changes for the current session. **Keyboard shortcuts** in the status bar lists playback, editing, and file controls.
- **Filmstrip:** add, duplicate, delete, drag to reorder, or use Option+Left/Right to move the selected scene.
- **This scene / Whole video:** loop the current scene or play the sequence. The numeric playhead accepts exact milliseconds. Space plays or pauses. Left/Right step by a frame when no layer is selected. Present enters fullscreen; Escape returns.
- **Canvas:** choose from 47 grouped sizes for landscape video, portrait, square, social posts and banners, cinema, ultrawide, and presentations, from SD through 8K. Custom dimensions cover other sizes. Existing layers, animation coordinates, and saved revisions scale to fit. Changes can be undone.
- **Art direction:** set the visual brief, project name, canvas size, and frame rate.
- **Check seams:** compare outgoing and incoming boundary frames. High pixel differences may be intentional cuts, not errors.
- **Still frames:** **Render → Save PNG frame / Save SVG frame** exports the selected scene at the playhead using full canvas resolution. Selection outlines and editor controls are excluded. PNG and SVG preserve a transparent scene background (`none`).

## Live models on macOS

Model choices are requested when the app opens, when the provider changes, and when you click **Refresh models**. Storyboard starts a fresh CLI process and asks Codex's [`model/list`](https://developers.openai.com/codex/app-server/#list-models-modellist) RPC or Claude's [Agent SDK initialization catalog](https://platform.claude.com/docs/en/agent-sdk/typescript). Codex pagination is followed. Claude aliases display their resolved model when provided.

There is no bundled list of model names or fallback catalog. Availability comes from the installed CLI and its authenticated account, including that CLI's own catalog caching and rollout rules. Update the CLI if its catalog differs from newly announced releases. Refresh failures appear beside the selector; stale choices are not presented as a successful refresh. Model discovery does not send a prompt or generate a completion, and Storyboard does not read authentication credentials. Only the last selected model ID is saved, not the catalog.

## Sound and rhythm

Drop a local audio file into the window or choose **Add a soundtrack**. WAV, MP3, M4A, AAC, AIFF, and FLAC are supported by the importer; playback depends on macOS WebKit's codec support.

**Volume** opens soundtrack start position, level (0–100%), mute, fade in, and fade out controls. **Start in track** skips the beginning of the source file and shifts waveform, beat markers, playback, and export together. Beat-grid offsets and section boundaries remain in source-file time. Preview and video export use the same linear fade rules. Fade in starts at the beginning of the video; fade out ends at the earlier of the remaining soundtrack or video end. Long fades shorten to fit, and overlapping fades multiply. **Reset mix** resets the dialog; **Apply mix** saves it. Mix changes support undo, recovery, and project saves. Older projects open from the start, at full volume with no fades.

**Sound effects** offers Click, Pop, Ding, Whoosh, Impact, and Riser presets, plus imported clips up to 15 seconds. Imports normalize to embedded 24 kHz PCM WAV, preserving up to two channels. Add cues at the scene playhead, then edit their scene-relative start, source trim, maximum duration, level, and pitch from -12 to +12 semitones. Pitch changes playback speed and available duration. A cue ends at the shorter of its duration limit or remaining source; tails can cross cuts and end at the video boundary. Cues move with their scene, have visible timeline markers, and support undo and revisions. Muting the soundtrack leaves effects audible. Overlapping sounds add together, so lower levels if the mix clips.

Both engines analyze an onset envelope to estimate tempo and downbeat phase. Strong changes in bar energy suggest section boundaries. These are editable heuristics, not guaranteed musical transcription. Silence and weak rhythms produce low confidence. Use **Beat grid** to correct BPM, beats per bar, downbeat offset, and section markers.

**Snap cuts** aligns scene ends to estimated downbeats and retimes their animation. **Snap motion** aligns keyframes to the global beat grid, including each scene's start offset. Colliding keyframes merge, keeping the last value. Both operations can be undone. The Snap checkbox also snaps timeline dragging.

## Save and render on macOS

Command+S saves a `.storyboard` JSON project. Command+Shift+S saves a copy; Command+O opens one. Files include scene data, chat, versions, audio analysis, embedded images, and embedded sound effects. The soundtrack is linked by path. Keep the original soundtrack available, or use Replace to relink it.

Edits also save a recovery project in macOS Application Support under `dev.storyboard.studio`. Reopening restores it. Explicit project saves and recovery writes use atomic file replacement. Invalid data is rejected before replacement.

**Render → Export MP4** exports H.264 with AAC audio at the project resolution and frame rate. Short soundtracks receive silence padding; long soundtracks are trimmed to video duration. The final destination is replaced only after successful encoding. Preview SVG and exported frames share the same Rust interpolation and scene renderer. Text rasterization can differ slightly between WebKit and resvg.

## Scene format and limits

Scenes contain text, images, rectangles, ellipses, and SVG paths with tracks for position, size, opacity, rotation, and scale. Text defaults to Arial. Colors are `#RRGGBB` or `none`. Elements use center coordinates; text uses a centered baseline; paths use local SVG coordinates. The destination keyframe determines interval easing. Frames outside a track hold its first or last value.

Scene data and AI responses are validated before application. They cannot insert executable HTML or JavaScript into the preview. Desktop AI output is schema constrained. Desktop Claude runs with tools, MCP servers, hooks, and session persistence disabled. Desktop Codex runs in an ephemeral temporary directory with a read-only sandbox and user configuration disabled.

This version does not execute arbitrary generated web apps, import video, synthesize music with AI, load custom font files, or offer 3D compositing. Limits: 100 scenes, 250 elements per scene, 10-minute projects and soundtracks, 2-minute individual scenes, and 20 MB project files. Embedded media shares a 12 MB encoded-data budget, with up to 40 images and 40 sound clips. Each image supports up to 4 million pixels and 4096 pixels per side; the importer produces at most 2048 per side. Effects support 64 cues per scene and 200 per project. Canvas dimensions must be even, 64–8192 pixels per side, with at most 35,389,440 pixels total (8192 × 4320, or its portrait equivalent). Frame rates: 24, 30, 60. Large canvases increase rendering time and memory use. Presets use square pixels and are not an exhaustive catalog of every platform's changing requirements.

## Verify

Media and visual-review checks on September 30, 2026: thirteen web tests and thirteen Rust tests passed, with strict TypeScript compilation, Clippy with warnings denied, and formatting checks. Browser checks covered image import and reuse, font changes, sound imports and cue editing, undo, soundtrack offsets, project downloads, and the two-stage visual review exchange, including invalid-response rejection and cancellation. Native UI checks covered image import, Georgia text, sound import, cue trim/length/volume/pitch, soundtrack start position, and recovery after restart. Desktop and 390 × 844 browser layouts were inspected. Corrupt embedded images were rejected without replacing the current project.

Decoded browser and native exports verified an 880 Hz soundtrack after skipping the first second of a test clip, a 1760 Hz effect after a +12-semitone shift, half-volume cue output, and silence outside the intended ranges. A native export of the UI's recovered project was exactly 16 seconds, with the effect starting at 1.2 seconds. The browser recordings differed from their nominal two-second duration by up to 0.248 seconds under test load. Browser project downloads containing images and sounds passed the Rust validator. The release bundle passed strict code-signature verification.

Real Claude and Codex headless requests each identified the color of an embedded image from rendered pixels, edited the scene, and completed a second rendered-frame review. The desktop UI's Codex request stalled during CLI startup before connecting, both from Finder and after a terminal launch; cancellation preserved the project and prompt. A process sample showed a blocked filesystem directory read, but its underlying cause is unresolved. Native UI AI completion is therefore unverified for this change; headless provider checks and the browser's manual review flow passed.

Creator workflow checks on September 30, 2026: ten web tests and eleven Rust tests passed, along with strict TypeScript compilation and Clippy with warnings denied. Browser checks exercised all six templates plus blank, portrait sizing, custom accent, multiline text without changing motion, all seven alignment actions at an animated frame, and undo/cancel. Native UI checks covered template creation and cancellation, physical double-click text editing, centering, soundtrack import, volume/fade settings, mute, and playback. Desktop and 390 × 844 browser layouts were inspected.

Decoded browser exports measured a 0.2499 level ratio for a 25% mix, attenuation during both fades, and zero signal when muted. Audio export now follows the audio clock to avoid truncation under load. A native export from the UI's recovered project measured a 0.4994 ratio for a 50% mix, both fades, and silence after the two-second soundtrack ended. Rust integration checks also cover older projects without mix settings and decoded PNG alpha. The macOS release bundle passed strict code-signature verification. Browser video remains real-time recording; codec delay and packet boundaries can shift audible fade endpoints by tens of milliseconds. Use the native export when exact timing matters.

Shared editing checks on September 30, 2026: seven web tests and ten Rust tests passed, together with strict TypeScript compilation and Clippy with warnings denied. Browser interaction checks covered direct selection, nudging, drag commit and cancellation, axis locking, duplication, stacking order, visible undo/redo, and all four presets at their start and end times. PNG and SVG downloads matched the 1280 × 720 canvas and requested frame time without selection overlays. Desktop checks exercised physical dragging, keyframe-preserving movement, duplication, reordering, presets, and native PNG/SVG save dialogs. Responsive checks used 1440 × 960 and 390 × 844 viewports.

Browser checks on September 30, 2026: strict TypeScript compilation and five web tests passed. Tests cover native project compatibility, input validation, all five easing modes, scene boundaries, XML escaping, beat estimation, assistant response validation, and all canvas presets. Browser checks covered manual layer edits, scene and project response import, invalid response rejection, prompt preservation on cancel, undo, portrait resize, project downloads, recovery after reload, audio import and recovery, beat calibration, motion snapping, seam comparison, and playback across scene boundaries. Responsive checks used 1440 × 960 and 390 × 844 viewports. A browser-generated 1280 × 720 MP4 decoded successfully with H.264 video and AAC audio; its measured duration was 15.998 seconds for a 16-second project. Canceling export produced no download. A downloaded project passed the Rust validator and reopened in the browser; missing audio blocked export until relinked. All nine Rust tests also passed after the shared UI changes.

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

`--analyze AUDIO` prints audio timing JSON. `--generate claude|codex PROJECT PROMPT OUTPUT [MODEL [EFFORT]]` runs a real provider edit on the first scene, reviews rendered samples in a second request, and saves the result to OUTPUT. Its playhead context is zero. It uses the account's normal quota. Effort reaches Claude through `--effort` and Codex through `model_reasoning_effort`; neither is overridden when **CLI default** is selected.

Source layout: `web/` contains the strict TypeScript browser engine, local storage, assistant exchange, export, and static build. `ui/` contains the shared JavaScript interface, canvas presets, and motion editing helpers. `src-tauri/src/model.rs` defines and validates native project data; `render.rs` evaluates keyframes and draws SVG; `audio.rs` estimates timing; `ai.rs` calls providers; `export.rs` renders MP4, PNG, and SVG; `storage.rs` writes projects; `lib.rs` connects native commands.
