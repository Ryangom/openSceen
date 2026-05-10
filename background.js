/**
 * ScreenClaw – Background Service Worker
 * Manages recording state, offscreen document lifecycle, and message routing.
 */

let offscreenDocumentExists = false;
let recordingState = {
  isRecording: false,
  isPaused: false,
  startTime: null,
  mode: null,
  hasAudio: true,
  hasMic: true,
  tabId: null,
};

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

// ── Recording Indicator (Extension Badge) ──────────────────────────────────
// The badge sits on the extension toolbar icon — it is NEVER captured by
// getDisplayMedia(), so it won't appear in the recorded video.

function showRecordingBadge() {
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff4d6d' });
  chrome.action.setBadgeTextColor({ color: '#ffffff' });
  chrome.action.setTitle({ title: 'ScreenClaw – Recording in progress…' });
}

function hideRecordingBadge() {
  chrome.action.setBadgeText({ text: '' });
  chrome.action.setTitle({ title: 'ScreenClaw – Screen & Video Recorder' });
}

// ── Message Handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error('[ScreenClaw] Message handler error:', err);
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'START_RECORDING': {
      try {
        await ensureOffscreenDocument();

        // Give offscreen a moment to initialize its listeners
        await new Promise(resolve => setTimeout(resolve, 300));

        // Resolve the tabId from the payload (sent by popup)
        let tabId = message.payload.tabId || (sender.tab ? sender.tab.id : null);
        if (!tabId) {
          try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0) {
              tabId = tabs[0].id;
            }
          } catch (err) {
            console.error('[ScreenClaw] Failed to get active tab:', err);
          }
        }

        // Forward start command to offscreen document
        const response = await chrome.runtime.sendMessage({
          type: 'OFFSCREEN_START',
          target: 'offscreen',
          payload: message.payload,
        });

        if (response && response.success) {
          const { mode, hasAudio, hasMic } = message.payload;

          recordingState = {
            isRecording: true,
            isPaused: false,
            startTime: Date.now(),
            mode,
            hasAudio,
            hasMic,
            tabId,
          };
          await chrome.storage.local.set({ recordingState });

          // Show "REC" badge on extension icon (not captured in recording)
          showRecordingBadge();
        }

        return response || { success: false, error: 'No response from offscreen' };
      } catch (err) {
        console.error('[ScreenClaw] START_RECORDING error:', err);
        return { success: false, error: err.message };
      }
    }

    case 'ENSURE_OFFSCREEN': {
      await ensureOffscreenDocument();
      return { success: true };
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
        tabId: null,
      };
      await chrome.storage.local.set({ recordingState });

      // Clear badge
      hideRecordingBadge();

      setTimeout(() => closeOffscreenDocument(), 10000);
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
      const history = (await chrome.storage.local.get('recordingHistory')).recordingHistory || [];
      history.unshift({ filename, size, duration, date: new Date().toISOString(), mode: recordingState.mode });
      if (history.length > 50) history.length = 50;
      await chrome.storage.local.set({ recordingHistory: history });
      return { success: true };
    }

    case 'GET_HISTORY': {
      const history = (await chrome.storage.local.get('recordingHistory')).recordingHistory || [];
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

// ── Lifecycle ──────────────────────────────────────────────────────────────

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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
});
