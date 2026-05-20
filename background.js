/**
 * ScreenClaw – Background Service Worker
 * Manages recording state, offscreen document lifecycle, and message routing.
 */

let offscreenDocumentExists = false;
let recordingState = {
  isRecording: false,
  isPaused: false,
  startTime: null,
  pauseTime: null,
  mode: null,
  hasAudio: true,
  hasMic: true,
  tabId: null,
};

// Immediately load state from storage to handle service worker recreation
const statePromise = chrome.storage.local.get('recordingState').then((data) => {
  if (data.recordingState) {
    recordingState = data.recordingState;
    if (recordingState.isRecording) {
      showRecordingBadge();
    }
  }
});

async function ensureOffscreenDocument() {
   if (offscreenDocumentExists) return;
   try {
     if (chrome.runtime.getContexts) {
       const existingContexts = await chrome.runtime.getContexts({
         contextTypes: ['OFFSCREEN_DOCUMENT'],
       });
       if (existingContexts.length > 0) {
         offscreenDocumentExists = true;
         return;
       }
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
// It flashes on/off like a classic recording light for visibility.

let badgeFlashInterval = null;
let badgeVisible = true;

function showRecordingBadge() {
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff4d6d' });
  chrome.action.setTitle({ title: 'ScreenClaw – Recording in progress…' });

  // Flash the badge on/off every 800ms
  badgeVisible = true;
  if (badgeFlashInterval) clearInterval(badgeFlashInterval);
  badgeFlashInterval = setInterval(() => {
    badgeVisible = !badgeVisible;
    chrome.action.setBadgeText({ text: badgeVisible ? 'REC' : '' });
    chrome.action.setBadgeBackgroundColor({ color: badgeVisible ? '#ff4d6d' : '#8b0000' });
  }, 800);
}

function hideRecordingBadge() {
  if (badgeFlashInterval) {
    clearInterval(badgeFlashInterval);
    badgeFlashInterval = null;
  }
  chrome.action.setBadgeText({ text: '' });
  chrome.action.setTitle({ title: 'ScreenClaw – Screen & Video Recorder' });
}

async function broadcastStateChange() {
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', state: recordingState }).catch(() => {});
  if (recordingState.tabId) {
    chrome.tabs.sendMessage(recordingState.tabId, { type: 'RECORDING_STATE_CHANGED', state: recordingState }).catch(() => {});
  }
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
  await statePromise;
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
            pauseTime: null,
            mode,
            hasAudio,
            hasMic,
            tabId,
          };
          await chrome.storage.local.set({ recordingState });

          // Show "REC" badge on extension icon (not captured in recording)
          showRecordingBadge();

          if (mode === 'both' && tabId) {
            chrome.tabs.sendMessage(tabId, { type: 'SHOW_WEBCAM_OVERLAY' }).catch((err) => {
              console.warn('[ScreenClaw] SHOW_WEBCAM_OVERLAY message not received (tab may have changed or closed):', err.message);
            });
          }
          if (tabId) {
            chrome.tabs.sendMessage(tabId, { type: 'SHOW_CONTROLS_OVERLAY' }).catch((err) => {
              console.warn('[ScreenClaw] SHOW_CONTROLS_OVERLAY message not received:', err.message);
            });
          }
          await broadcastStateChange();
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
      const mode = recordingState.mode;
      const tabId = recordingState.tabId;

      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_STOP',
        target: 'offscreen',
      });

      if (mode === 'both' && tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'HIDE_WEBCAM_OVERLAY' }).catch((err) => {
          console.warn('[ScreenClaw] HIDE_WEBCAM_OVERLAY message not received (tab may have changed or closed):', err.message);
        });
      }
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'HIDE_CONTROLS_OVERLAY' }).catch((err) => {
          console.warn('[ScreenClaw] HIDE_CONTROLS_OVERLAY message not received:', err.message);
        });
      }

      recordingState = {
        isRecording: false,
        isPaused: false,
        startTime: null,
        pauseTime: null,
        mode: null,
        hasAudio: true,
        hasMic: true,
        tabId: null,
      };
      await chrome.storage.local.set({ recordingState });

      // Clear badge
      hideRecordingBadge();
      await broadcastStateChange();

      setTimeout(() => closeOffscreenDocument(), 10000);
      return response;
    }

    case 'CANCEL_RECORDING': {
      const mode = recordingState.mode;
      const tabId = recordingState.tabId;

      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_CANCEL',
        target: 'offscreen',
      });

      if (mode === 'both' && tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'HIDE_WEBCAM_OVERLAY' }).catch(() => {});
      }
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'HIDE_CONTROLS_OVERLAY' }).catch(() => {});
      }

      recordingState = {
        isRecording: false,
        isPaused: false,
        startTime: null,
        pauseTime: null,
        mode: null,
        hasAudio: true,
        hasMic: true,
        tabId: null,
      };
      await chrome.storage.local.set({ recordingState });

      hideRecordingBadge();
      await broadcastStateChange();

      setTimeout(() => closeOffscreenDocument(), 10000);
      return response;
    }

    case 'PAUSE_RECORDING': {
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_PAUSE',
        target: 'offscreen',
      });
      recordingState.isPaused = true;
      recordingState.pauseTime = Date.now();
      await chrome.storage.local.set({ recordingState });
      await broadcastStateChange();
      return response;
    }

    case 'RESUME_RECORDING': {
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_RESUME',
        target: 'offscreen',
      });
      if (recordingState.pauseTime) {
        const pauseDuration = Date.now() - recordingState.pauseTime;
        recordingState.startTime += pauseDuration;
        recordingState.pauseTime = null;
      }
      recordingState.isPaused = false;
      await chrome.storage.local.set({ recordingState });
      await broadcastStateChange();
      return response;
    }

    case 'GET_STATE': {
      const isSenderTab = !!(sender.tab && recordingState.tabId === sender.tab.id);
      return { success: true, state: recordingState, isSenderTab };
    }

    case 'RECORDING_SAVED': {
      const { filename, size, duration, mode } = message.payload;
      const history = (await chrome.storage.local.get('recordingHistory')).recordingHistory || [];
      const recordingMode = mode || recordingState.mode || 'screen';
      history.unshift({ filename, size, duration, date: new Date().toISOString(), mode: recordingMode });
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
  await statePromise;
  if (recordingState && recordingState.isRecording) {
    recordingState = {
      isRecording: false,
      isPaused: false,
      startTime: null,
      pauseTime: null,
      mode: null,
      hasAudio: true,
      hasMic: true,
      tabId: null,
    };
    await chrome.storage.local.set({ recordingState });
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
});
