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

  const tracks = [];

  // Use getDisplayMedia() directly in the offscreen document.
  // The offscreen document was created with the DISPLAY_MEDIA reason,
  // so Chrome permits getDisplayMedia() here without a user gesture.
  if (mode === 'screen' || mode === 'both') {
    try {
      const displayConstraints = {
        video: {
          frameRate: { ideal: 30 },
        },
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
      let errorMsg = 'Failed to capture desktop: ' + err.message;
      if (hasAudio) {
        errorMsg += '. If you enabled System Audio, please ensure you also checked the "Share system audio" box in the Chrome picker.';
      }
      throw new Error(errorMsg);
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
    throw new Error('No media tracks available. Please check permissions.');
  }

  combinedStream = new MediaStream(tracks);

  // Determine best supported MIME type – prefer MP4 for native Windows playback
  const mimeType = getSupportedMimeType();
  console.log('[Offscreen] Using MIME type:', mimeType);

  mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  // IMPORTANT: stopAllStreams is called HERE (inside onstop) instead of
  // in handleStop(). This ensures MediaRecorder fully finalises the
  // container headers before the underlying tracks are destroyed.
  mediaRecorder.onstop = () => {
    stopAllStreams();
    saveRecording(mimeType);
  };

  mediaRecorder.onerror = (event) => {
    console.error('[Offscreen] MediaRecorder error:', event.error);
  };

  recordingStartTime = Date.now();
  // No timeslice — this makes Chrome write a non-fragmented container
  // with a complete sample table (moov atom for MP4 / Cues for WebM),
  // which is required for the seek slider to work in media players.
  mediaRecorder.start();

  return { success: true };
}

async function handleStop() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    return { success: false, error: 'No active recording' };
  }

  // Just call stop(). Do NOT call requestData() before stop — that would
  // create a fragment boundary that breaks the seek index.
  // Do NOT call stopAllStreams() here — let onstop handle it so the
  // MediaRecorder can write proper container-end bytes first.
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

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Prefer MP4 (H.264 + AAC) so the file plays natively on Windows
 * without requiring VLC or additional codecs.  Falls back to WebM.
 */
function getSupportedMimeType() {
  const types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',   // H.264 Baseline + AAC-LC
    'video/mp4;codecs=avc1,mp4a.40.2',           // H.264 + AAC
    'video/mp4;codecs=avc1.42E01E,opus',          // H.264 + Opus
    'video/mp4;codecs=avc1,opus',
    'video/mp4',
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
    payload: { filename, size: blob.size, duration },
  });

  // Cleanup
  recordedChunks = [];
  recordingStartTime = null;
}
