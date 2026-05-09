/**
 * ScreenClaw – Offscreen Recording Engine
 * Handles MediaRecorder, stream composition, and file saving.
 */

let mediaRecorder = null;
let recordedChunks = [];
let screenStream = null;
let webcamStream = null;
let micStream = null;
let combinedStream = null;
let recordingStartTime = null;

// ── Message Handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  switch (message.type) {
    case 'OFFSCREEN_START':
      handleStart(message.payload).then(sendResponse).catch((err) => {
        console.error('[Offscreen] Start error:', err);
        sendResponse({ success: false, error: err.message });
      });
      return true;

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

async function handleStart({ mode, hasAudio, hasMic, streamId }) {
  recordedChunks = [];

  const tracks = [];

  // Screen / tab capture
  if ((mode === 'screen' || mode === 'both') && streamId) {
    const constraints = {
      audio: hasAudio ? {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
        }
      } : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
          maxFrameRate: 30,
        },
      },
    };

    screenStream = await navigator.mediaDevices.getUserMedia(constraints);
    screenStream.getVideoTracks().forEach((t) => tracks.push(t));

    if (hasAudio) {
      screenStream.getAudioTracks().forEach((t) => tracks.push(t));
    }
  }

  // Webcam capture
  if (mode === 'webcam' || mode === 'both') {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
      audio: false,
    });

    if (mode === 'webcam') {
      webcamStream.getVideoTracks().forEach((t) => tracks.push(t));
    }
    // For 'both' mode, webcam overlay is handled via content script
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
    throw new Error('No media tracks available');
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
    payload: {
      filename,
      size: blob.size,
      duration,
    },
  });

  // Cleanup
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  recordedChunks = [];
  recordingStartTime = null;
}
