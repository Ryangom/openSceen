# ScreenClaw Desktop (Electron + Angular) — Full Implementation Plan

## 0) Goal

Create a Windows-only desktop app that mirrors the ScreenClaw Chrome extension:

- Screen recording, webcam recording, or both (PiP overlay compositing)
- System audio “best effort”
- Optional microphone audio
- UI: always-on-top floating controls + webcam overlay/PiP overlay
- Save recordings immediately on Stop/Cancel behavior
- Show recording history (at least in-app; optional persistence to disk)

---

## 1) Hard prerequisites / assumptions

### 1.1 Fix runtime dependencies

- ✅ Renderer already builds (Angular renderer at `screenclaw-desktop/renderer/`)
- ❗ Electron main process + renderer IPC + capture/record engine are not implemented yet.

### 1.2 Implement with best-effort audio

In Electron, “system audio” capture options depend on OS/browser APIs:

- Prefer `desktopCapturer.getSources()` + Web APIs in renderer:
  - Use `getUserMedia` for mic
  - For system audio, use best-effort based on available tracks:
    - Windows: often not reliably accessible without extra capture/virtual device setup
    - Implement graceful fallback:
      - If system audio track unavailable, record video only and mark metadata

---

## 2) Project structure to add

Create Electron app scaffolding under `screenclaw-desktop/`:

### 2.1 Electron main process

Add:

- `main/electron-main.js` (or `main/main.js`)
- `main/preload.js` (preload bridge)
- `main/ipc/handlers.js` (IPC logic)

### 2.2 Desktop-specific renderer additions

In Angular renderer:

- `src/app/desktop/` components:
  - `controls/controls.component.ts/html/css`
  - `pip/pip.component.ts/html/css`
  - `history/history.component.ts/html/css`
- `src/app/services/recorder.service.ts` (IPC client + state machine)
- `src/app/services/overlay.service.ts` (PiP overlay DOM + drag/resize)

---

## 3) Dependencies (package.json changes)

Update `screenclaw-desktop/package.json`:

- Add `electron`
- Add `electron-builder` (optional now; useful later)
- Add `@types/node` (optional)
- Ensure Angular renderer can load inside Electron:
  - dev mode should run Angular build or use Angular dev server with `loadURL`

Recommended flow:

1. Development:
   - `ng serve` for renderer
   - Electron loads `http://localhost:4200`
2. Production:
   - `ng build` to `renderer/dist/renderer`
   - Electron loads `file://.../dist/renderer/index.html`

---

## 4) Implementation Plan (Step-by-step)

## Step 1 — Minimal Electron app + always-on-top window

**Files to create/update**

- `screenclaw-desktop/main/main.js`
- `screenclaw-desktop/main/preload.js`

**Behavior**

- Create a single `BrowserWindow`:
  - `alwaysOnTop: true`
  - `frame: false` (optional)
  - `resizable: true`
  - `transparent: false` (start simple; later make transparent overlay-style)
  - `webPreferences`:
    - `contextIsolation: true`
    - `preload: path/to/preload.js`
- Load:
  - Dev: Angular dev server URL
  - Prod: Angular `dist/renderer` index

**Exit/cleanup**

- On window close: stop recording (if running) and then quit.

---

## Step 2 — IPC Bridge (Renderer <-> Main)

**Files**

- `main/ipc/handlers.js`
- `main/preload.js`
- Angular `recorder.service.ts`

**IPC messages**
Define a clear protocol:

- `RECORDER_START`:
  - payload: `{ mode: 'screen' | 'webcam' | 'both', hasAudio: boolean, hasMic: boolean }`
- `RECORDER_PAUSE`
- `RECORDER_RESUME`
- `RECORDER_STOP`
- `RECORDER_CANCEL`
- `RECORDER_STATE_CHANGED` (events from main -> renderer)
- `RECORDER_SAVED` (event from main -> renderer with metadata: path, duration, size, mode, timestamps)

**State machine in main**
Maintain:

- `isRecording`, `isPaused`, `startTime`, `pauseTime`, `mode`, `hasAudio`, `hasMic`, `outputFile`

**Renderer state machine**

- UI should reflect:
  - recording vs idle
  - paused vs running
  - mode selection availability
  - disable invalid buttons (e.g., pause not available if not recording)

---

## Step 3 — Recording Engine Implementation (Electron side)

You have two viable architectures. Choose one:

### Option A (recommended): Recording in Electron main via hidden BrowserWindow

- Main creates a hidden `BrowserWindow` / uses existing web contents to run recording logic in a renderer context.
- Media APIs (`getDisplayMedia`, `getUserMedia`, `MediaRecorder`) are easiest in a renderer context.

### Option B: Use renderer window only

- Use the visible Angular window for capture/compositing.
- Downside: overlay window and record target may interact with UI; still workable.

**Recommended**: Option A to keep UI separate.

### Step 3.1 — Screen capture (mode: screen)

- In the hidden recording window:
  - Call `desktopCapturer.getSources({ types: ['screen', 'window'] })`
  - Ask user for selection by opening a capture chooser UI (best-effort)
  - Use `getUserMedia` is not applicable for screen; use Electron capture:
    - Convert chosen source to `getUserMedia` constraints or use supported APIs
- Create `MediaStream` with:
  - video track from display capture
  - audio track if available (best-effort)
- Start `MediaRecorder`:
  - mime type: try `video/webm;codecs=vp9,opus` else fallback to `video/webm`
  - chunking: store chunks in memory, assemble on stop

### Step 3.2 — Webcam capture (mode: webcam)

- Use `navigator.mediaDevices.getUserMedia({ video: true, audio: hasMic })`
- Create PiP overlay stream:
  - For webcam-only recording, record webcam stream directly (no compositing)

### Step 3.3 — Both mode compositing (screen + webcam PiP)

- Capture screen stream + webcam stream
- Create an offscreen canvas compositor:
  - Draw screen frame
  - Draw webcam frame into a chosen PiP rectangle
  - Update canvas draw each animation frame
- `const composedStream = canvas.captureStream(30)`
- If mic audio and/or system audio are available:
  - mix audio tracks into one audio track
  - attach to composed stream
- Record composed stream with `MediaRecorder`

### Step 3.4 — Pause/Resume/Cancel behavior

- Pause/Resume:
  - `MediaRecorder.pause()` and `MediaRecorder.resume()`
  - Update timing in main for correct elapsed time metadata
- Stop:
  - final stop -> assemble chunks -> write file
- Cancel:
  - stop recording and discard chunks; do not write file

### Step 3.5 — Save to file + history metadata

- Determine output path:
  - Use `app.getPath('videos')` or `documents`
- Generate filename:
  - `ScreenClaw_${mode}_${yyyyMMdd_HHmmss}.webm`
- Write file in main using `fs`
- Send `RECORDER_SAVED` event to renderer:
  - `{ path, filename, size, durationSeconds, mode, dateISO }`
- Store history:
  - Minimum: in-memory list (until app restart)
  - Better: persist to disk as JSON in user data dir

---

## Step 4 — Angular UI: floating always-on-top controls + PiP overlay

**Components**

1. `ControlsComponent`:
   - Mode selection: Screen / Webcam / Both
   - Toggles: System Audio (hasAudio), Mic (hasMic)
   - Buttons: Start, Pause, Stop, Cancel
   - Timer display: elapsed mm:ss
   - History tab: list recordings

2. `PipOverlayComponent`:
   - Webcam overlay view (draggable + resizable)
   - This should match compositing rectangle used in both-mode recording
   - When user drags/resizes overlay:
     - Update compositor rectangle in recording window (via IPC)

**Overlay sync protocol**

- Renderer PiP state:
  - `{ x, y, width, height }` relative to window or absolute pixels
- Main compositor uses same coordinates:
  - Convert to canvas drawing coordinates

---

## Step 5 — Wire UI to IPC recorder.service.ts

- `recorder.service.ts` provides methods:
  - `start(mode, hasAudio, hasMic)`
  - `pause()`
  - `resume()`
  - `stop()`
  - `cancel()`
- Subscribe to main events:
  - update timer state
  - update buttons enabled/disabled
  - update history

---

## Step 6 — Build & run scripts

Add root scripts in `screenclaw-desktop/package.json`:

- `dev`:
  - start Angular dev server (or build watch)
  - start Electron
- `build`:
  - `ng build` (renderer)
  - `electron-builder` or just prepare dist folder
- `start`:
  - run Electron production build

---

## Step 7 — Critical-path testing (what to verify after implementation)

Run these before considering it “done”:

### 7.1 UI + window behavior

- App launches
- Always-on-top window works (stays above other windows)
- Controls are visible and interactive
- PiP overlay drags/resizes smoothly (webcam & both modes)

### 7.2 IPC end-to-end

- Start -> recording begins
- Pause -> timer stops and recording pauses
- Resume -> timer continues and recording resumes
- Stop -> file written and downloadable/playable
- Cancel -> no file written and state resets

### 7.3 Recording correctness

- Mode = screen:
  - WebM playable, contains screen video
  - audio present if available; otherwise video-only fallback is acceptable
- Mode = webcam:
  - WebM playable, contains webcam video; mic optional
- Mode = both:
  - WebM playable, shows screen + PiP webcam overlay at correct position/size

### 7.4 History updates

- After Stop:
  - history list updates
  - item displays filename, duration, size, mode, date
- After Restart (if persistence implemented):
  - history persists

---

## 8) Edge cases / robustness checklist

- User denies microphone permission: app should still record video without mic
- User cancels capture source chooser: app should revert to idle state
- Recording start while already recording: ignore or show error
- Pause while already paused: no-op
- Stop while paused: should stop and save correct duration
- Cancel while paused: should discard correctly
- Ensure cleanup:
  - stop all tracks on stop/cancel
  - dispose canvas and audio contexts
  - revoke object URLs if used

---

## 9) Deliverables

- Electron app launches and records
- UI supports modes and audio toggles
- PiP overlay exists in UI
- Recording outputs `.webm` playable files
- History shows saved recordings
