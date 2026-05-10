/**
 * ScreenClaw – Content Script
 * Injects webcam overlay (PiP bubble) on pages when recording in "both" mode.
 * Shows a recording indicator overlay when any recording is active.
 *
 * Uses chrome.storage.onChanged as the PRIMARY mechanism to detect
 * recording state changes — this is more reliable than message passing
 * because it works regardless of popup lifecycle and getDisplayMedia timing.
 */

let webcamOverlay = null;
let webcamStream = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// ── Message Listener (secondary mechanism) ─────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SHOW_WEBCAM_OVERLAY':
      showWebcamOverlay();
      sendResponse({ success: true });
      return true;

    case 'HIDE_WEBCAM_OVERLAY':
      hideWebcamOverlay();
      sendResponse({ success: true });
      return true;

    case 'SHOW_RECORDING_INDICATOR':
      showRecordingIndicator();
      sendResponse({ success: true });
      return true;

    case 'HIDE_RECORDING_INDICATOR':
      hideRecordingIndicator();
      sendResponse({ success: true });
      return true;
  }
});

// ── Storage Listener (PRIMARY mechanism) ───────────────────────────────────
// This fires whenever background.js writes recordingState to chrome.storage

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.recordingState) return;

  const newState = changes.recordingState.newValue;
  if (!newState) return;

  console.log('[ScreenClaw] Storage change detected, isRecording:', newState.isRecording);

  if (newState.isRecording) {
    showRecordingIndicator();
  } else {
    hideRecordingIndicator();
  }
});

// ── On Load: check if already recording ────────────────────────────────────

(async function checkRecordingStateOnLoad() {
  try {
    const data = await chrome.storage.local.get('recordingState');
    if (data.recordingState && data.recordingState.isRecording) {
      console.log('[ScreenClaw] Already recording on page load, showing indicator');
      showRecordingIndicator();
    }
  } catch (err) {
    // Extension context may not be ready, ignore
  }
})();

// ── Webcam Overlay ─────────────────────────────────────────────────────────

async function showWebcamOverlay() {
  if (webcamOverlay) return;

  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' },
      audio: false,
    });
  } catch (err) {
    console.error('[ScreenClaw] Cannot access webcam:', err);
    return;
  }

  webcamOverlay = document.createElement('div');
  webcamOverlay.id = 'screenclaw-webcam-overlay';
  webcamOverlay.className = 'screenclaw-overlay';

  const video = document.createElement('video');
  video.srcObject = webcamStream;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'screenclaw-resize-handle';

  webcamOverlay.appendChild(video);
  webcamOverlay.appendChild(resizeHandle);
  document.body.appendChild(webcamOverlay);

  // Dragging
  webcamOverlay.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', endDrag);
}

function hideWebcamOverlay() {
  if (webcamOverlay) {
    webcamOverlay.remove();
    webcamOverlay = null;
  }
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
  }
}

function startDrag(e) {
  isDragging = true;
  const rect = webcamOverlay.getBoundingClientRect();
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;
  webcamOverlay.style.transition = 'none';
}

function onDrag(e) {
  if (!isDragging || !webcamOverlay) return;
  const x = e.clientX - dragOffset.x;
  const y = e.clientY - dragOffset.y;
  webcamOverlay.style.left = `${x}px`;
  webcamOverlay.style.top = `${y}px`;
  webcamOverlay.style.right = 'auto';
  webcamOverlay.style.bottom = 'auto';
}

function endDrag() {
  isDragging = false;
  if (webcamOverlay) webcamOverlay.style.transition = '';
}

// ── Recording Indicator ────────────────────────────────────────────────────

let recordingIndicator = null;
let borderOverlay = null;

function showRecordingIndicator() {
  // Avoid duplicates
  if (recordingIndicator || document.getElementById('screenclaw-rec-indicator')) return;

  // 1) Floating pill badge at top center
  recordingIndicator = document.createElement('div');
  recordingIndicator.id = 'screenclaw-rec-indicator';
  recordingIndicator.className = 'screenclaw-rec-indicator';

  const dot = document.createElement('div');
  dot.className = 'screenclaw-rec-dot';

  const text = document.createElement('span');
  text.textContent = 'RECORDING';

  recordingIndicator.appendChild(dot);
  recordingIndicator.appendChild(text);
  document.documentElement.appendChild(recordingIndicator);

  // 2) Full-viewport border overlay
  borderOverlay = document.createElement('div');
  borderOverlay.id = 'screenclaw-rec-border';
  borderOverlay.className = 'screenclaw-rec-border';
  document.documentElement.appendChild(borderOverlay);

  console.log('[ScreenClaw] Recording indicator shown');
}

function hideRecordingIndicator() {
  if (recordingIndicator) {
    recordingIndicator.remove();
    recordingIndicator = null;
  }
  if (borderOverlay) {
    borderOverlay.remove();
    borderOverlay = null;
  }
  // Fallback cleanup by ID
  const pill = document.getElementById('screenclaw-rec-indicator');
  if (pill) pill.remove();
  const border = document.getElementById('screenclaw-rec-border');
  if (border) border.remove();

  console.log('[ScreenClaw] Recording indicator hidden');
}
