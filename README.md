# ScreenClaw – Screen & Video Recorder Extension

A premium Chrome extension for recording your screen, webcam, or both with system audio and microphone support. Built with Chrome Manifest V3.

## Features

- **Screen Recording**: Capture your entire screen, a window, or a specific tab
- **Webcam Recording**: Record from your webcam with mirror view
- **Combined Mode**: Screen recording with a draggable webcam overlay (Picture-in-Picture)
- **Audio Controls**: Independently toggle system audio and microphone
- **Recording Timer**: Real-time elapsed time display with pause functionality
- **Recording History**: View past recordings with metadata
- **Premium UI**: Dark theme with gradient accents and smooth animations
- **Auto-Download**: Recordings are automatically saved as WebM files

## Prerequisites

- Google Chrome version 116 or later
- Microsoft Edge version 116 or later (for Edge users)
- Developer mode enabled in your browser

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer Mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select the `openclaw` project folder
5. The ScreenClaw extension will appear in your toolbar

## Usage

1. Click the **ScreenClaw** icon in the Chrome toolbar
2. Select your **capture mode**: Screen, Webcam, or Both
3. Toggle **System Audio** and **Microphone** as needed
4. Click **Start Recording**
5. If recording the screen, choose what to share (entire screen, window, or tab)
6. Use the **Pause** / **Stop** controls in the popup
7. The recording is automatically downloaded as a `.webm` file when stopped
8. View past recordings in the **History** tab

## Project Structure

```
openclaw/
├── manifest.json          # Extension manifest (Manifest V3)
├── background.js          # Service worker (state management + message routing)
├── content.js             # Content script (webcam overlay + recording indicator)
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
- **getUserMedia API** for webcam and microphone access
- Vanilla JavaScript, CSS, HTML – no external dependencies

## Browser Compatibility

- Google Chrome 116+
- Microsoft Edge 116+
- Brave (Chromium-based browsers)

## Development

To set up the development environment:

1. Clone the repository: `git clone <repository-url>`
2. Open Chrome and go to `chrome://extensions/`
3. Enable Developer Mode
4. Click "Load unpacked" and select the project directory
5. Make changes to the code and reload the extension

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
