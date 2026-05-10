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

// ── Recording Indicator via chrome.scripting ───────────────────────────────
// This injects the overlay DIRECTLY into tabs using chrome.scripting API.
// It does NOT depend on content scripts being loaded.

async function showRecordingOverlayOnAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      // Skip restricted tabs
      if (!tab.id || tab.id === chrome.tabs.TAB_ID_NONE) continue;
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) continue;

      try {
        // First inject the CSS
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          css: `
            #screenclaw-rec-indicator {
              position: fixed !important;
              top: 16px !important;
              left: 50% !important;
              transform: translateX(-50%) !important;
              display: flex !important;
              align-items: center !important;
              gap: 8px !important;
              padding: 8px 16px !important;
              background: rgba(11, 11, 16, 0.9) !important;
              backdrop-filter: blur(12px) !important;
              border: 1px solid rgba(255, 77, 109, 0.4) !important;
              border-radius: 24px !important;
              color: #ff4d6d !important;
              font-family: -apple-system, 'Segoe UI', sans-serif !important;
              font-size: 12px !important;
              font-weight: 700 !important;
              letter-spacing: 1.5px !important;
              z-index: 2147483647 !important;
              box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
              pointer-events: none !important;
              animation: screenclaw-fadeIn 0.3s ease-out !important;
            }
            #screenclaw-rec-dot {
              width: 8px !important;
              height: 8px !important;
              border-radius: 50% !important;
              background: #ff4d6d !important;
              animation: screenclaw-blink 1.2s ease-in-out infinite !important;
              flex-shrink: 0 !important;
            }
            #screenclaw-rec-border {
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              width: 100vw !important;
              height: 100vh !important;
              border: 4px solid rgba(255, 77, 109, 0.7) !important;
              pointer-events: none !important;
              z-index: 2147483646 !important;
              box-sizing: border-box !important;
            }
            @keyframes screenclaw-blink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.3; }
            }
            @keyframes screenclaw-fadeIn {
              from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
              to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
          `,
        });

        // Then inject the JS to create the DOM elements
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Avoid duplicates
            if (document.getElementById('screenclaw-rec-indicator')) return;

            // Pill badge
            const pill = document.createElement('div');
            pill.id = 'screenclaw-rec-indicator';
            const dot = document.createElement('div');
            dot.id = 'screenclaw-rec-dot';
            const text = document.createElement('span');
            text.textContent = 'RECORDING';
            pill.appendChild(dot);
            pill.appendChild(text);
            document.documentElement.appendChild(pill);

            // Border overlay
            const border = document.createElement('div');
            border.id = 'screenclaw-rec-border';
            document.documentElement.appendChild(border);

            console.log('[ScreenClaw] Recording overlay injected via scripting API');
          },
        });
      } catch (tabErr) {
        // Tab might be restricted, ignore
      }
    }
  } catch (err) {
    console.error('[ScreenClaw] showRecordingOverlayOnAllTabs error:', err);
  }
}

async function hideRecordingOverlayOnAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || tab.id === chrome.tabs.TAB_ID_NONE) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const pill = document.getElementById('screenclaw-rec-indicator');
            if (pill) pill.remove();
            const border = document.getElementById('screenclaw-rec-border');
            if (border) border.remove();
            console.log('[ScreenClaw] Recording overlay removed');
          },
        });
      } catch (tabErr) {
        // ignore
      }
    }
  } catch (err) {
    console.error('[ScreenClaw] hideRecordingOverlayOnAllTabs error:', err);
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

          console.log('[ScreenClaw] Recording started – injecting overlay into all tabs');
          // Directly inject the overlay using chrome.scripting API
          await showRecordingOverlayOnAllTabs();
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

      console.log('[ScreenClaw] Recording stopped – removing overlay from all tabs');
      await hideRecordingOverlayOnAllTabs();

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

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }

  // Re-inject content scripts into all existing tabs after install/update
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || tab.id === chrome.tabs.TAB_ID_NONE) continue;
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content.css'],
        });
      } catch (e) {
        // Restricted tab, ignore
      }
    }
  } catch (e) {
    console.error('[ScreenClaw] Failed to re-inject content scripts:', e);
  }
});
