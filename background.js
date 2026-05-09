/**
 * ScreenClaw – Background Service Worker
 * Manages recording state, offscreen document lifecycle, message routing,
 * and acquires desktop screen stream directly (using getUserMedia with chromeMediaSource).
 */

let offscreenDocumentExists = false;
let recordingState = {
  isRecording: false,
  isPaused: false,
  startTime: null,
  mode: null, // 'screen' | 'webcam' | 'both'
  hasAudio: true,
  hasMic: true,
};

// ── Offscreen Document Management ──────────────────────────────────────────

async function ensureOffscreenDocument() {
  if (offscreenDocumentExists) return;

  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });

    if (existingContexts.length > 0) {
      offscreenDocumentExists = true;
      return;
    }

    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
      justification: 'Recording screen and/or webcam with MediaRecorder',
    });

    offscreenDocumentExists = true;
  } catch (err) {
    console.error('[ScreenClaw] Failed to create offscreen document:', err);
  }
}

async function closeOffscreenDocument() {
  if (!offscreenDocumentExists) return;
  try {
    await chrome.offscreen.closeDocument();
    offscreenDocumentExists = false;
  } catch (err) {
    console.error('[ScreenClaw] Failed to close offscreen document:', err);
  }
}

// ── Acquire Desktop Stream ───────────────────────────────────────────────────
// Uses chromeMediaSource constraints to create MediaStream from streamId
function acquireDesktopStream(streamId, includeAudio) {
  return new Promise((resolve, reject) => {
    const constraints = {
      audio: includeAudio ? {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
        },
      } : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
          maxFrameRate: 30,
        },
      },
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => resolve(stream))
      .catch(err => reject(err));
  });
}

// ── Message Handling ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error('[ScreenClaw] Message handler error:', err);
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep message channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'START_RECORDING': {
      const { mode, hasAudio, hasMic, streamId } = message.payload;

      // Validate streamId for screen/both modes
      if ((mode === 'screen' || mode === 'both') && !streamId) {
        return { success: false, error: 'Missing streamId for screen recording' };
      }

      // Acquire desktop stream in background (guaranteed to work)
      let screenStream = null;
      if ((mode === 'screen' || mode === 'both') && streamId) {
        try {
          screenStream = await acquireDesktopStream(streamId, hasAudio);
        } catch (err) {
          console.error('[ScreenClaw] Failed to acquire desktop stream:', err);
          return { success: false, error: `Failed to capture screen: ${err.message}` };
        }
      }

      await ensureOffscreenDocument();

      // Wait for offscreen to be ready
      await new Promise(resolve => setTimeout(resolve, 300));

      // Send to offscreen (screenStream will be cloned via structured clone)
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_START',
        target: 'offscreen',
        payload: { mode, hasAudio, hasMic, screenStream },
      });

      if (response && response.success) {
        recordingState = {
          isRecording: true,
          isPaused: false,
          startTime: Date.now(),
          mode,
          hasAudio,
          hasMic,
        };
        await chrome.storage.local.set({ recordingState });
      }

      return response;
    }

    case 'STOP_RECORDING': {
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_STOP',
        target: 'offscreen',
      });

      recordingState = {
        isRecording: false,
        isPaused: false,
        startTime: null,
        mode: null,
        hasAudio: true,
        hasMic: true,
      };
      await chrome.storage.local.set({ recordingState });

      // Close offscreen document after a short delay to allow download
      setTimeout(() => closeOffscreenDocument(), 2000);

      return response;
    }

    case 'PAUSE_RECORDING': {
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_PAUSE',
        target: 'offscreen',
      });

      recordingState.isPaused = true;
      await chrome.storage.local.set({ recordingState });

      return response;
    }

    case 'RESUME_RECORDING': {
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_RESUME',
        target: 'offscreen',
      });

      recordingState.isPaused = false;
      await chrome.storage.local.set({ recordingState });

      return response;
    }

    case 'GET_STATE': {
      return { success: true, state: recordingState };
    }

    case 'RECORDING_SAVED': {
      const { filename, size, duration } = message.payload;
      const history = (await chrome.storage.local.get('recordingHistory'))
        .recordingHistory || [];

      history.unshift({
        filename,
        size,
        duration,
        date: new Date().toISOString(),
        mode: recordingState.mode,
      });

      if (history.length > 50) history.length = 50;
      await chrome.storage.local.set({ recordingHistory: history });

      return { success: true };
    }

    case 'GET_HISTORY': {
      const history = (await chrome.storage.local.get('recordingHistory'))
        .recordingHistory || [];
      return { success: true, history };
    }

    case 'CLEAR_HISTORY': {
      await chrome.storage.local.set({ recordingHistory: [] });
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// ── Restore state on startup ───────────────────────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get('recordingState');
  if (data.recordingState && data.recordingState.isRecording) {
    recordingState = {
      isRecording: false,
      isPaused: false,
      startTime: null,
      mode: null,
      hasAudio: true,
      hasMic: true,
    };
    await chrome.storage.local.set({ recordingState });
  }
});
