let timerInterval = null;
let webcamStream = null;

// Initial state fetch
chrome.runtime.sendMessage({ type: 'GET_STATE' }).then((response) => {
  if (response && response.success && response.state) {
    updateUI(response.state);
    if (response.state.mode === 'both') {
      initWebcam();
    }
  }
}).catch((err) => console.error('[Overlay Window] Failed to get state:', err));

// State change listener
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATE_CHANGED' || message.type === 'RECORDING_STATE_CHANGED') {
    updateUI(message.state);
  }
});

function updateUI(state) {
  if (!state.isRecording) {
    closeWebcam();
    window.close();
    return;
  }

  const container = document.getElementById('overlay-container');
  const btnPause = document.getElementById('btn-pause');

  if (state.isPaused) {
    container.classList.add('paused');
    btnPause.classList.add('paused');
  } else {
    container.classList.remove('paused');
    btnPause.classList.remove('paused');
  }

  startTimer(state.startTime, state.isPaused, state.pauseTime);
}

function startTimer(startTime, isPaused, pauseTime) {
  if (timerInterval) clearInterval(timerInterval);

  const updateDisplay = () => {
    let elapsed = 0;
    if (startTime) {
      if (isPaused && pauseTime) {
        elapsed = Math.floor((pauseTime - startTime) / 1000);
      } else {
        elapsed = Math.floor((Date.now() - startTime) / 1000);
      }
    }
    if (elapsed < 0) elapsed = 0;

    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('timer-display').textContent = `${m}:${s}`;
  };

  updateDisplay();

  if (!isPaused) {
    timerInterval = setInterval(updateDisplay, 1000);
  }
}

// Webcam stream handler
async function initWebcam() {
  const webcamSection = document.getElementById('webcam-section');
  webcamSection.style.display = 'block';

  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' },
      audio: false,
    });
    const video = document.getElementById('webcam-preview');
    video.srcObject = webcamStream;
  } catch (err) {
    console.error('[Overlay Window] Cannot access webcam:', err);
  }
}

function closeWebcam() {
  if (webcamStream) {
    webcamStream.getTracks().forEach((track) => track.stop());
    webcamStream = null;
  }
}

// Button actions
document.getElementById('btn-pause').addEventListener('click', () => {
  const isPaused = document.getElementById('overlay-container').classList.contains('paused');
  chrome.runtime.sendMessage({ type: isPaused ? 'RESUME_RECORDING' : 'PAUSE_RECORDING' });
});

document.getElementById('btn-stop').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
});

document.getElementById('btn-cancel').addEventListener('click', () => {
  if (confirm('Are you sure you want to cancel and discard this recording?')) {
    chrome.runtime.sendMessage({ type: 'CANCEL_RECORDING' });
  }
});

// Clean up when window is closed/unloaded
window.addEventListener('beforeunload', () => {
  closeWebcam();
  if (timerInterval) clearInterval(timerInterval);
});
