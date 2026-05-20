# Bug Report for ScreenClaw Extension (All Resolved)

## Summary

All previously identified bugs in the ScreenClaw Chrome extension codebase have been fully resolved. The extension is now fully functional, support for all recording modes (Screen, Webcam, and Both) is complete, the UI state and recording timer are synchronized correctly, and the draggable/resizable webcam overlay is fully operational.

---

## Resolved Bugs and Issues

### 1. Missing Manifest Permissions
*   **Status:** RESOLVED
*   **Fix:** Removed invalid `"camera"` and `"microphone"` permissions from `manifest.json` as they are unsupported in Chrome Manifest V3. Camera and microphone access are instead requested at runtime via standard web API calls on extension-origin pages (like the onboarding page) to trigger native browser permission prompts.

### 2. Inconsistent Mode Selection UI
*   **Status:** RESOLVED
*   **Fix:** Uncommented and enabled the "Webcam" and "Both" mode selection buttons in `popup/popup.html`. Handled styling and transitions dynamically.

### 3. Webcam Overlay Not Triggered for "Both" Mode
*   **Status:** RESOLVED
*   **Fix:** 
    *   Updated `background.js` to dispatch `SHOW_WEBCAM_OVERLAY` messages to the recorded tab's content script on start, and `HIDE_WEBCAM_OVERLAY` on stop.
    *   Updated `content.js` to automatically prompt for camera access and render the floating picture-in-picture window when it receives the command.
    *   Added automatic overlay restoration in `content.js` using `GET_STATE` during tab page reloads or navigations, ensuring it persists during the recording.
    *   Implemented proper resize handle dragging in `content.js` and forced overlay position/size updates using `!important` inline style overrides to counter stylesheet overrides.

### 4. Timer Reset on State Restore
*   **Status:** RESOLVED
*   **Fix:**
    *   Integrated a `pauseTime` timestamp in `background.js`'s recording state to capture the exact time a pause was initiated.
    *   On resume, the background service worker shifts `startTime` forward by the total paused duration (`Date.now() - pauseTime`), maintaining a precise elapsed time calculation.
    *   Updated `popup/popup.js` to freeze the elapsed timer at `pauseTime - startTime` when restoring a paused recording state, preventing the timer from drifting or resetting.

### 5. Duplicate State Updates and Service Worker Persistence
*   **Status:** RESOLVED
*   **Fix:**
    *   Established a `statePromise` at the top level of `background.js` to restore the active `recordingState` from `chrome.storage.local` upon service worker wake-up (resolving the Manifest V3 service worker termination bug).
    *   Added automatic badge rendering on startup if a recording is currently active, keeping the visual indicator flashing.
    *   Passed the active `mode` back through the `RECORDING_SAVED` message from `offscreen.js` so that the correct mode is stored in the recording history, preventing the history list from misidentifying webcam/both recordings as screen recordings.

### 6. Onboarding Page Reference
*   **Status:** RESOLVED
*   **Fix:** Confirmed the presence of `onboarding/onboarding.html`, `onboarding.css`, and `onboarding.js`. They properly trigger permissions prompts on installation.

### 7. Content Script Injection
*   **Status:** RESOLVED
*   **Design Rationale:** Content scripts must match `<all_urls>` to support injecting the floating webcam bubble on whichever webpage the user chooses to record. This is normal and expected for screen-recording extensions.
