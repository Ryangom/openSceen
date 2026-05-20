/**
 * ScreenClaw – Offscreen Recording Engine
 * Uses getDisplayMedia() directly in the offscreen document to capture
 * screen/window/tab. Records via MediaRecorder and downloads the file
 * using an anchor-click approach for reliability.
 */

let mediaRecorder = null;
let recordedChunks = [];
let screenStream = null;
let webcamStream = null;
let micStream = null;
let combinedStream = null;
let recordingStartTime = null;
let recordingMode = null;
let canvas = null;
let canvasStream = null;
let animationId = null;

// ── Runtime Message Handler ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  switch (message.type) {
    case 'OFFSCREEN_START':
      handleStart(message.payload).then((result) => {
        sendResponse(result);
      }).catch((err) => {
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

async function handleStart({ mode, hasAudio, hasMic }) {
  recordedChunks = [];
  stopAllStreams();
  recordingMode = mode;

  try {
    // For "both" mode, we need to composite screen + webcam via canvas
    if (mode === 'both') {
      return await handleBothMode({ hasAudio, hasMic });
    }

    const tracks = [];

    // Screen capture
    if (mode === 'screen') {
      try {
        const displayConstraints = {
          video: { frameRate: { ideal: 30 } },
          audio: hasAudio,
        };
        screenStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
        screenStream.getVideoTracks().forEach((t) => tracks.push(t));
        if (hasAudio && screenStream.getAudioTracks().length > 0) {
          screenStream.getAudioTracks().forEach((t) => tracks.push(t));
        }
      } catch (err) {
        console.error('[Offscreen] Failed to create desktop stream:', err);
        if (err.name === 'NotAllowedError') {
          throw new Error('Screen capture was cancelled or denied by the user.');
        }
        throw new Error('Failed to capture desktop: ' + err.message);
      }
    }

    // Webcam only mode
    if (mode === 'webcam') {
      try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });
        webcamStream.getVideoTracks().forEach((t) => tracks.push(t));
      } catch (err) {
        console.error('[Offscreen] Webcam access denied:', err);
        throw new Error('Cannot access webcam: ' + err.message);
      }
    }

    // Microphone capture
    if (hasMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
          video: false,
        });
        micStream.getAudioTracks().forEach((t) => tracks.push(t));
      } catch (err) {
        console.warn('[Offscreen] Microphone access denied:', err);
      }
    }

    if (tracks.length === 0) {
      throw new Error('No media tracks available. Please check permissions.');
    }

    combinedStream = new MediaStream(tracks);
    startRecording(combinedStream);
    return { success: true };
  } catch (err) {
    stopAllStreams();
    throw err;
  }
}

async function handleBothMode({ hasAudio, hasMic }) {
  let screenVideoTrack = null;
  let screenAudioTracks = [];

  try {
    const displayConstraints = {
      video: { frameRate: { ideal: 30 } },
      audio: hasAudio,
    };
    screenStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
    screenVideoTrack = screenStream.getVideoTracks()[0];
    if (hasAudio) {
      screenAudioTracks = screenStream.getAudioTracks();
    }
  } catch (err) {
    console.error('[Offscreen] Failed to create desktop stream:', err);
    throw new Error('Failed to capture screen: ' + err.message);
  }

  let webcamVideoTrack = null;
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    webcamVideoTrack = webcamStream.getVideoTracks()[0];
  } catch (err) {
    console.warn('[Offscreen] Webcam access denied:', err);
  }

  const micAudioTracks = [];
  if (hasMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      micStream.getAudioTracks().forEach((t) => micAudioTracks.push(t));
    } catch (err) {
      console.warn('[Offscreen] Microphone access denied:', err);
    }
  }

  // Set up canvas for compositing
  canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let webcamVideo = null;
  if (webcamVideoTrack) {
    webcamVideo = document.createElement('video');
    webcamVideo.srcObject = webcamStream;
    webcamVideo.autoplay = true;
    webcamVideo.muted = true;
    await new Promise(r => webcamVideo.onloadedmetadata = r);
  }

  const screenVideo = document.createElement('video');
  screenVideo.srcObject = screenStream;
  screenVideo.autoplay = true;
  screenVideo.muted = true;
  await new Promise(r => screenVideo.onloadedmetadata = r);

  canvas.width = screenVideo.videoWidth || 1920;
  canvas.height = screenVideo.videoHeight || 1080;

  const drawFrame = () => {
    if (!canvas) return;
    ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    if (webcamVideo && webcamVideo.readyState >= 2) {
      const pipSize = Math.min(canvas.width, canvas.height) * 0.25;
      ctx.drawImage(webcamVideo, canvas.width - pipSize - 20, canvas.height - pipSize - 20, pipSize, pipSize);
    }
    animationId = requestAnimationFrame(drawFrame);
  };
  drawFrame();

  canvasStream = canvas.captureStream(30);
  if (screenAudioTracks.length > 0) {
    screenAudioTracks.forEach((t) => canvasStream.addTrack(t));
  }
  micAudioTracks.forEach((t) => canvasStream.addTrack(t));

  startRecording(canvasStream);
  return { success: true };
}

async function handleStop() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    return { success: false, error: 'No active recording' };
  }
  mediaRecorder.stop();
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

function startRecording(stream) {
  const mimeType = getSupportedMimeType();
  console.log('[Offscreen] Using MIME type:', mimeType);

  mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    stopAllStreams();
    saveRecording(mimeType);
  };

  mediaRecorder.onerror = (event) => {
    console.error('[Offscreen] MediaRecorder error:', event.error);
  };

  recordingStartTime = Date.now();
  mediaRecorder.start();
}

function stopAllStreams() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (canvas) {
    canvas.remove();
    canvas = null;
  }
  [screenStream, webcamStream, micStream, combinedStream, canvasStream].forEach((stream) => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  });
  screenStream = null;
  webcamStream = null;
  micStream = null;
  combinedStream = null;
  canvasStream = null;
}

/**
 * Prefer WebM for broader browser compatibility.
 * Chrome's MediaRecorder doesn't support MP4 container creation.
 */
function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'video/webm';
}

/**
 * Save the recording.  Uses a Blob URL + <a download> click to trigger
 * the browser's built-in "Save As" flow.  This avoids the old approach
 * of converting to a data URL and sending it over chrome.runtime messaging,
 * which was unreliable for large files (base64 bloat + 64 MB message limit).
 *
 * After the download is triggered we notify the background so it can
 * update the recording history.
 */
function saveRecording(mimeType) {
  if (recordedChunks.length === 0) return;

  const blob = new Blob(recordedChunks, { type: mimeType });

  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ScreenClaw_${timestamp}.${extension}`;

  const duration = recordingStartTime
    ? Math.round((Date.now() - recordingStartTime) / 1000)
    : 0;

  // Create a Blob URL and trigger download via an invisible <a> element.
  // This works in the offscreen document and avoids data-URL size limits.
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Clean up after a short delay so the browser has time to start the download
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }, 3000);

  // Notify background for history tracking (metadata only, no heavy payload)
  chrome.runtime.sendMessage({
    type: 'RECORDING_SAVED',
    payload: { filename, size: blob.size, duration, mode: recordingMode },
  });

  // Cleanup
  recordedChunks = [];
  recordingStartTime = null;
}
