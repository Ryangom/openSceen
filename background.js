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
  displaySurface: null,
};

async function logDebug(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const logMsg = `[Background ${timestamp}] ${msg}`;
  console.log(logMsg);
  try {
    const data = await chrome.storage.local.get('debugLogs');
    const logs = data.debugLogs || [];
    logs.push(logMsg);
    if (logs.length > 200) logs.shift();
    await chrome.storage.local.set({ debugLogs: logs });
  } catch (e) {}
}

// Immediately load state from storage to handle service worker recreation
const statePromise = chrome.storage.local.get(['recordingState']).then((data) => {
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

async function ensureContentScriptInjected(tabId) {
  await logDebug(`ensureContentScriptInjected called for tab ${tabId}`);
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || tab.url.startsWith('chrome:') || tab.url.startsWith('chrome-extension:') || tab.url.startsWith('about:')) {
      await logDebug(`Tab ${tabId} is restricted (${tab?.url || 'unknown URL'}), skipping injection.`);
      return;
    }
  } catch (e) {
    await logDebug(`Error getting info for tab ${tabId}: ${e.message}`);
    return;
  }

  try {
    await logDebug(`Pinging content script on tab ${tabId}...`);
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    await logDebug(`Ping succeeded for tab ${tabId}, content script is already active.`);
  } catch (err) {
    await logDebug(`Ping failed (content script inactive) on tab ${tabId}. Error: ${err.message}. Programmatically injecting...`);
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content.css']
      });
      await logDebug(`content.css injected successfully on tab ${tabId}`);

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      await logDebug(`content.js injected successfully on tab ${tabId}`);

      // Small pause to allow initialization
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch (injectErr) {
      await logDebug(`Failed to inject content script on tab ${tabId}: ${injectErr.message}`);
    }
  }
}

async function showOverlaysOnTab(tabId) {
  await logDebug(`showOverlaysOnTab called for tab ${tabId}`);
  if (!tabId) return;

  // Verify the tab exists and is injectable
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || tab.url.startsWith('chrome:') || tab.url.startsWith('chrome-extension:') || tab.url.startsWith('about:') || tab.url.startsWith('edge:')) {
      await logDebug(`Tab ${tabId} is a restricted page (${tab?.url}), skipping overlay.`);
      return;
    }
  } catch (e) {
    await logDebug(`Tab ${tabId} does not exist or error checking: ${e.message}`);
    return;
  }

  await ensureContentScriptInjected(tabId);
  
  // Small delay to allow content script to fully initialize
  await new Promise(resolve => setTimeout(resolve, 200));
  
  if (recordingState.isRecording) {
    await logDebug(`Sending show overlay messages to tab ${tabId} (mode: ${recordingState.mode})...`);
    if (recordingState.mode === 'both') {
      chrome.tabs.sendMessage(tabId, { type: 'SHOW_WEBCAM_OVERLAY' }).then(() => {
        logDebug(`SHOW_WEBCAM_OVERLAY received by tab ${tabId}`);
      }).catch((err) => {
        logDebug(`SHOW_WEBCAM_OVERLAY message not received on tab ${tabId}: ${err.message}`);
      });
    }
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_CONTROLS_OVERLAY' }).then(() => {
      logDebug(`SHOW_CONTROLS_OVERLAY received by tab ${tabId}`);
    }).catch((err) => {
      logDebug(`SHOW_CONTROLS_OVERLAY message not received on tab ${tabId}: ${err.message}`);
    });
    chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STATE_CHANGED', state: recordingState }).catch(() => {});
  } else {
    await logDebug(`Not showing overlays: isRecording is false`);
  }
}

async function hideOverlaysOnTab(tabId) {
  console.log(`[ScreenClaw] hideOverlaysOnTab called for tab ${tabId}`);
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { type: 'HIDE_WEBCAM_OVERLAY' }).catch(() => {});
  chrome.tabs.sendMessage(tabId, { type: 'HIDE_CONTROLS_OVERLAY' }).catch(() => {});
}

async function broadcastStateChange() {
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', state: recordingState }).catch(() => {});
  if (recordingState.tabId) {
    chrome.tabs.sendMessage(recordingState.tabId, { type: 'RECORDING_STATE_CHANGED', state: recordingState }).catch(() => {});
  }
}

// ── Message Handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`[ScreenClaw] Background service worker received message: ${message.type}`);
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
        await chrome.storage.local.set({ debugLogs: [] }); // Clear logs on start
        await logDebug(`START_RECORDING message received, payload: ${JSON.stringify(message.payload)}`);
        await ensureOffscreenDocument();

        // Give offscreen a moment to initialize its listeners
        await new Promise(resolve => setTimeout(resolve, 300));

        // Resolve the tabId from the payload (sent by popup)
        let tabId = message.payload.tabId || (sender.tab ? sender.tab.id : null);
        await logDebug(`Initial tabId resolved: ${tabId}`);
        if (!tabId) {
          try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0) {
              tabId = tabs[0].id;
              await logDebug(`Resolved tabId from query: ${tabId}`);
            }
          } catch (err) {
            await logDebug(`Failed to get active tab via query: ${err.message}`);
          }
        }

        await logDebug(`Sending OFFSCREEN_START to offscreen doc...`);
        // Forward start command to offscreen document
        const response = await chrome.runtime.sendMessage({
          type: 'OFFSCREEN_START',
          target: 'offscreen',
          payload: message.payload,
        });
        await logDebug(`OFFSCREEN_START response: ${JSON.stringify(response)}`);

        if (response && response.success) {
          const { mode, hasAudio, hasMic } = message.payload;
          const displaySurface = response.displaySurface;

          recordingState = {
            isRecording: true,
            isPaused: false,
            startTime: Date.now(),
            pauseTime: null,
            mode,
            hasAudio,
            hasMic,
            tabId,
            displaySurface,
          };
          await chrome.storage.local.set({ recordingState });

          // Show "REC" badge on extension icon (not captured in recording)
          showRecordingBadge();

          // Wait for popup to close and tab focus to settle
          await new Promise(resolve => setTimeout(resolve, 500));

          // Re-resolve the active tab since the popup may have closed
          // and the active tab may have changed
          try {
            const currentTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            await logDebug(`Re-resolved currentTabs: ${JSON.stringify(currentTabs.map(t => ({ id: t.id, url: t.url })))}`);
            if (currentTabs.length > 0) {
              const newTabId = currentTabs[0].id;
              // Only use the new tab if it's a regular page
              const newTab = currentTabs[0];
              if (newTab.url && !newTab.url.startsWith('chrome:') && !newTab.url.startsWith('chrome-extension:') && !newTab.url.startsWith('about:')) {
                tabId = newTabId;
                recordingState.tabId = tabId;
                await chrome.storage.local.set({ recordingState });
                await logDebug(`Updated tabId to re-resolved tabId: ${tabId}`);
              } else {
                await logDebug(`Re-resolved tab was restricted: ${newTab.url}, keeping original tabId ${tabId}`);
              }
            }
          } catch (e) {
            await logDebug(`Could not re-resolve active tab: ${e.message}`);
          }

          // Show in-tab overlays on the active tab
          await showOverlaysOnTab(tabId);
          await broadcastStateChange();
        }

        return response || { success: false, error: 'No response from offscreen' };
      } catch (err) {
        await logDebug(`START_RECORDING caught error: ${err.message}`);
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

      await hideOverlaysOnTab(tabId);

      recordingState = {
        isRecording: false,
        isPaused: false,
        startTime: null,
        pauseTime: null,
        mode: null,
        hasAudio: true,
        hasMic: true,
        tabId: null,
        displaySurface: null,
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

      await hideOverlaysOnTab(tabId);

      recordingState = {
        isRecording: false,
        isPaused: false,
        startTime: null,
        pauseTime: null,
        mode: null,
        hasAudio: true,
        hasMic: true,
        tabId: null,
        displaySurface: null,
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

// ── Tab Event Listeners ────────────────────────────────────────────────────
// Ensure overlays follow the user's active tab when switching or reloading tabs

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await statePromise;
  if (recordingState && recordingState.isRecording) {
    const oldTabId = recordingState.tabId;
    const newTabId = activeInfo.tabId;
    await logDebug(`onActivated event fired: switching from tab ${oldTabId} to ${newTabId}`);
    
    if (oldTabId && oldTabId !== newTabId) {
      await hideOverlaysOnTab(oldTabId);
    }
    
    recordingState.tabId = newTabId;
    await chrome.storage.local.set({ recordingState });
    
    await showOverlaysOnTab(newTabId);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await statePromise;
  if (recordingState && recordingState.isRecording && tabId === recordingState.tabId) {
    await logDebug(`onUpdated event fired for active recording tab ${tabId}, changeInfo: ${JSON.stringify(changeInfo)}`);
    if (changeInfo.status === 'complete') {
      await showOverlaysOnTab(tabId);
    }
  }
});

