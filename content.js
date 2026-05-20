/**
 * ScreenClaw – Content Script
 * Injects webcam overlay (PiP bubble) and floating controls bar on page when recording.
 */

let webcamOverlay = null;
let webcamStream = null;
let isDragging = false;
let isResizing = false;
let dragOffset = { x: 0, y: 0 };
let initialSize = { width: 0, height: 0 };
let initialMousePos = { x: 0, y: 0 };

// Controls Overlay Bar State
let controlsOverlay = null;
let isDraggingControls = false;
let controlsDragOffset = { x: 0, y: 0 };
let controlsTimerInterval = null;
let controlsStartTime = null;
let controlsPauseTime = null;
let controlsIsPaused = false;

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

    case 'SHOW_CONTROLS_OVERLAY':
      showControlsOverlay();
      sendResponse({ success: true });
      return true;

    case 'HIDE_CONTROLS_OVERLAY':
      hideControlsOverlay();
      sendResponse({ success: true });
      return true;

    case 'RECORDING_STATE_CHANGED':
      if (message.state.isRecording) {
        showControlsOverlay();
        updateControlsState(message.state);
      } else {
        hideControlsOverlay();
      }
      sendResponse({ success: true });
      return true;
  }
});

// Auto-restore overlays on page load/reload if recording is active on this tab
chrome.runtime.sendMessage({ type: 'GET_STATE' }).then((response) => {
  if (response && response.success && response.state.isRecording && response.isSenderTab) {
    if (response.state.mode === 'both') {
      showWebcamOverlay();
    }
    showControlsOverlay();
    updateControlsState(response.state);
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

// ── Controls Overlay Bar ───────────────────────────────────────────────────

function showControlsOverlay() {
  if (controlsOverlay) return;

  controlsOverlay = document.createElement('div');
  controlsOverlay.id = 'screenclaw-controls-overlay';
  controlsOverlay.className = 'screenclaw-controls-overlay';

  const dragHandle = document.createElement('div');
  dragHandle.className = 'screenclaw-drag-handle';
  dragHandle.textContent = '⋮⋮';

  const timerEl = document.createElement('div');
  timerEl.id = 'screenclaw-controls-timer';
  timerEl.className = 'screenclaw-timer';
  timerEl.textContent = '00:00';

  const actionsEl = document.createElement('div');
  actionsEl.className = 'screenclaw-actions';

  const btnPause = document.createElement('button');
  btnPause.id = 'screenclaw-btn-pause';
  btnPause.title = 'Pause/Resume Recording';
  btnPause.innerHTML = `
    <svg class="pause-icon" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
    <svg class="play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
  `;

  const btnStop = document.createElement('button');
  btnStop.id = 'screenclaw-btn-stop';
  btnStop.title = 'Stop & Save Recording';
  btnStop.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>`;

  const btnCancel = document.createElement('button');
  btnCancel.id = 'screenclaw-btn-cancel';
  btnCancel.title = 'Cancel & Discard Recording';
  btnCancel.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;

  actionsEl.appendChild(btnPause);
  actionsEl.appendChild(btnStop);
  actionsEl.appendChild(btnCancel);

  const btnMinimize = document.createElement('button');
  btnMinimize.id = 'screenclaw-btn-minimize';
  btnMinimize.title = 'Minimize Controls';
  btnMinimize.innerHTML = `
    <svg class="minimize-icon" viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2z"/></svg>
    <svg class="expand-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/></svg>
  `;

  controlsOverlay.appendChild(dragHandle);
  controlsOverlay.appendChild(timerEl);
  controlsOverlay.appendChild(actionsEl);
  controlsOverlay.appendChild(btnMinimize);

  document.body.appendChild(controlsOverlay);

  // Button Action Listeners
  btnPause.addEventListener('click', () => {
    const isPaused = controlsOverlay.classList.contains('paused');
    chrome.runtime.sendMessage({ type: isPaused ? 'RESUME_RECORDING' : 'PAUSE_RECORDING' });
  });

  btnStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  });

  btnCancel.addEventListener('click', () => {
    if (confirm('Are you sure you want to cancel and discard this recording?')) {
      chrome.runtime.sendMessage({ type: 'CANCEL_RECORDING' });
    }
  });

  btnMinimize.addEventListener('click', () => {
    const isMin = controlsOverlay.classList.toggle('minimized');
    btnMinimize.title = isMin ? 'Expand Controls' : 'Minimize Controls';
  });

  // Dragging event listeners
  dragHandle.addEventListener('mousedown', startDragControls);
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', endDrag);
}

function hideControlsOverlay() {
  if (controlsOverlay) {
    controlsOverlay.remove();
    controlsOverlay = null;
  }
  if (controlsTimerInterval) {
    clearInterval(controlsTimerInterval);
    controlsTimerInterval = null;
  }
}

function updateControlsState(state) {
  if (!controlsOverlay) return;

  if (state.isPaused) {
    controlsOverlay.classList.add('paused');
  } else {
    controlsOverlay.classList.remove('paused');
  }

  startControlsTimer(state.startTime, state.isPaused, state.pauseTime);
}

function startControlsTimer(startTime, isPaused, pauseTime) {
  controlsStartTime = startTime;
  controlsIsPaused = isPaused;
  controlsPauseTime = pauseTime;

  if (controlsTimerInterval) clearInterval(controlsTimerInterval);

  const updateTimerDisplay = () => {
    const timerEl = document.getElementById('screenclaw-controls-timer');
    if (!timerEl) return;

    let elapsed = 0;
    if (controlsStartTime) {
      if (controlsIsPaused && controlsPauseTime) {
        elapsed = Math.floor((controlsPauseTime - controlsStartTime) / 1000);
      } else {
        elapsed = Math.floor((Date.now() - controlsStartTime) / 1000);
      }
    }
    if (elapsed < 0) elapsed = 0;

    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  };

  updateTimerDisplay();

  if (!controlsIsPaused) {
    controlsTimerInterval = setInterval(updateTimerDisplay, 1000);
  }
}

function startDragControls(e) {
  if (!e.target.classList.contains('screenclaw-drag-handle')) return;
  isDraggingControls = true;
  const rect = controlsOverlay.getBoundingClientRect();
  controlsDragOffset.x = e.clientX - rect.left;
  controlsDragOffset.y = e.clientY - rect.top;
  controlsOverlay.style.transition = 'none';
  e.preventDefault();
}

// ── Shared Mouse Event Handlers ────────────────────────────────────────────

function onDrag(e) {
  if (isDragging && webcamOverlay) {
    const x = e.clientX - dragOffset.x;
    const y = e.clientY - dragOffset.y;
    webcamOverlay.style.setProperty('left', `${x}px`, 'important');
    webcamOverlay.style.setProperty('top', `${y}px`, 'important');
    webcamOverlay.style.setProperty('right', 'auto', 'important');
    webcamOverlay.style.setProperty('bottom', 'auto', 'important');
    return;
  }
  if (isResizing && webcamOverlay) {
    const width = Math.max(120, initialSize.width + (e.clientX - initialMousePos.x));
    const height = Math.max(90, initialSize.height + (e.clientY - initialMousePos.y));
    webcamOverlay.style.setProperty('width', `${width}px`, 'important');
    webcamOverlay.style.setProperty('height', `${height}px`, 'important');
    return;
  }
  if (isDraggingControls && controlsOverlay) {
    const x = e.clientX - controlsDragOffset.x;
    const y = e.clientY - controlsDragOffset.y;
    controlsOverlay.style.setProperty('left', `${x}px`, 'important');
    controlsOverlay.style.setProperty('top', `${y}px`, 'important');
    controlsOverlay.style.setProperty('right', 'auto', 'important');
    controlsOverlay.style.setProperty('bottom', 'auto', 'important');
    controlsOverlay.style.setProperty('transform', 'none', 'important');
    return;
  }
}

function endDrag() {
  isDragging = false;
  isResizing = false;
  isDraggingControls = false;
  if (webcamOverlay) webcamOverlay.style.transition = '';
  if (controlsOverlay) controlsOverlay.style.transition = '';
}
