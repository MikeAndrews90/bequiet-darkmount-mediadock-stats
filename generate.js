#!/usr/bin/env node
'use strict';

const sharp = require('sharp');
const si = require('systeminformation');
const { execSync } = require('child_process');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

// PNG written here; IO Center reads it, creates its own UUID copy, pushes to keyboard
const CURRENT_IMAGE = path.join(__dirname, 'current.png');

// Media dock display is landscape 4:3 (app reports "Minimum size 320x240").
// 640x480 is confirmed to scale in cleanly. The bezel/display also clips
// roughly the outer 5px on the left and 9-10px on the bottom, so layout
// below keeps clear margins on those edges.
const W = 640;
const H = 480;

// Colours — red accent matches be quiet! branding (#ff2800 from profile)
const BG      = '#0a0a0f';
const RED     = '#ff2800';
const BLUE    = '#32b4ff';
const GREEN   = '#40c840';
const WHITE   = '#dcdcdc';
const DIM     = '#555560';
const DIVIDER = '#1e1e26';

// ── Stats ─────────────────────────────────────────────────────────────────────

function getNvidiaStat(queryKey) {
  try {
    const out = execSync(
      `nvidia-smi --query-gpu=${queryKey} --format=csv,noheader,nounits`,
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
    ).toString().trim();
    const val = parseFloat(out);
    return isNaN(val) ? null : val;
  } catch (_) {
    return null;
  }
}

// Uses Windows DXGI/WDDM GPU Engine counters — matches Task Manager exactly.
function getWindowsGpuPct() {
  try {
    const ps = `$s=(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop).CounterSamples;[Math]::Round([Math]::Min(100,($s|Measure-Object -Property CookedValue -Sum).Sum))`;
    const out = execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 6000,
    }).toString().trim();
    const val = parseFloat(out);
    return isNaN(val) ? null : val;
  } catch (_) {
    return null;
  }
}

async function getStats() {
  const [load, mem] = await Promise.all([
    si.currentLoad(),
    si.mem(),
  ]);

  const gpuTemp    = getNvidiaStat('temperature.gpu');
  const gpuLoadPct = getWindowsGpuPct();
  const gpuMemPct  = getNvidiaStat('utilization.memory');

  return {
    cpuPct:    Math.round(load.currentLoad),
    ramPct:    Math.round(mem.used / mem.total * 100),
    ramUsedGB: (mem.used  / 1073741824).toFixed(1),
    ramTotGB:  (mem.total / 1073741824).toFixed(0),
    gpuTemp,
    gpuLoadPct,
    gpuMemPct,
  };
}

// ── SVG render ────────────────────────────────────────────────────────────────

function bar(x, y, w, h, pct, fill) {
  const filled = Math.max(0, Math.round(w * Math.min(100, pct) / 100));
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${DIVIDER}" rx="8"/>
    ${filled > 0 ? `<rect x="${x}" y="${y}" width="${filled}" height="${h}" fill="${fill}" rx="8"/>` : ''}`;
}

function tempColor(c) {
  if (c === null) return DIM;
  if (c >= 85) return '#ff4040';
  if (c >= 70) return '#ffb030';
  return '#40c840';
}

function buildSvg(s, now) {
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short'
  });

  // Side padding only needs to clear the ~5px left-edge crop (plus a small
  // buffer) — kept tight so the tiny 4:3 panel is used edge-to-edge.
  const px = 14;
  const bw = W - px * 2;

  const hasGpu = s.gpuTemp !== null || s.gpuLoadPct !== null;
  const tcGpu  = tempColor(s.gpuTemp);

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <!-- ── Clock ── -->
  <text x="${W/2}" y="54"
        text-anchor="middle" font-family="monospace" font-size="64" font-weight="bold"
        fill="${WHITE}">${hh}:${mm}</text>
  <text x="${W/2}" y="88"
        text-anchor="middle" font-family="monospace" font-size="28"
        fill="${DIM}">${dateStr}</text>

  <line x1="${px}" y1="106" x2="${W-px}" y2="106" stroke="${DIVIDER}" stroke-width="4"/>

  <!-- ── CPU ── -->
  <text x="${px}" y="144" font-family="monospace" font-size="42" fill="${RED}">CPU</text>
  <text x="${W-px}" y="144" text-anchor="end" font-family="monospace" font-size="42" fill="${WHITE}">${s.cpuPct}%</text>
  ${bar(px, 154, bw, 16, s.cpuPct, RED)}

  <!-- ── RAM ── -->
  <text x="${px}" y="216" font-family="monospace" font-size="42" fill="${BLUE}">RAM</text>
  <text x="${W-px}" y="216" text-anchor="end" font-family="monospace" font-size="42" fill="${WHITE}">${s.ramPct}%</text>
  ${bar(px, 226, bw, 16, s.ramPct, BLUE)}
  <text x="${px}" y="266" font-family="monospace" font-size="24" fill="${DIM}">${s.ramUsedGB} / ${s.ramTotGB} GB</text>

  ${hasGpu ? `
  <line x1="${px}" y1="284" x2="${W-px}" y2="284" stroke="${DIVIDER}" stroke-width="4"/>

  <!-- ── GPU ── -->
  ${s.gpuLoadPct !== null ? `
  <text x="${px}" y="322" font-family="monospace" font-size="42" fill="${GREEN}">GPU</text>
  <text x="${W-px}" y="322" text-anchor="end" font-family="monospace" font-size="42" fill="${WHITE}">${Math.round(s.gpuLoadPct)}%</text>
  ${bar(px, 332, bw, 16, s.gpuLoadPct, GREEN)}
  ` : ''}

  ${s.gpuMemPct !== null ? `
  <text x="${px}" y="394" font-family="monospace" font-size="42" fill="#a060ff">VRAM</text>
  <text x="${W-px}" y="394" text-anchor="end" font-family="monospace" font-size="42" fill="${WHITE}">${Math.round(s.gpuMemPct)}%</text>
  ${bar(px, 404, bw, 16, s.gpuMemPct, '#a060ff')}
  ` : ''}

  ${s.gpuTemp !== null ? `
  <text x="${px}" y="452" font-family="monospace" font-size="24" fill="${DIM}">GPU temp</text>
  <text x="${W-px}" y="452" text-anchor="end" font-family="monospace" font-size="42" fill="${tcGpu}">${s.gpuTemp}°C</text>
  ` : ''}
  ` : ''}

</svg>`;
}

// ── Image generation (exported for use by automate.js loop) ──────────────────

async function generateImage() {
  const stats = await getStats();
  const now   = new Date();
  const svg   = buildSvg(stats, now);

  await sharp(Buffer.from(svg), { density: 192 }).resize(W, H).png().toFile(CURRENT_IMAGE);

  const gpuInfo = stats.gpuLoadPct !== null
    ? `, GPU ${Math.round(stats.gpuLoadPct)}% @ ${stats.gpuTemp}°C`
    : '';
  console.log(`[${now.toLocaleTimeString()}] CPU ${stats.cpuPct}%  RAM ${stats.ramPct}%${gpuInfo}`);

  return CURRENT_IMAGE;
}

module.exports = { generateImage };

// ── Standalone entry-point: node generate.js → writes current.png ────────────

if (require.main === module) {
  generateImage().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
