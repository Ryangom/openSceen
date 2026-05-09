# ScreenClaw – Screen & Video Recorder Extension

A premium Chrome extension for recording your screen, webcam, or both with system audio and microphone support. Built with Chrome Manifest V3.

## Features

- **Screen Recording** – Capture your entire screen, a window, or a specific tab
- **Webcam Recording** – Record from your webcam with mirror view
- **Both Mode** – Screen recording with a draggable webcam overlay (PiP)
- **Audio Options** – Toggle system audio and microphone independently
- **Recording Timer** – Real-time elapsed time display with pause support
- **Recording History** – View past recordings with metadata
- **Premium UI** – Dark theme with gradient accents and smooth animations
- **Auto-Download** – Recordings are saved as WebM files automatically

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer Mode** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the `openclaw` project folder
5. The ScreenClaw extension will appear in your toolbar

## Usage

1. Click the **ScreenClaw** icon in the Chrome toolbar
2. Select your **capture mode**: Screen, Webcam, or Both
3. Toggle **System Audio** and **Microphone** as needed
4. Click **Start Recording**
5. If recording screen, choose what to share (screen/window/tab)
6. Use **Pause** / **Stop** controls in the popup
7. Recording is automatically downloaded as `.webm` when stopped
8. View past recordings in the **History** tab

## Project Structure

```
openclaw/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker (state + message routing)
├── content.js             # Content script (webcam overlay + indicator)
├── content.css            # Content script styles
├── icons/                 # Extension icons (16, 32, 48, 128px)
├── popup/
│   ├── popup.html         # Main popup UI
│   ├── popup.css          # Premium dark theme styles
│   └── popup.js           # Popup controller
└── offscreen/
    ├── offscreen.html     # Offscreen document
    └── offscreen.js       # MediaRecorder engine
```

## Tech Stack

- **Chrome Extension Manifest V3**
- **MediaRecorder API** for recording
- **Desktop Capture API** for screen capture
- **getUserMedia** for webcam and microphone
- Vanilla JS, CSS, HTML – zero dependencies

## Browser Compatibility

- Google Chrome 116+
- Microsoft Edge 116+
- Brave (Chromium-based)
