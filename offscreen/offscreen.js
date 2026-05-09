/**
 * ScreenClaw – Offscreen Recording Engine
 * Receives desktop MediaStream from popup via Port, optionally adds webcam/mic,
 * records via MediaRecorder, and saves file. Also responds to stop/pause/resume
 * messages from background.
 */

let mediaRecorder = null;
let recordedChunks = [];
let screenStream = null;       // transferred from popup
let webcamStream = null;       // acquired via getUserMedia
let micStream = null;          // acquired via getUserMedia
let combinedStream = null;
let recordingStartTime = null;
let popupPort = null;          // Port for communication with popup

// ── Port Connection (from popup) ───────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    // Disconnect any existing port
    if (popupPort) {
      popupPort.disconnect();
    }
    popupPort = port;
    // Signal ready
    port.postMessage({ type: 'OFFSCREEN_READY' });
    port.onMessage.addListener(handlePortMessage);
    // Clean up reference on disconnect
    port.onDisconnect.addListener(() => {
      if (popupPort === port) {
        popupPort = null;
      }
    });
  }
});

async function handlePortMessage(msg) {
  if (msg.type === 'START_WITH_STREAM') {
    const { mode, hasAudio, hasMic, screenStream: incomingScreenStream } = msg.payload;
    try {
      const result = await handleStart({ mode, hasAudio, hasMic, screenStream: incomingScreenStream });
      // Send result back to popup
      if (popupPort) {
        popupPort.postMessage({ type: 'START_RESULT', success: result.success, error: result.error });
      }
      // Notify background that recording started (for state persistence)
      if (result.success) {
        chrome.runtime.sendMessage({
          type: 'RECORDING_STARTED',
          payload: { mode, hasAudio, hasMic },
        });
      }
    } catch (err) {
      if (popupPort) {
        popupPort.postMessage({ type: 'START_RESULT', success: false, error: err.message });
      }
    }
  }
}

// ── Runtime Message Handler (control commands) ─────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  switch (message.type) {
    case 'OFFSCREEN_STOP':
      handleStop().then(sendResponse).catch((err) => {
        console.error('[Offscreen] Stop error:', err);
        sendResponse({ success: false, error: err.message });
      });
      return true;

    case 'OFFSCREEN_PAUSE':
      handlePause().then(sendResponse);
      return true;

    case 'OFFSCREEN_RESUME':
      handleResume().then(sendResponse);
      return true;
  }
});

// ── Recording Handlers ─────────────────────────────────────────────────────

async function handleStart({ mode, hasAudio, hasMic, screenStream: incomingScreenStream }) {
  recordedChunks = [];

  const tracks = [];

  // Use transferred desktop screen stream
  if ((mode === 'screen' || mode === 'both') && incomingScreenStream) {
    screenStream = incomingScreenStream;
    screenStream.getVideoTracks().forEach((t) => tracks.push(t));
    if (hasAudio) {
      screenStream.getAudioTracks().forEach((t) => tracks.push(t));
    }
  }

  // Webcam capture — only for 'webcam' mode (both mode uses content overlay)
  if (mode === 'webcam') {
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });
      webcamStream.getVideoTracks().forEach((t) => tracks.push(t));
    } catch (err) {
      console.warn('[Offscreen] Webcam access denied:', err);
    }
  }

  // Microphone capture
  if (hasMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
        video: false,
      });
      micStream.getAudioTracks().forEach((t) => tracks.push(t));
    } catch (err) {
      console.warn('[Offscreen] Microphone access denied:', err);
    }
  }

  if (tracks.length === 0) {
    throw new Error('No media tracks available. Please check: screen/window/tab selection must include audio if System Audio is enabled, and Microphone/Webcam permissions must be granted.');
  }

  combinedStream = new MediaStream(tracks);

  // Determine best supported mime type
  const mimeType = getSupportedMimeType();

  mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    saveRecording(mimeType);
  };

  mediaRecorder.onerror = (event) => {
    console.error('[Offscreen] MediaRecorder error:', event.error);
  };

  recordingStartTime = Date.now();
  mediaRecorder.start(1000); // Collect data every second

  return { success: true };
}

async function handleStop() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    return { success: false, error: 'No active recording' };
  }

  mediaRecorder.stop();

  // Stop all tracks
  stopAllStreams();

  return { success: true };
}

async function handlePause() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
    return { success: true };
  }
  return { success: false, error: 'Not recording' };
}

async function handleResume() {
  if (mediaRecorder && mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
    return { success: true };
  }
  return { success: false, error: 'Not paused' };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'video/webm';
}

function stopAllStreams() {
  [screenStream, webcamStream, micStream, combinedStream].forEach((stream) => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  });
  screenStream = null;
  webcamStream = null;
  micStream = null;
  combinedStream = null;
}

function saveRecording(mimeType) {
  if (recordedChunks.length === 0) return;

  const blob = new Blob(recordedChunks, { type: mimeType });
  const url = URL.createObjectURL(blob);

  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ScreenClaw_${timestamp}.${extension}`;

  const duration = recordingStartTime
    ? Math.round((Date.now() - recordingStartTime) / 1000)
    : 0;

  // Download via anchor element
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  // Notify background about saved recording
  chrome.runtime.sendMessage({
    type: 'RECORDING_SAVED',
    payload: { filename, size: blob.size, duration },
  });

  // Cleanup
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  recordedChunks = [];
  recordingStartTime = null;
}
