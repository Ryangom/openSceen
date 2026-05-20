/**
 * ScreenClaw – Content Script
 * Injects webcam overlay (PiP bubble) on pages when recording in "both" mode.
 */

let webcamOverlay = null;
let webcamStream = null;
let isDragging = false;
let isResizing = false;
let dragOffset = { x: 0, y: 0 };
let initialSize = { width: 0, height: 0 };
let initialMousePos = { x: 0, y: 0 };

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
  }
});

// Auto-restore overlay on page load/reload if recording in "both" mode on this tab
chrome.runtime.sendMessage({ type: 'GET_STATE' }).then((response) => {
  if (response && response.success && response.state.isRecording && response.state.mode === 'both' && response.isSenderTab) {
    showWebcamOverlay();
  }
}).catch((err) => console.error('[ScreenClaw] Failed to get state on load:', err));

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

  // Dragging & Resizing
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
  const rect = webcamOverlay.getBoundingClientRect();
  if (e.target.classList.contains('screenclaw-resize-handle')) {
    isResizing = true;
    initialSize.width = rect.width;
    initialSize.height = rect.height;
    initialMousePos.x = e.clientX;
    initialMousePos.y = e.clientY;
    webcamOverlay.style.transition = 'none';
    e.preventDefault();
    return;
  }
  isDragging = true;
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;
  webcamOverlay.style.transition = 'none';
}

function onDrag(e) {
  if (!webcamOverlay) return;
  if (isResizing) {
    const width = Math.max(120, initialSize.width + (e.clientX - initialMousePos.x));
    const height = Math.max(90, initialSize.height + (e.clientY - initialMousePos.y));
    webcamOverlay.style.setProperty('width', `${width}px`, 'important');
    webcamOverlay.style.setProperty('height', `${height}px`, 'important');
    return;
  }
  if (!isDragging) return;
  const x = e.clientX - dragOffset.x;
  const y = e.clientY - dragOffset.y;
  webcamOverlay.style.setProperty('left', `${x}px`, 'important');
  webcamOverlay.style.setProperty('top', `${y}px`, 'important');
  webcamOverlay.style.setProperty('right', 'auto', 'important');
  webcamOverlay.style.setProperty('bottom', 'auto', 'important');
}

function endDrag() {
  isDragging = false;
  isResizing = false;
  if (webcamOverlay) webcamOverlay.style.transition = '';
}
