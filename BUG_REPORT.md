# Bug Report for ScreenClaw Extension

## Summary
Analysis of the ScreenClaw Chrome extension codebase revealed several bugs and issues that need to be addressed for proper functionality, especially in MV3 compliance, permissions, UI consistency, and feature implementation.

## Bugs and Issues

### 1. Missing Manifest Permissions (Critical)
**Location:** `manifest.json`
**Issue:** The manifest lacks required permissions for camera and microphone access.
- **"camera"** permission is missing, required for `getUserMedia({ video: true })`.
- **"microphone"** permission is missing, required for `getUserMedia({ audio: true })`.
- Although permissions are requested at runtime, MV3 requires explicit declaration in the manifest for these APIs.

**Impact:** Webcam and microphone recording will fail with permission errors.

**Fix:** Add to `manifest.json` permissions array:
```json
"permissions": [
  "activeTab",
  "offscreen",
  "storage",
  "camera",
  "microphone"
]
```

### 2. Inconsistent Mode Selection UI (Major)
**Location:** `popup/popup.html`
**Issue:** "Webcam" and "Both" mode buttons are commented out in the HTML (lines 47-54).
**Impact:** Users cannot select webcam-only or combined screen+webcam modes, despite backend support.
**Fix:** Uncomment the mode buttons in `popup/popup.html`.

### 3. Webcam Overlay Not Triggered for "Both" Mode (Major)
**Location:** `background.js`, `offscreen.js`
**Issue:** For "both" mode, the webcam overlay is not displayed. The content script has overlay code, but no messages are sent to show it during recording.
**Impact:** "Both" mode only records screen without webcam overlay.
**Fix:** In `background.js`, after successful START_RECORDING for mode "both", send message to active tab's content script:
```javascript
if (mode === 'both') {
  chrome.tabs.sendMessage(sender.tab.id, { type: 'SHOW_WEBCAM_OVERLAY' });
}
```
Also, send 'HIDE_WEBCAM_OVERLAY' on stop.

### 4. Recording Indicator Not Shown (Minor)
**Location:** `background.js`
**Issue:** No code to show the recording indicator during recording.
**Impact:** Users have no visual feedback that recording is active.
**Fix:** Similar to overlay, send 'SHOW_RECORDING_INDICATOR' on start and 'HIDE_RECORDING_INDICATOR' on stop to content scripts.

### 5. Timer Reset on State Restore (Major)
**Location:** `popup/popup.js`
**Issue:** In `restoreState()`, `enterRecordingUI()` calls `startTimer()`, which resets `elapsedSeconds = 0`, overriding the calculated elapsed time from `startTime`.
**Impact:** Timer shows incorrect time after popup reopen during recording.
**Fix:** Modify `startTimer()` to not reset `elapsedSeconds` if already set, or calculate elapsedSeconds after `startTimer()` in `restoreState()`.

### 6. Duplicate State Updates (Minor)
**Location:** `background.js`, `offscreen.js`
**Issue:** State is set in `START_RECORDING` and again in `RECORDING_STARTED`.
**Impact:** Potential race conditions or overwrites.
**Fix:** Set state only on `RECORDING_STARTED`, remove from `START_RECORDING`.

### 7. Onboarding Page Reference (Minor)
**Location:** `background.js`
**Issue:** `onInstalled` listener references `'onboarding/onboarding.html'`, but the file does not exist.
**Impact:** Error on extension install/update.
**Fix:** Remove the onboarding code or create the file.

### 8. Content Script Injection (Minor)
**Location:** `manifest.json`
**Issue:** Content scripts match `<all_urls>`, which may be too broad.
**Impact:** Scripts injected on all pages, potential performance impact.
**Fix:** Consider more specific matches if possible, but for screen recording, all URLs may be necessary.

## Testing Notes
- Code flow for screen recording appears correct: popup → background → offscreen → MediaRecorder.
- MIME type selection favors MP4 for better compatibility.
- Download uses Blob URL to avoid size limits.
- Offscreen document properly used for MV3.

## Recommendations
1. Fix permissions first to enable media access.
2. Enable all modes in UI.
3. Implement overlay and indicator triggers.
4. Test all modes after fixes.
5. Run extension in Chrome to verify recording functionality.