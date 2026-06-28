#!/usr/bin/env node
'use strict';

const sharp = require('sharp');
const si = require('systeminformation');
const { execSync } = require('child_process');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

// PNG written here; IO Center reads it, creates its own UUID copy, pushes to keyboard
const CURRENT_IMAGE = path.join(__dirname, 'current.png');

const W = 512;
const H = 640;

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

  const px = 40;
  const bw = W - px * 2;

  const hasGpu = s.gpuTemp !== null || s.gpuLoadPct !== null;
  const tcGpu  = tempColor(s.gpuTemp);

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <!-- ── Clock ── -->
  <text x="${W/2}" y="72"
        text-anchor="middle" font-family="monospace" font-size="72" font-weight="bold"
        fill="${WHITE}">${hh}:${mm}</text>
  <text x="${W/2}" y="106"
        text-anchor="middle" font-family="monospace" font-size="30"
        fill="${DIM}">${dateStr}</text>

  <line x1="${px}" y1="124" x2="${W-px}" y2="124" stroke="${DIVIDER}" stroke-width="5"/>

  <!-- ── CPU ── -->
  <text x="${px}" y="162" font-family="monospace" font-size="40" fill="${RED}">CPU</text>
  <text x="${W-px}" y="162" text-anchor="end" font-family="monospace" font-size="40" fill="${WHITE}">${s.cpuPct}%</text>
  ${bar(px, 170, bw, 14, s.cpuPct, RED)}

  <!-- ── RAM ── -->
  <text x="${px}" y="234" font-family="monospace" font-size="40" fill="${BLUE}">RAM</text>
  <text x="${W-px}" y="234" text-anchor="end" font-family="monospace" font-size="40" fill="${WHITE}">${s.ramPct}%</text>
  ${bar(px, 242, bw, 14, s.ramPct, BLUE)}
  <text x="${px}" y="286" font-family="monospace" font-size="30" fill="${DIM}">${s.ramUsedGB} / ${s.ramTotGB} GB</text>

  ${hasGpu ? `
  <line x1="${px}" y1="303" x2="${W-px}" y2="303" stroke="${DIVIDER}" stroke-width="5"/>

  <!-- ── GPU ── -->
  ${s.gpuLoadPct !== null ? `
  <text x="${px}" y="343" font-family="monospace" font-size="40" fill="${GREEN}">GPU</text>
  <text x="${W-px}" y="343" text-anchor="end" font-family="monospace" font-size="40" fill="${WHITE}">${Math.round(s.gpuLoadPct)}%</text>
  ${bar(px, 351, bw, 14, s.gpuLoadPct, GREEN)}
  ` : ''}

  ${s.gpuMemPct !== null ? `
  <text x="${px}" y="415" font-family="monospace" font-size="40" fill="#a060ff">VRAM</text>
  <text x="${W-px}" y="415" text-anchor="end" font-family="monospace" font-size="40" fill="${WHITE}">${Math.round(s.gpuMemPct)}%</text>
  ${bar(px, 423, bw, 14, s.gpuMemPct, '#a060ff')}
  ` : ''}

  ${s.gpuTemp !== null ? `
  <text x="${px}" y="475" font-family="monospace" font-size="30" fill="${DIM}">GPU temp</text>
  <text x="${W-px}" y="475" text-anchor="end" font-family="monospace" font-size="40" fill="${tcGpu}">${s.gpuTemp}°C</text>
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
