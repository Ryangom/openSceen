(function() {
  async function logDebug(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `[Content ${timestamp}] ${msg}`;
    console.log(logMsg);
    try {
      const data = await chrome.storage.local.get('debugLogs');
      const logs = data.debugLogs || [];
      logs.push(logMsg);
      if (logs.length > 200) logs.shift();
      await chrome.storage.local.set({ debugLogs: logs });
    } catch (e) {}
  }

  if (window.hasScreenClawContentScriptInjected) {
    logDebug('Content script already injected, skipping.');
    return;
  }
  window.hasScreenClawContentScriptInjected = true;
  logDebug(`Content script loaded on ${window.location.href}`);

  let webcamOverlay = null;
  let webcamStream = null;
  let isDragging = false;
  let isResizing = false;
  let dragOffset = { x: 0, y: 0 };
  let initialSize = { width: 0, height: 0 };
  let initialMousePos = { x: 0, y: 0 };

  // Controls Overlay Bar State
  let controlsOverlay = null;
  let controlsTimerInterval = null;
  let controlsStartTime = null;
  let controlsPauseTime = null;
  let controlsIsPaused = false;
  let currentRecordingMode = 'screen';

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logDebug(`Received runtime message: ${message.type}`);
    switch (message.type) {
      case 'PING':
        sendResponse({ success: true });
        return true;

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
        logDebug(`Recording state changed: ${JSON.stringify(message.state)}`);
        currentRecordingMode = message.state.mode || 'screen';
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

  // Auto-restore overlays on page load/reload if recording is active
  // Show on ANY tab during recording (not just the original sender tab)
  chrome.runtime.sendMessage({ type: 'GET_STATE' }).then((response) => {
    logDebug(`GET_STATE response on load: ${JSON.stringify(response)}`);
    if (response && response.success && response.state.isRecording) {
      currentRecordingMode = response.state.mode || 'screen';
      if (response.state.mode === 'both') {
        showWebcamOverlay();
      }
      showControlsOverlay();
      updateControlsState(response.state);
    }
  }).catch((err) => logDebug(`Failed to get state on load: ${err.message}`));

  // ── Webcam Overlay ─────────────────────────────────────────────────────────

  async function showWebcamOverlay() {
    console.log('[ScreenClaw] showWebcamOverlay() called');
    if (webcamOverlay) {
      console.log('[ScreenClaw] Webcam overlay already exists');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('[ScreenClaw] Webcam overlay not supported on this context (needs HTTPS/secure context).');
      return;
    }

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
    console.log('[ScreenClaw] Webcam overlay appended to body');

    // Dragging & Resizing
    webcamOverlay.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
  }

  function hideWebcamOverlay() {
    console.log('[ScreenClaw] hideWebcamOverlay() called');
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
    logDebug('showControlsOverlay() called');
    if (controlsOverlay) {
      logDebug('Controls overlay already exists');
      return;
    }

    controlsOverlay = document.createElement('div');
    controlsOverlay.id = 'screenclaw-controls-overlay';
    controlsOverlay.className = 'screenclaw-controls-overlay';

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

    controlsOverlay.appendChild(timerEl);
    controlsOverlay.appendChild(actionsEl);

    // Fallback if body is not yet ready (e.g. document_start or early load)
    const targetContainer = document.body || document.documentElement;
    if (targetContainer) {
      targetContainer.appendChild(controlsOverlay);
      logDebug(`Controls overlay appended to ${targetContainer.tagName}`);
    } else {
      logDebug('Error: neither document.body nor document.documentElement exists!');
    }

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
  }

  function hideControlsOverlay() {
    logDebug('hideControlsOverlay() called');
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
  }

function endDrag() {
   isDragging = false;
   isResizing = false;
   if (webcamOverlay) webcamOverlay.style.transition = '';
 }

 // Clean up on page unload to prevent camera leaks
 window.addEventListener('beforeunload', () => {
   if (webcamStream) {
     webcamStream.getTracks().forEach((track) => track.stop());
   }
 });
})();
