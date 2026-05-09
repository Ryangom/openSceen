/**
 * ScreenClaw – Background Service Worker
 * Manages recording state, offscreen document lifecycle, and message routing.
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

// ── Desktop Capture Helper ─────────────────────────────────────────────────

function requestDesktopStream() {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(
      ['screen', 'window', 'tab'],
      (streamId, options) => {
        if (!streamId) {
          reject(new Error('User cancelled desktop capture'));
          return;
        }
        resolve(streamId);
      }
    );
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
      const { mode, hasAudio, hasMic } = message.payload;

      // Get desktop stream ID if screen recording is needed
      let streamId = null;
      if (mode === 'screen' || mode === 'both') {
        streamId = await requestDesktopStream();
      }

      await ensureOffscreenDocument();

       // Give offscreen document time to initialize its message listener
       await new Promise(resolve => setTimeout(resolve, 300));

       // Forward to offscreen document
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_START',
        target: 'offscreen',
        payload: { mode, hasAudio, hasMic, streamId },
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
      // Offscreen document saved the recording; store metadata
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

      // Keep last 50 recordings
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
  if (data.recordingState) {
    // If we were recording before, reset state since streams are gone
    if (data.recordingState.isRecording) {
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
  }
});
