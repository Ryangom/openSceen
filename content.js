/**
 * ScreenClaw – Content Script
 * Injects webcam overlay (PiP bubble) on pages when recording in "both" mode.
 */

let webcamOverlay = null;
let webcamStream = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SHOW_WEBCAM_OVERLAY':
      showWebcamOverlay();
      sendResponse({ success: true });
      break;

    case 'HIDE_WEBCAM_OVERLAY':
      hideWebcamOverlay();
      sendResponse({ success: true });
      break;

    case 'SHOW_RECORDING_INDICATOR':
      showRecordingIndicator();
      sendResponse({ success: true });
      break;

    case 'HIDE_RECORDING_INDICATOR':
      hideRecordingIndicator();
      sendResponse({ success: true });
      break;
  }
});

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

function showRecordingIndicator() {
  if (recordingIndicator) return;

  recordingIndicator = document.createElement('div');
  recordingIndicator.id = 'screenclaw-rec-indicator';
  recordingIndicator.className = 'screenclaw-rec-indicator';
  recordingIndicator.innerHTML = '<span class="screenclaw-rec-dot"></span> REC';
  document.body.appendChild(recordingIndicator);
}

function hideRecordingIndicator() {
  if (recordingIndicator) {
    recordingIndicator.remove();
    recordingIndicator = null;
  }
}
