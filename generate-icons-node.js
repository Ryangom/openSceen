/**
 * Run this script to generate icon PNG files.
 * Usage: Open generate-icons.html in Chrome, click "Download All Icons",
 * then copy the downloaded files to the icons/ folder.
 * 
 * Or run: node generate-icons-node.js
 * (requires: npm install canvas)
 */

const fs = require('fs');
const path = require('path');

let createCanvas;
try {
  createCanvas = require('canvas').createCanvas;
} catch (e) {
  console.log('The "canvas" npm package is not installed.');
  console.log('Alternative: Open generate-icons.html in Chrome and click "Download All Icons"');
  console.log('Then copy icon16.png, icon32.png, icon48.png, icon128.png to the icons/ folder.');
  process.exit(0);
}

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size;
  const cx = s / 2, cy = s / 2;

  // Background with rounded rect
  ctx.fillStyle = '#0f0f14';
  ctx.beginPath();
  const r = s * 0.18;
  ctx.moveTo(r, 0);
  ctx.lineTo(s - r, 0);
  ctx.quadraticCurveTo(s, 0, s, r);
  ctx.lineTo(s, s - r);
  ctx.quadraticCurveTo(s, s, s - r, s);
  ctx.lineTo(r, s);
  ctx.quadraticCurveTo(0, s, 0, s - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // Outer ring gradient
  const grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, '#ff4d6d');
  grad.addColorStop(1, '#c9184a');

  ctx.strokeStyle = grad;
  ctx.lineWidth = s * 0.06;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
  ctx.stroke();

  // Inner filled circle
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Center dot
  ctx.fillStyle = '#0f0f14';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.08, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 32, 48, 128].forEach(size => {
  const canvas = drawIcon(size);
  const buffer = canvas.toBuffer('image/png');
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, buffer);
  console.log(`Created ${filePath}`);
});

console.log('All icons generated successfully!');
