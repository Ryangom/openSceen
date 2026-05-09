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

async function startRecording() {
  btnRecord.disabled = true;
  btnRecord.querySelector('span').textContent = 'Starting...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      payload: {
        mode: selectedMode,
        hasAudio: toggleAudio.checked,
        hasMic: toggleMic.checked,
      },
    });

    if (response && response.success) {
      enterRecordingUI();
    } else {
      throw new Error(response?.error || 'Failed to start recording');
    }
  } catch (err) {
    console.error('Start recording error:', err);
    btnRecord.disabled = false;
    btnRecord.querySelector('span').textContent = 'Start Recording';

    // Show error briefly
    btnRecord.querySelector('span').textContent = err.message.includes('cancelled')
      ? 'Cancelled'
      : 'Error – Try Again';
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

  elapsedSeconds = 0;
  startTimer();
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

function startTimer() {
  elapsedSeconds = 0;
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

      enterRecordingUI();

      // Restore timer
      if (response.state.startTime) {
        elapsedSeconds = Math.floor((Date.now() - response.state.startTime) / 1000);
        updateTimerDisplay();
      }

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
  // Clear existing items except empty state
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

  // Clear history button
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
