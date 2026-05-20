/**
 * ScreenClaw – Popup Controller
 * Manages UI state, recording controls, timer, and history rendering.
 */

// ── DOM Elements ───────────────────────────────────────────────────────────

const app = document.getElementById('app');
const btnRecord = document.getElementById('btn-record');
const btnPause = document.getElementById('btn-pause');
const btnStop = document.getElementById('btn-stop');
const secondaryActions = document.getElementById('secondary-actions');
const timerDisplay = document.getElementById('timer-display');
const timerText = document.getElementById('timer-text');
const toggleAudio = document.getElementById('toggle-audio');
const toggleMic = document.getElementById('toggle-mic');
const historyList = document.getElementById('history-list');
const emptyState = document.getElementById('empty-state');
const btnClearHistory = document.getElementById('btn-clear-history');

let selectedMode = 'screen';
let timerInterval = null;
let elapsedSeconds = 0;
let isPaused = false;

// ── Initialization ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupModeCards();
  setupRecordingButtons();
  await restoreState();
  await loadHistory();
});

// ── Tab Navigation ─────────────────────────────────────────────────────────

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) target.classList.add('active');

      if (tab.dataset.tab === 'history') loadHistory();
    });
  });
}

// ── Mode Selection ─────────────────────────────────────────────────────────

function setupModeCards() {
  const cards = document.querySelectorAll('.mode-card');
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      selectedMode = card.dataset.mode;

      // Show/hide audio toggle based on mode
      const audioRow = toggleAudio.closest('.toggle-row');
      if (selectedMode === 'webcam') {
        audioRow.style.opacity = '0.4';
        audioRow.style.pointerEvents = 'none';
      } else {
        audioRow.style.opacity = '1';
        audioRow.style.pointerEvents = 'auto';
      }
    });
  });
}

// ── Recording Controls ─────────────────────────────────────────────────────

function setupRecordingButtons() {
  btnRecord.addEventListener('click', startRecording);
  btnStop.addEventListener('click', stopRecording);
  btnPause.addEventListener('click', togglePause);
}


async function askForMicrophonePermission() {
  try {
    // This triggers the browser microphone permission prompt.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // We only needed permission here, so release the test stream.
    stream.getTracks().forEach((track) => track.stop());

    return true;
  } catch (micErr) {
    let logMsg = `Microphone permission not granted: ${micErr?.name} - ${micErr?.message}`;
    if (micErr?.constraint) logMsg += ` | Constraint: ${micErr.constraint}`;
    if (micErr?.stack) logMsg += `\nStack: ${micErr.stack}`;
    console.log(logMsg);

    let message =
      'Microphone access is required to record your voice.\n\n' +
      'Click OK to open Extension settings and allow Microphone access.\n' +
      'Click Cancel to continue recording without microphone audio.';

    if (micErr?.name === 'NotFoundError') {
      message =
        'No microphone was found.\n\n' +
        'Connect or enable a microphone, then try again.\n\n' +
        'Click OK to open Extension settings.\n' +
        'Click Cancel to continue without microphone audio.';
    }

    if (micErr?.name === 'NotReadableError') {
      message =
        'Chrome could not read from your microphone.\n\n' +
        'Another app may be using it, or your OS privacy settings may be blocking it.\n\n' +
        'Click OK to open Extension settings.\n' +
        'Click Cancel to continue without microphone audio.';
    }

    const openSettings = confirm(message);

    if (openSettings) {
      chrome.tabs.create({
        url: `chrome://settings/content/siteDetails?site=chrome-extension://${chrome.runtime.id}`,
      });

      // Stop here so the user can fix permission and try again.
      return null;
    }

    // User chose to continue without mic.
    return false;
  }
}

async function startRecording() {
  btnRecord.disabled = true;
  btnRecord.querySelector('span').textContent = 'Starting...';

  try {
    let micAllowed = false;

    if (toggleMic.checked) {
      const permissionResult = await askForMicrophonePermission();

      if (permissionResult === null) {
        btnRecord.disabled = false;
        btnRecord.querySelector('span').textContent = 'Start Recording';
        return;
      }

      micAllowed = permissionResult;
    }

    let tabId = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        tabId = tabs[0].id;
      }
    } catch (e) {}

    const result = await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      payload: {
        mode: selectedMode,
        hasAudio: toggleAudio.checked,
        hasMic: micAllowed,
        tabId: tabId,
      },
    });

    if (!result || !result.success) {
      throw new Error(result?.error || 'Failed to start recording');
    }

    window.close();
  } catch (err) {
    let errMsg = `Start recording error: ${err?.name} - ${err?.message}`;
    if (err?.stack) errMsg += `\nStack: ${err.stack}`;
    console.error(errMsg);

    btnRecord.disabled = false;
    btnRecord.querySelector('span').textContent = 'Error - Try Again';

    setTimeout(() => {
      btnRecord.querySelector('span').textContent = 'Start Recording';
    }, 2000);
  }
}

async function stopRecording() {
  btnStop.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  } catch (err) {
    console.error('Stop recording error:', err);
  }
  exitRecordingUI();
}

async function togglePause() {
  if (isPaused) {
    await chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
    isPaused = false;
    btnPause.textContent = 'Pause';
    timerDisplay.classList.remove('paused');
    resumeTimer();
  } else {
    await chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
    isPaused = true;
    btnPause.textContent = 'Resume';
    timerDisplay.classList.add('paused');
    pauseTimer();
  }
}

// ── UI State Transitions ───────────────────────────────────────────────────

function enterRecordingUI() {
  app.classList.add('recording');
  btnRecord.classList.add('hidden');
  secondaryActions.classList.remove('hidden');
  timerDisplay.classList.remove('hidden');

  // Disable mode cards and toggles
  document.querySelectorAll('.mode-card').forEach((c) => {
    c.style.pointerEvents = 'none';
    c.style.opacity = '0.5';
  });

  // elapsedSeconds is set in restoreState if restoring, else 0
  startTimer(elapsedSeconds || 0);
}

function exitRecordingUI() {
  app.classList.remove('recording');
  btnRecord.classList.remove('hidden');
  btnRecord.disabled = false;
  btnRecord.querySelector('span').textContent = 'Start Recording';
  secondaryActions.classList.add('hidden');
  timerDisplay.classList.add('hidden');
  timerDisplay.classList.remove('paused');
  isPaused = false;
  btnPause.textContent = 'Pause';
  btnStop.disabled = false;

  // Re-enable mode cards
  document.querySelectorAll('.mode-card').forEach((c) => {
    c.style.pointerEvents = 'auto';
    c.style.opacity = '1';
  });

  stopTimer();
}

// ── Timer ──────────────────────────────────────────────────────────────────

function startTimer(initial = 0) {
  elapsedSeconds = initial;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function pauseTimer() {
  clearInterval(timerInterval);
}

function resumeTimer() {
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  elapsedSeconds = 0;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const h = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(elapsedSeconds % 60).padStart(2, '0');
  timerText.textContent = `${h}:${m}:${s}`;
}

// ── State Restoration ──────────────────────────────────────────────────────

async function restoreState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (response && response.success && response.state.isRecording) {
      selectedMode = response.state.mode;

      // Highlight correct mode card
      document.querySelectorAll('.mode-card').forEach((c) => c.classList.remove('active'));
      const activeCard = document.querySelector(`[data-mode="${selectedMode}"]`);
      if (activeCard) activeCard.classList.add('active');

      toggleAudio.checked = response.state.hasAudio;
      toggleMic.checked = response.state.hasMic;

      // Restore timer
      if (response.state.startTime) {
        if (response.state.isPaused && response.state.pauseTime) {
          elapsedSeconds = Math.floor((response.state.pauseTime - response.state.startTime) / 1000);
        } else {
          elapsedSeconds = Math.floor((Date.now() - response.state.startTime) / 1000);
        }
      }

      enterRecordingUI();

      if (response.state.isPaused) {
        isPaused = true;
        btnPause.textContent = 'Resume';
        timerDisplay.classList.add('paused');
        pauseTimer();
      }
    }
  } catch (err) {
    console.error('State restore error:', err);
  }
}

// ── History ────────────────────────────────────────────────────────────────

async function loadHistory() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
    if (!response || !response.success) return;
    const history = response.history || [];
    renderHistory(history);
  } catch (err) {
    console.error('Load history error:', err);
  }
}

function renderHistory(history) {
  historyList.querySelectorAll('.history-item').forEach((el) => el.remove());

  if (history.length === 0) {
    emptyState.style.display = 'flex';
    btnClearHistory.classList.add('hidden');
    return;
  }

  emptyState.style.display = 'none';
  btnClearHistory.classList.remove('hidden');

  history.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'history-item';

    const modeIcon = item.mode === 'webcam' ? '🎥' : item.mode === 'both' ? '🎬' : '🖥️';
    const size = formatFileSize(item.size);
    const duration = formatDuration(item.duration);
    const date = new Date(item.date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    el.innerHTML = `
      <div class="history-icon">${modeIcon}</div>
      <div class="history-info">
        <div class="history-name">${item.filename}</div>
        <div class="history-meta">${duration} · ${size} · ${date}</div>
      </div>
    `;
    historyList.appendChild(el);
  });

  btnClearHistory.onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    renderHistory([]);
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

function formatDuration(seconds) {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
