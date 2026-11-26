/* Native fragments own navigation; the controller renders the high-resolution
   multi-color ASCII starmap, animated phosphor FX layer, reticle overlays,
   inspector telemetry, focus restoration and scan controls. */
(() => {
  'use strict';

  const chart = document.querySelector('.star-chart');
  const chartScreen = document.querySelector('.chart-screen');
  const toggle = document.getElementById('sweep-toggle');
  const cmdToggle = document.getElementById('cmd-toggle');
  const audioToggle = document.getElementById('audio-toggle');
  const scanState = document.getElementById('scan-state');
  const cursorReadout = document.getElementById('cursor-readout');
  const inspTarget = document.getElementById('insp-target');
  const inspCoords = document.getElementById('insp-coords');
  const inspClass = document.getElementById('insp-class');
  const inspStatus = document.getElementById('insp-status');
  const inspectorPrompt = document.getElementById('inspector-prompt');
  const inspectorSummary = document.getElementById('inspector-summary');
  const telemetryLog = document.getElementById('telemetry-log');
  const contacts = [...document.querySelectorAll('[data-contact]')];
  const navLinks = [...document.querySelectorAll('[data-nav]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-width: 900px), (max-height: 599px)');
  const narrowMedia = matchMedia('(max-width: 700px)');
  const replay = document.querySelector('.replay');

  const CATALOG = [
    {
      id: 'projects', key: '1', code: 'HD-01', sector: 'SEC-A1', label: 'Projects',
      designation: 'HD-01 / PROJECTS', coords: 'RA 04h18m / DEC +31\u00b014\'',
      spectral: 'K2 III / 41.8 LY', labelSide: 'right',
      wide: { col: 21, row: 9 }, narrow: { col: 10, row: 5 },
    },
    {
      id: 'research', key: '2', code: 'HD-02', sector: 'SEC-C3', label: 'Research',
      designation: 'HD-02 / RESEARCH', coords: 'RA 07h25m / DEC -24\u00b042\'',
      spectral: 'B3 V / 118.4 LY', labelSide: 'right',
      wide: { col: 44, row: 26 }, narrow: { col: 20, row: 16 },
    },
    {
      id: 'about', key: '3', code: 'HD-03', sector: 'SEC-B2', label: 'About',
      designation: 'HD-03 / ABOUT', coords: 'RA 17h42m / DEC +19\u00b008\'',
      spectral: 'G8 IV / 63.2 LY', labelSide: 'left',
      wide: { col: 83, row: 15 }, narrow: { col: 40, row: 10 },
    },
    {
      id: 'contact', key: '4', code: 'HD-04', sector: 'SEC-D4', label: 'Contact',
      designation: 'HD-04 / CONTACT', coords: 'RA 19h08m / DEC -39\u00b015\'',
      spectral: 'F5 V / 87.6 LY', labelSide: 'left',
      wide: { col: 101, row: 33 }, narrow: { col: 47, row: 21 },
    },
  ];
  const catalogById = new Map(CATALOG.map(entry => [entry.id, entry]));
  const sections = new Set(CATALOG.map(entry => entry.id));
  // Keep existing #work bookmarks without redirecting or adding history entries.
  const routeId = () => location.hash === '#work' ? 'projects' : location.hash.slice(1);

  const WIDE_SPEC = { cols: 121, rows: 41, key: 'wide', suffix: '' };
  const NARROW_SPEC = { cols: 57, rows: 25, key: 'narrow', suffix: '-narrow' };

  // An open, asymmetric constellation spine following 01 -> 02 -> 03 -> 04 left to right.
  const ROUTES = [
    ['projects', 'research', false],
    ['research', 'about', false],
    ['about', 'contact', false],
  ];

  // Deep-space catalog landmarks with spectral tint & diffraction spikes.
  const WAYPOINTS_WIDE = [
    { col: 48, row: 6, glyph: '*', tag: 'CYG-X1', tone: 'cool', cross: true },
    { col: 15, row: 24, glyph: '*', tag: 'VELA-P', tone: 'cool', cross: true },
    { col: 66, row: 23, glyph: '*', tag: 'SGR-A*', tone: 'warm', cross: true, pulsar: true },
    { col: 103, row: 8, glyph: '+', tag: 'LYR-04', tone: 'cool', cross: false },
    { col: 64, row: 35, glyph: '*', tag: 'ORI-M42', tone: 'warm', cross: true },
    { col: 17, row: 34, glyph: '+', tag: 'CAR-09', tone: 'warm', cross: false },
  ];

  const WAYPOINTS_NARROW = [
    { col: 26, row: 4, glyph: '*', tag: 'CYG', tone: 'cool', cross: false },
    { col: 7, row: 14, glyph: '+', tag: 'VEL', tone: 'cool', cross: false },
    { col: 32, row: 14, glyph: '*', tag: 'SGR', tone: 'warm', cross: false, pulsar: true },
    { col: 48, row: 5, glyph: '+', tag: '', tone: 'cool', cross: false },
    { col: 30, row: 21, glyph: '+', tag: 'ORI', tone: 'warm', cross: false },
  ];

  const SCAN_PERIOD_MS = 18000;
  const FX_STEP_MS = 75; // ~13.3 Hz crisp character-cell terminal refresh cadence
  const JACK_STEP_MS = 40; // ~25 Hz smooth ASCII shuffle without 144 Hz redraw overhead
  const SHUFFLE_CYCLE_MS = 4800;

  let held = false;
  let departed = false;
  let returnTarget = null;
  let lastActivated = null;
  let pointerId = null;
  let keyboardId = null;
  let inputMode = 'keyboard';
  let currentRoute = '';
  let fxFrame = 0;
  let lastFrameNow = null;
  let lastPaintMs = -Infinity;
  let lastJackPaintMs = -Infinity;
  let animElapsedMs = 0;
  let shuffleElapsedMs = 0;
  let skyCursorText = null;
  let pendingJump = null;
  let lastReticleKey = null;
  let cachedChartRect = null;
  const fxLayerEls = {
    wide: document.getElementById('map-fx'),
    narrow: document.getElementById('map-fx-narrow'),
  };
  const reticleLayerEls = {
    wide: document.getElementById('map-reticle'),
    narrow: document.getElementById('map-reticle-narrow'),
  };
  const SONAR_DURATION_MS = 900;
  const sonarPings = [];

  // Optional pure Web Audio API TUI synthesizer (off by default, zero audio files).
  let audioEnabled = false;
  let audioCtx = null;

  function getAudioContext() {
    if (!audioEnabled) return null;
    if (audioCtx) {
      try {
        if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
          audioCtx.resume().catch?.(() => {});
        }
      } catch { /* ignore restricted audio contexts */ }
      return audioCtx;
    }
    try {
      const Ctx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
        || (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext));
      if (typeof Ctx !== 'function') return null;
      audioCtx = new Ctx();
      return audioCtx;
    } catch {
      return null;
    }
  }

  function scheduleTone(ctx, { type = 'sine', freq = 660, endFreq = null, delay = 0, duration = 0.022, peak = 0.022 }) {
    const start = (ctx.currentTime || 0) + Math.max(0, delay);
    const dur = Math.min(0.18, Math.max(0.01, duration));
    const gainPeak = Math.min(0.04, Math.max(0.001, peak));
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq && endFreq !== freq && typeof osc.frequency.exponentialRampToValueAtTime === 'function') {
      osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
    }
    gain.gain.setValueAtTime(0.0001, start);
    if (typeof gain.gain.linearRampToValueAtTime === 'function') {
      gain.gain.linearRampToValueAtTime(gainPeak, start + Math.min(0.005, dur * 0.25));
    } else {
      gain.gain.setValueAtTime(gainPeak, start);
    }
    if (typeof gain.gain.exponentialRampToValueAtTime === 'function') {
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    }
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.005);
  }

  let playTuiSound = (kind = 'click') => {
    if (!audioEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx || typeof ctx.createOscillator !== 'function' || typeof ctx.createGain !== 'function') return;
      if (kind === 'lock') {
        scheduleTone(ctx, { type: 'sine', freq: 523.25, delay: 0, duration: 0.048, peak: 0.024 });
        scheduleTone(ctx, { type: 'sine', freq: 783.99, delay: 0.045, duration: 0.050, peak: 0.022 });
      } else if (kind === 'ping') {
        scheduleTone(ctx, { type: 'sine', freq: 1046.5, endFreq: 784, delay: 0, duration: 0.180, peak: 0.028 });
        scheduleTone(ctx, { type: 'sine', freq: 2093, endFreq: 1568, delay: 0, duration: 0.120, peak: 0.010 });
      } else if (kind === 'cut') {
        scheduleTone(ctx, { type: 'triangle', freq: 420, endFreq: 210, delay: 0, duration: 0.018, peak: 0.024 });
        scheduleTone(ctx, { type: 'triangle', freq: 620, endFreq: 310, delay: 0.024, duration: 0.021, peak: 0.022 });
      } else {
        scheduleTone(ctx, { type: 'triangle', freq: 880, endFreq: 520, delay: 0, duration: 0.022, peak: 0.022 });
      }
    } catch { /* silent fallback in headless/restricted environments */ }
  };

  function reflectAudio() {
    if (!audioToggle) return;
    audioToggle.setAttribute('aria-pressed', String(audioEnabled));
    audioToggle.setAttribute('aria-label', audioEnabled ? 'Mute console audio' : 'Enable console audio');
    audioToggle.setAttribute('title', audioEnabled ? 'Mute console audio' : 'Enable console audio');
    const text = audioToggle.querySelector?.('.btn-label');
    if (text) text.replaceChildren(audioEnabled ? 'AUDIO: ON' : 'AUDIO: OFF');
  }

  function toggleAudio() {
    audioEnabled = !audioEnabled;
    reflectAudio();
    appendLog(audioEnabled ? 'AUDIO SYNTH -> ON' : 'AUDIO SYNTH -> OFF');
    if (audioEnabled) playTuiSound('click');
  }

  function isInside(node, root) {
    if (!node || !root) return false;
    if (node === root) return true;
    return typeof node.isDescendantOf === 'function'
      ? node.isDescendantOf(root)
      : typeof root.contains === 'function'
        ? root.contains(node)
        : false;
  }

  const animData = new Map();

  const logLines = [
    'RX handoff complete // console linked.',
    'High-res 121x41 astrometric grid online.',
    'Nav array standing by. Select [1-4].',
  ];

  function utcNow() {
    return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  }

  function stampSession() {
    const now = utcNow();
    for (const node of document.querySelectorAll('[data-session-utc]')) {
      node.textContent = now;
      node.setAttribute('datetime', now.replace(' ', 'T').replace(' UTC', 'Z'));
    }
    for (const node of document.querySelectorAll('[data-station-name]')) {
      node.textContent = 'SEL / SEOUL RX';
    }
  }

  function renderLog() {
    if (!telemetryLog) return;
    telemetryLog.replaceChildren();
    for (const line of logLines) {
      const item = document.createElement('li');
      item.textContent = line;
      telemetryLog.append(item);
    }
  }

  function appendLog(message) {
    const stamp = utcNow().slice(11, 19);
    const line = `${stamp}  ${message}`;
    logLines.push(line);
    while (logLines.length > 4) logLines.shift();
    if (!telemetryLog) return;
    const item = document.createElement('li');
    item.textContent = line;
    telemetryLog.append(item);
    while (telemetryLog.children.length > 4) {
      const oldest = telemetryLog.firstElementChild || telemetryLog.children[0];
      if (oldest?.remove) oldest.remove();
      else if (oldest && telemetryLog.removeChild) telemetryLog.removeChild(oldest);
      else break;
    }
  }

  /* Deterministic 32-bit coordinate hash + smooth 2D FBM for sculpted nebulae. */
  function hash2(col, row, seed = 17) {
    let h = Math.imul(col + 31, 374761393) ^ Math.imul(row + 19, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function valueNoise(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let fx = x - ix;
    let fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed);
    const b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed);
    const d = hash2(ix + 1, iy + 1, seed);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }

  function fbm(x, y, seed) {
    return (
      valueNoise(x, y, seed) * 0.56 +
      valueNoise(x * 2.12 + 7.3, y * 2.12 - 4.1, seed + 19) * 0.30 +
      valueNoise(x * 4.35 - 3.7, y * 4.35 + 11.2, seed + 47) * 0.14
    );
  }

  function makeGrid(cols, rows) {
    return Array.from({ length: rows }, () => Array(cols).fill(' '));
  }

  function clearGrid(grid) {
    for (let r = 0; r < grid.length; r++) grid[r].fill(' ');
  }

  function put(grid, col, row, ch) {
    if (row >= 0 && row < grid.length && col >= 0 && col < grid[0].length) {
      grid[row][col] = ch;
    }
  }

  function writeText(grid, col, row, text) {
    for (let i = 0; i < text.length; i++) put(grid, col + i, row, text[i]);
  }

  function toText(grid) {
    return grid.map(row => row.join('')).join('\n');
  }

  function labelClearRect(entry, spec, tight = false) {
    const pos = entry[spec.key];
    const span = spec.key === 'wide' ? 24 : 20;
    const padY = tight ? 0 : 1;
    if (entry.labelSide === 'right') {
      return { left: pos.col - 3, right: pos.col + span, top: pos.row - padY, bottom: pos.row + padY };
    }
    return { left: pos.col - span, right: pos.col + 3, top: pos.row - padY, bottom: pos.row + padY };
  }

  function insideBeaconClearance(col, row, spec, includeTag = true, tight = false) {
    for (const entry of CATALOG) {
      const pos = entry[spec.key];
      if (Math.abs(col - pos.col) <= 2 && Math.abs(row - pos.row) <= 1) return true;
      if (includeTag) {
        const rect = labelClearRect(entry, spec, tight);
        if (col >= rect.left && col <= rect.right && row >= rect.top && row <= rect.bottom) return true;
      }
    }
    return false;
  }

  function insideWaypointClearance(col, row, spec) {
    const list = spec.key === 'wide' ? WAYPOINTS_WIDE : WAYPOINTS_NARROW;
    for (const wp of list) {
      const tagLen = wp.tag ? wp.tag.length + (wp.cross ? 5 : 3) : 2;
      if (Math.abs(row - wp.row) <= (wp.cross ? 1 : 0) && col >= wp.col - (wp.cross ? 3 : 1) && col <= wp.col + tagLen) {
        return true;
      }
    }
    return false;
  }

  function insideFrameStamp(col, row, spec) {
    if (row === 1 || row === spec.rows - 2) {
      const pad = spec.key === 'wide' ? 18 : 6;
      if (col <= pad || col >= spec.cols - pad - 1) return true;
      const qx = [1, 2, 3].map(n => (n * (spec.cols - 1)) / 4);
      if (qx.some(q => Math.abs(col - q) <= (spec.key === 'wide' ? 7 : 3))) return true;
    }
    if (spec.key === 'wide') {
      const qy = [1, 2, 3].map(n => (n * (spec.rows - 1)) / 4);
      if (qy.includes(row) && (col <= 9 || col >= spec.cols - 10)) return true;
    }
    return false;
  }

  function traceLineCells(x0, y0, x1, y1) {
    const cells = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    while (true) {
      cells.push({ col: x, row: y });
      if (x === x1 && y === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return cells;
  }

  function drawLine(grid, x0, y0, x1, y1, spec, sparse, collector = null) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    const cells = traceLineCells(x0, y0, x1, y1);
    const steps = cells.length - 1;
    const slope = dx === 0 ? 99 : dy / dx;
    const dirChar = slope < 0.28 ? '\u2500' : slope > 2.2 ? '\u2502' : (sx * sy > 0 ? '\u2572' : '\u2571');

    for (let step = 0; step < cells.length; step++) {
      const { col: x, row: y } = cells[step];
      if (step >= 3 && step <= steps - 3 && !insideBeaconClearance(x, y, spec, true, true)) {
        if (collector) collector.push({ col: x, row: y, dir: dirChar });
        let ch = null;
        if (sparse) {
          if (step % 3 === 0) ch = '\u00b7';
        } else if (step % 2 === 0) {
          ch = dirChar;
        } else if (step % 4 === 1) {
          ch = '\u00b7';
        }
        if (ch && grid[y][x] === ' ') put(grid, x, y, ch);
      }
    }
  }

  function drawGraticule(spec) {
    const { cols, rows } = spec;
    const grid = makeGrid(cols, rows);
    const qx = [1, 2, 3].map(n => (n * (cols - 1)) / 4);
    const qy = [1, 2, 3].map(n => (n * (rows - 1)) / 4);
    const qxSet = new Set(qx);
    const qySet = new Set(qy);
    const minorX = spec.key === 'wide' ? new Set([15, 45, 75, 105]) : new Set();
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;

    // Outer box-drawing frame with major & minor RA / DEC graduations.
    for (let c = 0; c < cols; c++) {
      const topCh = c === 0 ? '\u250c' : c === cols - 1 ? '\u2510' : qxSet.has(c) ? '\u252c' : minorX.has(c) ? '\u2577' : '\u2500';
      const botCh = c === 0 ? '\u2514' : c === cols - 1 ? '\u2518' : qxSet.has(c) ? '\u2534' : minorX.has(c) ? '\u2575' : '\u2500';
      put(grid, c, 0, topCh);
      put(grid, c, rows - 1, botCh);
    }
    for (let r = 1; r < rows - 1; r++) {
      put(grid, 0, r, qySet.has(r) ? '\u251c' : '\u2502');
      put(grid, cols - 1, r, qySet.has(r) ? '\u2524' : '\u2502');
    }

    // Interior dotted meridians & declination parallels.
    for (const c of qx) {
      for (let r = 1; r < rows - 1; r++) {
        if (r % 2 === 0) put(grid, c, r, '\u2506');
      }
    }
    for (const r of qy) {
      for (let c = 1; c < cols - 1; c++) {
        if (c % 2 === 0) put(grid, c, r, '\u2504');
      }
    }
    for (const c of qx) {
      for (const r of qy) put(grid, c, r, '\u253c');
    }

    // Concentric aspect-corrected astrolabe range rings around sector center.
    const rings = spec.key === 'wide'
      ? [{ rx: 46, ry: 16.5, step: 144 }, { rx: 28, ry: 10.2, step: 96 }, { rx: 13, ry: 4.8, step: 52 }]
      : [{ rx: 22, ry: 9.2, step: 84 }, { rx: 12, ry: 5.0, step: 48 }];
    for (const ring of rings) {
      for (let i = 0; i < ring.step; i++) {
        const angle = (i / ring.step) * Math.PI * 2;
        const c = Math.round(cx + Math.cos(angle) * ring.rx);
        const r = Math.round(cy + Math.sin(angle) * ring.ry);
        if (c > 1 && c < cols - 2 && r > 1 && r < rows - 2 && grid[r][c] === ' ') {
          put(grid, c, r, '\u00b7');
        }
      }
    }

    // Subtle sinusoidal ecliptic plane curve sweeping across the sky.
    const eclipticStep = spec.key === 'wide' ? 3 : 2;
    for (let c = 2; c < cols - 2; c += eclipticStep) {
      const phase = (c / (cols - 1)) * Math.PI * 2 - 0.55;
      const r = Math.round(cy - Math.sin(phase) * (rows * 0.22));
      if (r > 2 && r < rows - 3 && grid[r][c] === ' ' && !insideBeaconClearance(c, r, spec, true)) {
        put(grid, c, r, '\u00b7');
      }
    }

    // Corner sector designators & graduated coordinate labels.
    if (spec.key === 'wide') {
      writeText(grid, 2, 1, 'SEC-A1 // N-GAL');
      writeText(grid, qx[0] - 1, 1, '06h');
      writeText(grid, qx[1] - 1, 1, '12h');
      writeText(grid, qx[2] - 1, 1, '18h');
      writeText(grid, cols - 15, 1, 'SEC-B2 // CYG');
      writeText(grid, 2, qy[0], '+30\u00b0');
      writeText(grid, cols - 6, qy[0], '+30\u00b0');
      writeText(grid, 2, cy, 'EQ 00\u00b0');
      writeText(grid, cols - 8, cy, 'EQ 00\u00b0');
      writeText(grid, 2, qy[2], '-30\u00b0');
      writeText(grid, cols - 6, qy[2], '-30\u00b0');
      writeText(grid, 2, rows - 2, 'SEC-C3 // VELA');
      writeText(grid, qx[1] - 6, rows - 2, 'EPOCH J2000.0');
      writeText(grid, cols - 15, rows - 2, 'SEC-D4 // CAR');
    } else {
      writeText(grid, 2, 1, 'A1');
      writeText(grid, cx - 1, 1, '12h');
      writeText(grid, cols - 4, 1, 'B2');
      writeText(grid, 2, cy, 'EQ0');
      writeText(grid, 2, rows - 2, 'C3');
      writeText(grid, cx - 2, rows - 2, 'J2000');
      writeText(grid, cols - 4, rows - 2, 'D4');
    }

    return grid;
  }

  /* Procedural two-tone galactic nebula & star-forming clouds:
     cool ionized teal-cyan outer arm + warm terracotta-copper H-II knots
     with a carved central dark dust rift. */
  function drawNebulae(spec, graticule) {
    const { cols, rows } = spec;
    const cool = makeGrid(cols, rows);
    const warm = makeGrid(cols, rows);
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const isWide = spec.key === 'wide';

    for (let r = 2; r < rows - 2; r++) {
      for (let c = 2; c < cols - 2; c++) {
        if (graticule[r][c] !== ' ') continue;
        if (insideBeaconClearance(c, r, spec, true) || insideWaypointClearance(c, r, spec) || insideFrameStamp(c, r, spec)) continue;

        const nx = c / (cols - 1);
        const ny = r / (rows - 1);
        // Normalized aspect-corrected coordinates centered on chart.
        const ax = (c - cx) / (cols * 0.42);
        const ay = (r - cy) / (rows * 0.42);

        // Diagonal galactic plane sweeping lower-left -> upper-right with gentle S-warp.
        const warp = (fbm(nx * 3.8 + 1.4, ny * 3.4 - 0.7, 73) - 0.5) * 0.28;
        const planeY = 0.84 - 0.68 * nx + warp;
        const planeDist = Math.abs(ny - planeY);

        // Dark central Great Rift dust lane carved through the Milky Way spine.
        const riftNoise = fbm(nx * 7.2 + 4.1, ny * 6.5 + 2.2, 131);
        const rift = Math.exp(-Math.pow((ny - planeY + (riftNoise - 0.5) * 0.05) / 0.036, 2)) * 0.72;

        const detail = fbm(nx * 9.5 + 3.2, ny * 8.2 - 1.9, 211);
        const arm = Math.exp(-Math.pow(planeDist / 0.175, 2)) * Math.max(0, 1 - rift);

        // Localized deep-space nebula complexes (Cygnus ionized cloud + Sagittarius core + Vela/Carina knots).
        const cygCloud = Math.exp(-(Math.pow((nx - 0.70) / 0.17, 2) + Math.pow((ny - 0.25) / 0.18, 2)));
        const sgrCore = Math.exp(-(Math.pow((nx - 0.54) / 0.14, 2) + Math.pow((ny - 0.56) / 0.17, 2)));
        const velaKnot = Math.exp(-(Math.pow((nx - 0.22) / 0.15, 2) + Math.pow((ny - 0.74) / 0.16, 2)));

        const coolField = (arm * 0.78 + cygCloud * 0.78 + velaKnot * 0.28) * (0.45 + 0.82 * detail) - 0.35;
        const warmField = (sgrCore * 1.05 + velaKnot * 0.68 + arm * 0.42 * Math.max(0, 1 - ax * ax * 0.45 - ay * ay * 0.45)) * (0.44 + 0.88 * riftNoise) - 0.34;

        // Keep nebulae lacy and breathable using subtle stipple modulation.
        const dither = hash2(c, r, 307);
        const sparsity = isWide ? 0.62 : 0.54;

        if (warmField > coolField && warmField > 0.06 && dither < sparsity) {
          let ch = '\u00b7';
          if (warmField > 0.44) ch = '\u2592';
          else if (warmField > 0.27) ch = '\u2591';
          else if (warmField > 0.14) ch = ':';
          put(warm, c, r, ch);
        } else if (coolField > 0.07 && dither < sparsity) {
          let ch = '\u00b7';
          if (coolField > 0.46) ch = '\u2592';
          else if (coolField > 0.28) ch = '\u2591';
          else if (coolField > 0.15) ch = ':';
          put(cool, c, r, ch);
        }
      }
    }
    return { cool, warm };
  }

  function drawStarfields(spec, graticule, nebulae) {
    const { cols, rows } = spec;
    const cool = makeGrid(cols, rows);
    const warm = makeGrid(cols, rows);
    const occupied = new Set();
    const twinklers = [];
    const scanSparkles = [];
    const isWide = spec.key === 'wide';

    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (graticule[r][c] !== ' ') continue;
        if (insideBeaconClearance(c, r, spec, true) || insideWaypointClearance(c, r, spec) || insideFrameStamp(c, r, spec)) continue;
        if (occupied.has(`${c - 1},${r}`) || occupied.has(`${c},${r - 1}`) || occupied.has(`${c - 1},${r - 1}`)) continue;

        const nx = c / (cols - 1);
        const ny = r / (rows - 1);
        const planeY = 0.84 - 0.68 * nx;
        const dist = Math.abs(ny - planeY);
        const inNebula = nebulae.cool[r][c] !== ' ' || nebulae.warm[r][c] !== ' ';

        const roll = hash2(c, r, spec.cols * 7 + 13);
        const mag = hash2(c, r, spec.rows * 11 + 91);
        const spectral = hash2(c, r, 419);

        const density = dist < 0.14 ? (isWide ? 0.15 : 0.13) : dist < 0.28 ? 0.095 : 0.058;
        if (roll < density * (inNebula ? 0.72 : 1)) {
          let ch = '.';
          if (mag < 0.42) ch = '\u00b7';
          else if (mag < 0.70) ch = '.';
          else if (mag < 0.84) ch = ',';
          else if (mag < 0.93) ch = '\u00b0';
          else if (mag < 0.98) ch = '+';
          else ch = '*';

          // Clear underlying nebula cell so the star pops crisply without glyph collision.
          if (nebulae.cool[r][c] !== ' ') nebulae.cool[r][c] = ' ';
          if (nebulae.warm[r][c] !== ' ') nebulae.warm[r][c] = ' ';

          const isWarm = spectral > (dist < 0.16 ? 0.54 : 0.46);
          put(isWarm ? warm : cool, c, r, ch);
          occupied.add(`${c},${r}`);

          if (mag > 0.78) {
            scanSparkles.push({ col: c, row: r, bright: mag > 0.93 });
          }
          if (mag > 0.905 && twinklers.length < (isWide ? 48 : 20)) {
            twinklers.push({
              col: c,
              row: r,
              phase: hash2(c, r, 733) * Math.PI * 2,
              speed: 1.0 + hash2(c, r, 881) * 1.9,
              bright: mag > 0.96,
            });
          }
        }
      }
    }

    // Iconic deep-space catalog landmarks with 3x3 ASCII diffraction crosses on wide chart.
    const waypoints = isWide ? WAYPOINTS_WIDE : WAYPOINTS_NARROW;
    for (const wp of waypoints) {
      if (insideBeaconClearance(wp.col, wp.row, spec, true)) continue;
      const target = wp.tone === 'warm' ? warm : cool;
      if (wp.cross) {
        for (const [dc, dr, glyph] of [
          [0, -1, '\u00b7'], [0, 1, '\u00b7'], [-1, 0, '\u2500'], [1, 0, '\u2500'],
        ]) {
          const nc = wp.col + dc;
          const nr = wp.row + dr;
          if (!insideBeaconClearance(nc, nr, spec, true)) {
            nebulae.cool[nr][nc] = ' ';
            nebulae.warm[nr][nc] = ' ';
            put(target, nc, nr, glyph);
          }
        }
      }
      nebulae.cool[wp.row][wp.col] = ' ';
      nebulae.warm[wp.row][wp.col] = ' ';
      put(target, wp.col, wp.row, wp.glyph);
      twinklers.push({
        col: wp.col,
        row: wp.row,
        phase: (wp.col * 0.37 + wp.row * 0.71) % (Math.PI * 2),
        speed: 1.45,
        bright: true,
        cross: wp.cross,
      });
    }

    return { cool, warm, twinklers, scanSparkles };
  }

  function drawVectors(spec) {
    const { cols, rows } = spec;
    const grid = makeGrid(cols, rows);
    const spinePath = [];

    for (const [fromId, toId, sparse] of ROUTES) {
      const a = catalogById.get(fromId)[spec.key];
      const b = catalogById.get(toId)[spec.key];
      drawLine(grid, a.col, a.row, b.col, b.row, spec, sparse, spinePath);
    }

    const waypoints = spec.key === 'wide' ? WAYPOINTS_WIDE : WAYPOINTS_NARROW;
    for (const [index, wp] of waypoints.entries()) {
      if (index < 3) {
        const root = catalogById.get(['projects', 'research', 'about'][index])[spec.key];
        drawLine(grid, root.col, root.row, wp.col, wp.row, spec, true);
      }
      if (!insideBeaconClearance(wp.col, wp.row, spec, true)) {
        const tagOffset = wp.cross ? 4 : 2;
        if (wp.tag && wp.col + tagOffset + wp.tag.length < cols - 1) {
          writeText(grid, wp.col + tagOffset, wp.row, wp.tag);
        }
      }
    }
    return { grid, spinePath };
  }

  function drawReticle(spec, targetId, locked) {
    const { cols, rows } = spec;
    const grid = makeGrid(cols, rows);
    if (!targetId) return grid; // No amber selection or reticle at rest.

    const entry = catalogById.get(targetId);
    if (!entry) return grid;
    const pos = entry[spec.key];
    const tagRect = labelClearRect(entry, spec);

    // Highlight directly connected constellation route edges in phosphor amber.
    for (const [fromId, toId] of ROUTES) {
      if (fromId !== targetId && toId !== targetId) continue;
      const a = catalogById.get(fromId)[spec.key];
      const b = catalogById.get(toId)[spec.key];
      drawLine(grid, a.col, a.row, b.col, b.row, spec, !locked);
    }

    // Border vernier coordinate pointers.
    put(grid, pos.col, 0, 'v');
    put(grid, pos.col, rows - 1, '^');
    put(grid, 0, pos.row, '>');
    put(grid, cols - 1, pos.row, '<');

    // Vertical & horizontal dashed phosphor-amber crosshair rails with range ticks.
    for (let r = 1; r < rows - 1; r++) {
      if (Math.abs(r - pos.row) < 2) continue;
      if (r % 2 === 1 && !insideBeaconClearance(pos.col, r, spec, true)) {
        put(grid, pos.col, r, (Math.abs(r - pos.row) % 6 === 0) ? '+' : '\u2506');
      }
    }
    for (let c = 1; c < cols - 1; c++) {
      if (Math.abs(c - pos.col) < 3) continue;
      if (c >= tagRect.left && c <= tagRect.right) continue;
      if (c % 2 === 0 && !insideBeaconClearance(c, pos.row, spec, true)) {
        put(grid, c, pos.row, (Math.abs(c - pos.col) % 10 === 0) ? '+' : '\u254c');
      }
    }

    // High-res target lock corner brackets framing the active star cell.
    put(grid, pos.col - 2, pos.row - 1, '\u250c');
    put(grid, pos.col + 2, pos.row - 1, '\u2510');
    put(grid, pos.col - 2, pos.row + 1, '\u2514');
    put(grid, pos.col + 2, pos.row + 1, '\u2518');
    if (locked) {
      put(grid, pos.col - 1, pos.row - 1, '\u2500');
      put(grid, pos.col + 1, pos.row - 1, '\u2500');
      put(grid, pos.col - 1, pos.row + 1, '\u2500');
      put(grid, pos.col + 1, pos.row + 1, '\u2500');
      put(grid, pos.col - 3, pos.row, '\u2500');
      put(grid, pos.col + 3, pos.row, '\u2500');
    }
    return grid;
  }

  function routeRowAt(col, spec) {
    const stops = ['projects', 'research', 'about', 'contact'].map(id => catalogById.get(id)[spec.key]);
    if (col <= stops[0].col) {
      const slope = (stops[1].row - stops[0].row) / Math.max(1, stops[1].col - stops[0].col);
      return Math.max(4, Math.min(spec.rows - 4, Math.round(stops[0].row + (col - stops[0].col) * slope * 0.35)));
    }
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (col <= b.col) {
        const t = (col - a.col) / Math.max(1, b.col - a.col);
        return Math.round(a.row + (b.row - a.row) * t);
      }
    }
    const prev = stops[stops.length - 2];
    const last = stops[stops.length - 1];
    const slope = (last.row - prev.row) / Math.max(1, last.col - prev.col);
    return Math.max(4, Math.min(spec.rows - 4, Math.round(last.row + (col - last.col) * slope * 0.35)));
  }

  function renderSonarPings(grid, spec, elapsedMs) {
    const { cols, rows } = spec;
    const isWide = spec.key === 'wide';
    const maxRx = isWide ? 11 : 7;
    const maxRy = isWide ? 4.5 : 3;

    for (let i = sonarPings.length - 1; i >= 0; i--) {
      const ping = sonarPings[i];
      const age = elapsedMs - ping.startedAtMs;
      if (age < 0 || age >= SONAR_DURATION_MS) {
        sonarPings.splice(i, 1);
        continue;
      }
      if (ping.specKey !== spec.key) continue;

      const progress = age / SONAR_DURATION_MS;
      const paintCell = (c, r, ch) => {
        if (c < 1 || c > cols - 2 || r < 1 || r > rows - 2) return;
        if (grid[r][c] !== ' ') return;
        if (insideBeaconClearance(c, r, spec, true, true)) return;
        grid[r][c] = ch;
      };

      if (progress < 0.14) {
        paintCell(ping.col, ping.row, '*');
        paintCell(ping.col - 1, ping.row, 'o');
        paintCell(ping.col + 1, ping.row, 'o');
        paintCell(ping.col, ping.row - 1, '\u00b7');
        paintCell(ping.col, ping.row + 1, '\u00b7');
        continue;
      }

      const glyph = progress < 0.30 ? '*' : progress < 0.56 ? 'o' : progress < 0.80 ? ':' : '\u00b7';
      const rx = 1.6 + progress * maxRx;
      const ry = 0.8 + progress * maxRy;
      const steps = Math.max(16, Math.round(rx * 6));
      for (let s = 0; s < steps; s++) {
        const angle = (s / steps) * Math.PI * 2;
        const c = Math.round(ping.col + Math.cos(angle) * rx);
        const r = Math.round(ping.row + Math.sin(angle) * ry);
        paintCell(c, r, glyph);
      }

      if (progress >= 0.26 && progress < 0.72) {
        const innerGlyph = progress < 0.48 ? ':' : '\u00b7';
        const irx = rx * 0.52;
        const iry = ry * 0.52;
        const innerSteps = Math.max(12, Math.round(irx * 5));
        for (let s = 0; s < innerSteps; s++) {
          const angle = (s / innerSteps) * Math.PI * 2;
          const c = Math.round(ping.col + Math.cos(angle) * irx);
          const r = Math.round(ping.row + Math.sin(angle) * iry);
          paintCell(c, r, innerGlyph);
        }
      }
    }
  }

  function renderFxFrame(spec, elapsedMs, staticSnapshot = false) {
    const state = animData.get(spec.key);
    if (!state) return;
    const { grid, twinklers, scanSparkles, spinePath, pulsar } = state;
    const { cols, rows } = spec;
    clearGrid(grid);

    const t = elapsedMs / 1000;

    // 1. Organic stellar scintillation & breathing diffraction crosses.
    for (const star of twinklers) {
      const wave = 0.5 + 0.5 * Math.sin(t * star.speed + star.phase);
      if (staticSnapshot) {
        if (star.bright) put(grid, star.col, star.row, '*');
        continue;
      }
      if (wave > 0.78) {
        put(grid, star.col, star.row, star.bright ? '*' : '+');
        if (star.cross && wave > 0.89) {
          put(grid, star.col - 2, star.row, '\u00b7');
          put(grid, star.col + 2, star.row, '\u00b7');
        }
      } else if (wave > 0.56 && star.bright) {
        put(grid, star.col, star.row, '+');
      }
    }

    if (!staticSnapshot) {
      // 2. Live telemetry signal packets gliding along the open constellation spine.
      if (spinePath.length > 6) {
        for (const offset of [0, 0.52]) {
          const head = Math.floor(((t * 0.14 + offset) % 1) * spinePath.length);
          const p0 = spinePath[head];
          if (p0) put(grid, p0.col, p0.row, '*');
          const p1 = spinePath[(head - 1 + spinePath.length) % spinePath.length];
          if (p1 && head >= 1) put(grid, p1.col, p1.row, '+');
          const p2 = spinePath[(head - 2 + spinePath.length) % spinePath.length];
          if (p2 && head >= 2) put(grid, p2.col, p2.row, '\u00b7');
        }
      }

      // 3. Synchronized terminal caliper vernier + compact floating ecliptic probe.
      // Top/bottom markers, short edge ticks, floating probe and beacon echoes all
      // read from this single scanCol so nothing can drift out of alignment.
      const scanPhase = (elapsedMs % SCAN_PERIOD_MS) / SCAN_PERIOD_MS;
      const span = cols - 2;
      const scanCol = 1 + Math.min(span - 1, Math.floor(scanPhase * span));
      const isWide = spec.key === 'wide';

      // Top & bottom border pointers + short 2-row terminal caliper ticks.
      put(grid, scanCol, 0, 'v');
      put(grid, scanCol, rows - 1, '^');
      if (!insideFrameStamp(scanCol, 1, spec) && !insideBeaconClearance(scanCol, 1, spec, true)) {
        put(grid, scanCol, 1, '\u2502');
      }
      if (!insideBeaconClearance(scanCol, 2, spec, true)) {
        put(grid, scanCol, 2, '\u2506');
      }
      if (!insideBeaconClearance(scanCol, rows - 3, spec, true)) {
        put(grid, scanCol, rows - 3, '\u2506');
      }
      if (!insideFrameStamp(scanCol, rows - 2, spec) && !insideBeaconClearance(scanCol, rows - 2, spec, true)) {
        put(grid, scanCol, rows - 2, '\u2502');
      }

      // Compact floating terminal read-head following the Projects -> About -> Research -> Contact route.
      const probeRow = routeRowAt(scanCol, spec);
      const armReach = isWide ? 3 : 2;
      for (let dr = -armReach; dr <= armReach; dr++) {
        const r = probeRow + dr;
        if (r <= 2 || r >= rows - 3) continue;
        if (insideBeaconClearance(scanCol, r, spec, true, true)) continue;
        const ch = dr === 0 ? '\u253c' : Math.abs(dr) === 1 ? '\u2502' : Math.abs(dr) === 2 ? '\u2506' : '\u00b7';
        put(grid, scanCol, r, ch);
      }
      if (!insideBeaconClearance(scanCol - 1, probeRow, spec, true, true) && scanCol - 1 > 1) {
        put(grid, scanCol - 1, probeRow, '\u2500');
      }
      if (!insideBeaconClearance(scanCol + 1, probeRow, spec, true, true) && scanCol + 1 < cols - 2) {
        put(grid, scanCol + 1, probeRow, '\u2500');
      }

      // Brief phosphor star echo 0..3 columns behind the synchronized sweep.
      for (const sp of scanSparkles) {
        const behind = scanCol - sp.col;
        if (behind >= 0 && behind <= 3) {
          put(grid, sp.col, sp.row, behind <= 1 ? (sp.bright ? '*' : '+') : '\u00b7');
        }
      }

      // Exact beacon echo when scanCol crosses each plotted portfolio star.
      const activeSpecKey = narrowMedia.matches ? 'narrow' : 'wide';
      if (spec.key === activeSpecKey) {
        const pingWindow = isWide ? 4 : 2;
        for (const link of contacts) {
          const entry = catalogById.get(link.dataset.contact);
          const pos = entry?.[spec.key];
          if (!pos) continue;
          const behind = (scanCol - pos.col + span) % span;
          const pinged = behind >= 0 && behind <= pingWindow;
          link.classList.toggle('is-pinged', pinged);
          if (pinged && behind <= 2) {
            put(grid, pos.col - 2, pos.row - 1, '\u250c');
            put(grid, pos.col + 2, pos.row - 1, '\u2510');
            put(grid, pos.col - 2, pos.row + 1, '\u2514');
            put(grid, pos.col + 2, pos.row + 1, '\u2518');
          }
        }
      }

      // 4. Breathing galactic core pulsar ripple (SGR-A*).
      if (pulsar) {
        const beat = (t * 0.34) % 1;
        if (beat < 0.24) {
          put(grid, pulsar.col, pulsar.row, '*');
        } else if (beat < 0.46) {
          put(grid, pulsar.col - 2, pulsar.row, '(');
          put(grid, pulsar.col + 2, pulsar.row, ')');
        } else if (beat < 0.62 && spec.key === 'wide') {
          put(grid, pulsar.col - 3, pulsar.row, '\u00b7');
          put(grid, pulsar.col + 3, pulsar.row, '\u00b7');
        }
      }

      // 5. Expanding empty-sky ASCII sonar pings (zero effect when idle).
      if (sonarPings.length > 0) {
        renderSonarPings(grid, spec, elapsedMs);
      }
    }

    const fxEl = fxLayerEls[spec.key] || document.getElementById(`map-fx${spec.suffix}`);
    if (fxEl) {
      const next = toText(grid);
      if (fxEl.textContent !== next) fxEl.textContent = next;
    }
  }

  function renderAllFx(elapsedMs, staticSnapshot = false) {
    renderFxFrame(WIDE_SPEC, elapsedMs, staticSnapshot);
    renderFxFrame(NARROW_SPEC, elapsedMs, staticSnapshot);
  }

  function renderStaticCharts() {
    for (const spec of [WIDE_SPEC, NARROW_SPEC]) {
      const graticule = drawGraticule(spec);
      const nebulae = drawNebulae(spec, graticule);
      const stars = drawStarfields(spec, graticule, nebulae);
      const vectors = drawVectors(spec);
      const waypoints = spec.key === 'wide' ? WAYPOINTS_WIDE : WAYPOINTS_NARROW;
      const pulsar = waypoints.find(wp => wp.pulsar) || null;

      animData.set(spec.key, {
        grid: makeGrid(spec.cols, spec.rows),
        twinklers: stars.twinklers,
        scanSparkles: stars.scanSparkles,
        spinePath: vectors.spinePath,
        pulsar,
      });

      const writeLayer = (id, buf) => {
        const el = document.getElementById(`${id}${spec.suffix}`);
        if (el) el.textContent = toText(buf);
      };
      writeLayer('map-grid', graticule);
      writeLayer('map-nebula-cool', nebulae.cool);
      writeLayer('map-nebula-warm', nebulae.warm);
      writeLayer('map-stars', stars.cool);
      writeLayer('map-stars-warm', stars.warm);
      writeLayer('map-vectors', vectors.grid);
    }
    renderAllFx(0, reduced.matches);
  }

  function renderReticles(targetId, locked) {
    const key = `${targetId || ''}:${locked ? 1 : 0}`;
    if (key === lastReticleKey) return;
    lastReticleKey = key;
    for (const spec of [WIDE_SPEC, NARROW_SPEC]) {
      const reticleEl = reticleLayerEls[spec.key] || document.getElementById(`map-reticle${spec.suffix}`);
      if (reticleEl) {
        const next = toText(drawReticle(spec, targetId, locked));
        if (reticleEl.textContent !== next) reticleEl.textContent = next;
      }
    }
  }

  /* High-resolution 96x44 multi-color ASCII playing-card riffle shuffle.
     Seven color-separated <pre> layers keep card borders strictly pure ASCII
     while shading each Jack's 13x11 suit emblem in console phosphor colors.
     An alternating right/left in-shuffle restores the hand after four cycles. */
  const JACK_ORDERS = [
    [0, 1, 2, 3], [2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2],
  ];
  const JACK_COLS = 96, JACK_ROWS = 44;
  const JACK_CARD_W = 31, JACK_CARD_H = 25;
  const JACK_LAYER_NAMES = ['back', 'mid', 'front', 'gold', 'cool', 'warm', 'mint'];
  const jackLayerEls = Object.fromEntries(
    JACK_LAYER_NAMES.map(name => [name, document.getElementById(`jack-${name}`)])
  );
  const hasJackLayers = Boolean(jackLayerEls.back && jackLayerEls.front);
  const JACK_SUITS = ['\u2663', '\u2666', '\u2665', '\u2660'];
  const JACK_SUIT_COLORS = [
    { outline: 'mint', shade: 'back', pip: 'mint' },   // 0: Clubs
    { outline: 'gold', shade: 'warm', pip: 'gold' },   // 1: Diamonds
    { outline: 'warm', shade: 'gold', pip: 'warm' },   // 2: Hearts
    { outline: 'cool', shade: 'mint', pip: 'cool' },   // 3: Spades
  ];
  // High-resolution 13x11 shaded emblems, each centered on column 6 with one matching pip.
  const JACK_EMBLEMS = [
    [
      '    .---.    ',
      '   / ::: \\   ',
      '  ( ::::: )  ',
      ' .--\\ : /--. ',
      '/ :: \':\' :: \\',
      '( ::::\u2663:::: )',
      ' \\__ ::: __/ ',
      '    \\ : /    ',
      '     | |     ',
      '    / : \\    ',
      '   /_____\\   ',
    ],
    [
      '      ^      ',
      '     / \\     ',
      '    / . \\    ',
      '   / / \\ \\   ',
      '  / / : \\ \\  ',
      ' < < :\u2666: > > ',
      '  \\ \\ : / /  ',
      '   \\ \\ / /   ',
      '    \\ \' /    ',
      '     \\ /     ',
      '      v      ',
    ],
    [
      ' .--.   .--. ',
      '/ :: \\_/ :: \\',
      '| ::::::::: |',
      '| ::::\u2665:::: |',
      '\\ ::::::::: /',
      ' \\ ::::::: / ',
      '  \\ ::::: /  ',
      '   \\ ::: /   ',
      '    \\ : /    ',
      '     \\ /     ',
      '      V      ',
    ],
    [
      '      ^      ',
      '     / \\     ',
      '    / . \\    ',
      '   / ::: \\   ',
      '  / ::::: \\  ',
      ' / :::\u2660::: \\ ',
      '( :::: :::: )',
      ' \\___   ___/ ',
      '     | |     ',
      '    / : \\    ',
      '   /_____\\   ',
    ],
  ];
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const mix = (a, b, t) => a + (b - a) * t;
  // Palm-pivoted fan (\ \ / /): top corners spread cleanly while bases converge.
  const fanPose = slot => ({
    x: [21, 28, 35, 42][slot],
    y: [11, 8, 8, 11][slot],
    lean: [8.5, 4.2, -4.2, -8.5][slot],
    flex: 0,
  });
  const squarePose = slot => ({
    x: 32,
    y: 12 - slot * 0.9,
    lean: 0,
    flex: 0,
  });
  const packetPose = slot => ({
    x: slot < 2 ? 5 + slot * 1.5 : 60 - (slot - 2) * 1.5,
    y: 13 - (slot % 2) * 2.2,
    lean: slot < 2 ? -4.5 : 4.5,
    flex: 0,
  });
  function blendJackPose(from, to, progress) {
    const t = clamp01(progress);
    const u = 0.25 * t + 0.75 * t * t * (3 - 2 * t);
    return Object.fromEntries(['x', 'y', 'lean', 'flex'].map(key => [key, mix(from[key], to[key], u)]));
  }

  function makeJackBufs() {
    return Object.fromEntries(
      JACK_LAYER_NAMES.map(name => [name, Array.from({ length: JACK_ROWS }, () => Array(JACK_COLS).fill(' '))])
    );
  }
  const jackBufPool = makeJackBufs();
  function clearJackBufs(bufs) {
    for (const name of JACK_LAYER_NAMES) {
      const grid = bufs[name];
      for (let r = 0; r < JACK_ROWS; r++) grid[r].fill(' ');
    }
  }

  function drawJackFace(bufs, id, pose, depth = 3, isFront = true) {
    const width = JACK_CARD_W, height = JACK_CARD_H;
    const suit = JACK_SUITS[id];
    const palette = JACK_SUIT_COLORS[id];
    const frameLayer = depth >= 3 ? 'front' : depth >= 2 ? 'mid' : 'back';
    const rankLayer = isFront ? 'gold' : depth >= 2 ? 'front' : 'mid';
    const railLayer = isFront ? 'mid' : 'back';
    const crownLayer = isFront ? 'gold' : 'back';
    const shift = row => Math.round(
      pose.lean * (row / (height - 1) - 0.5)
      + pose.flex * Math.sin(Math.PI * row / (height - 1))
    );
    const slope = row => pose.lean / (height - 1)
      + pose.flex * (Math.PI / (height - 1)) * Math.cos(Math.PI * row / (height - 1));
    const left = row => Math.round(pose.x) + shift(row);
    const top = Math.round(pose.y);
    const put = (layer, x, y, glyph) => {
      if (y >= 0 && y < JACK_ROWS && x >= 0 && x < JACK_COLS) bufs[layer][y][x] = glyph;
    };
    const write = (layer, x, y, text) => {
      for (let i = 0; i < text.length; i++) put(layer, x + i, y, text[i]);
    };

    for (let row = 0; row < height; row++) {
      const x = left(row), y = top + row;
      // Opaque clear across all seven color layers before painting this card.
      if (y >= 0 && y < JACK_ROWS) {
        for (let col = 0; col < width; col++) {
          const cx = x + col;
          if (cx >= 0 && cx < JACK_COLS) {
            for (const name of JACK_LAYER_NAMES) bufs[name][y][cx] = ' ';
          }
        }
      }
      if (row === 0 || row === height - 1) {
        const corner = row === 0 ? '.' : "'";
        for (let col = 1; col < width - 1; col++) put(frameLayer, x + col, y, '-');
        put(frameLayer, x, y, corner);
        put(frameLayer, x + width - 1, y, corner);
      } else {
        const s = slope(row);
        const edge = s > 0.14 ? '\\' : s < -0.14 ? '/' : '|';
        put(frameLayer, x, y, edge);
        put(frameLayer, x + width - 1, y, edge);
      }
      if (row === 1) {
        put(rankLayer, x + 2, y, 'J');
        put(palette.pip, x + 3, y, suit);
      }
      if (row === 3 || row === 21) {
        write(railLayer, x + 11, y, '\u00b7-------\u00b7');
      }
      if (row === 4) {
        write(crownLayer, x + 11, y, '/\\  ^  /\\');
      }
      if (row >= 7 && row <= 17) {
        const line = JACK_EMBLEMS[id][row - 7];
        [...line].forEach((glyph, col) => {
          if (glyph === ' ') return;
          const layer = glyph === suit
            ? palette.pip
            : (glyph === ':' || glyph === '.' || glyph === "'")
              ? palette.shade
              : palette.outline;
          put(layer, x + 9 + col, y, glyph);
        });
      }
      if (row === 20) {
        write(crownLayer, x + 11, y, '\\/  v  \\/');
      }
      if (row === 23) {
        put(palette.pip, x + 27, y, suit);
        put(rankLayer, x + 28, y, 'J');
      }
    }
  }

  function renderJackShuffle(elapsedMs, staticSnapshot = false) {
    if (!hasJackLayers) return;
    const t = staticSnapshot ? 0 : elapsedMs;
    const cycle = Math.floor(t / SHUFFLE_CYCLE_MS) % JACK_ORDERS.length;
    const p = (t % SHUFFLE_CYCLE_MS) / SHUFFLE_CYCLE_MS;
    const order = JACK_ORDERS[cycle];
    const nextSlots = [1, 3, 0, 2];
    const releases = [2, 0, 3, 1];
    const faces = order.map((id, slot) => {
      const next = nextSlots[slot];
      let pose, depth = 10 + slot;
      if (p < 0.15) {
        pose = blendJackPose(fanPose(slot), squarePose(slot), p / 0.15);
      } else if (p < 0.31) {
        pose = blendJackPose(squarePose(slot), packetPose(slot), (p - 0.15) / 0.16);
      } else if (p < 0.76) {
        const start = 0.31 + releases.indexOf(slot) * 0.075;
        const u = clamp01((p - start) / 0.22);
        pose = blendJackPose(packetPose(slot), squarePose(next), u);
        const lift = Math.sin(Math.PI * u);
        pose.y -= (6.2 + (slot >= 2 ? 0.8 : 0)) * lift;
        pose.flex += (slot < 2 ? 4.4 : -4.4) * lift;
        pose.lean += (slot < 2 ? 5.6 : -5.6) * lift;
        if (p >= start) depth = next;
      } else if (p < 0.83) {
        const u = clamp01((p - 0.76) / 0.07);
        pose = { ...squarePose(next), y: squarePose(next).y + Math.sin(Math.PI * u) * 1.2 };
        depth = next;
      } else {
        pose = blendJackPose(squarePose(next), fanPose(next), (p - 0.83) / 0.17);
        depth = next;
      }
      return { id, pose, depth };
    });

    clearJackBufs(jackBufPool);
    const bufs = jackBufPool;
    faces.sort((a, b) => a.depth - b.depth);
    faces.forEach((face, idx) => drawJackFace(bufs, face.id, face.pose, idx, idx === faces.length - 1));

    // Subtle open-air phosphor riffle sparks during the active bridge weave.
    if (!staticSnapshot && p >= 0.34 && p < 0.74) {
      const isEmpty = (c, r) => JACK_LAYER_NAMES.every(name => bufs[name][r]?.[c] === ' ');
      const step = Math.floor((p - 0.34) * 40);
      for (const [c, r, ch] of [
        [47 + (step % 3) - 1, 2 + (step % 4), step % 2 === 0 ? '\u00b7' : ':'],
        [48 - (step % 3), 39 + (step % 3), '\u00b7'],
      ]) {
        if (isEmpty(c, r)) bufs.gold[r][c] = ch;
      }
    }

    for (const name of JACK_LAYER_NAMES) {
      const el = jackLayerEls[name];
      if (!el) continue;
      const text = bufs[name].map(row => row.join('')).join('\n');
      if (el.textContent !== text) el.textContent = text;
    }
  }

  function shouldAnimateFx() {
    return chart.dataset.sweep === 'running' && !sections.has(routeId());
  }

  function shouldAnimateShuffle() {
    return hasJackLayers && routeId() === 'about' && !reduced.matches && !document.hidden && !departed;
  }

  function shouldRunLoop() {
    return shouldAnimateFx() || shouldAnimateShuffle();
  }

  const jackSuitReadout = document.getElementById('jack-suit-readout');
  const JACK_SUIT_META = [
    { glyph: '\u2663', name: 'CLUBS', tone: 'mint' },
    { glyph: '\u2666', name: 'DIAMONDS', tone: 'gold' },
    { glyph: '\u2665', name: 'HEARTS', tone: 'warm' },
    { glyph: '\u2660', name: 'SPADES', tone: 'cool' },
  ];

  function updateJackIndicator(elapsedMs = shuffleElapsedMs, staticSnapshot = false) {
    if (!jackSuitReadout) return;
    const t = staticSnapshot ? 0 : Math.max(0, elapsedMs);
    const cycle = Math.floor(t / SHUFFLE_CYCLE_MS) % JACK_ORDERS.length;
    const p = (t % SHUFFLE_CYCLE_MS) / SHUFFLE_CYCLE_MS;
    const advanced = p >= 0.76;
    const frontId = advanced ? JACK_ORDERS[cycle][1] : JACK_ORDERS[cycle][3];
    const handNum = ((cycle + (advanced ? 1 : 0)) % JACK_ORDERS.length) + 1;
    const meta = JACK_SUIT_META[frontId];
    if (!meta) return;
    const nextText = `TOP: J${meta.glyph} ${meta.name} // 0${handNum}/04`;
    if (jackSuitReadout.textContent !== nextText) jackSuitReadout.textContent = nextText;
    if (jackSuitReadout.dataset.suitTone !== meta.tone) {
      jackSuitReadout.dataset.suitTone = meta.tone;
      jackSuitReadout.setAttribute('data-suit-tone', meta.tone);
    }
  }

  function cutJackDeck() {
    if (!hasJackLayers) return;
    if (reduced.matches) {
      const nextCycle = (Math.floor(shuffleElapsedMs / SHUFFLE_CYCLE_MS) + 1) % JACK_ORDERS.length;
      shuffleElapsedMs = nextCycle * SHUFFLE_CYCLE_MS;
      renderJackShuffle(shuffleElapsedMs, false);
    } else {
      const cycle = Math.floor(shuffleElapsedMs / SHUFFLE_CYCLE_MS);
      const phase = (shuffleElapsedMs % SHUFFLE_CYCLE_MS) / SHUFFLE_CYCLE_MS;
      shuffleElapsedMs = phase < 0.14
        ? cycle * SHUFFLE_CYCLE_MS + SHUFFLE_CYCLE_MS * 0.16
        : (cycle + 1) * SHUFFLE_CYCLE_MS;
      renderJackShuffle(shuffleElapsedMs, false);
    }
    updateJackIndicator(shuffleElapsedMs, false);
    appendLog('DECK CUT -> NEXT JACK.');
    playTuiSound?.('cut');
  }

  function stopFxLoop() {
    if (fxFrame) {
      cancelAnimationFrame(fxFrame);
      fxFrame = 0;
    }
    lastFrameNow = null;
  }

  function tickFx(now) {
    fxFrame = 0;
    if (!shouldRunLoop()) {
      lastFrameNow = null;
      return;
    }
    const dt = lastFrameNow !== null ? Math.min(250, Math.max(0, now - lastFrameNow)) : 0;
    lastFrameNow = now;
    if (shouldAnimateFx()) {
      animElapsedMs += dt;
      if (now - lastPaintMs >= FX_STEP_MS) {
        lastPaintMs = now;
        const activeSpec = narrowMedia.matches ? NARROW_SPEC : WIDE_SPEC;
        renderFxFrame(activeSpec, animElapsedMs, false);
      }
    }
    if (shouldAnimateShuffle()) {
      shuffleElapsedMs += dt;
      if (lastJackPaintMs === -Infinity || (dt > 0 && now - lastJackPaintMs >= JACK_STEP_MS)) {
        lastJackPaintMs = now;
        renderJackShuffle(shuffleElapsedMs, false);
        updateJackIndicator(shuffleElapsedMs, false);
      }
    }
    fxFrame = requestAnimationFrame(tickFx);
  }

  function syncFxLoop() {
    if (reduced.matches) {
      stopFxLoop();
      sonarPings.length = 0;
      for (const link of contacts) link.classList.remove('is-pinged');
      renderAllFx(0, true);
      shuffleElapsedMs = 0;
      renderJackShuffle(0, true);
      updateJackIndicator(0, true);
      return;
    }
    if (shouldRunLoop()) {
      if (!fxFrame) {
        lastFrameNow = null;
        fxFrame = requestAnimationFrame(tickFx);
      }
    } else {
      stopFxLoop();
    }
  }

  function reflectInspector() {
    const activeRoute = sections.has(routeId()) ? routeId() : null;
    const previewId = inputMode === 'keyboard' ? keyboardId : pointerId;
    const focusId = previewId || activeRoute;
    const entry = focusId ? catalogById.get(focusId) : null;
    const locked = Boolean(activeRoute && (!previewId || previewId === activeRoute));

    chart.classList.toggle('has-lock', locked);
    chart.classList.toggle('has-tracking', Boolean(focusId && !locked));
    renderReticles(focusId, locked);

    for (const link of contacts) {
      link.classList.toggle('is-preview', Boolean(previewId && link.dataset.contact === previewId));
    }
    for (const link of navLinks) {
      link.classList.toggle('is-preview', Boolean(previewId && link.dataset.nav === previewId));
    }

    if (!entry) {
      if (inspectorPrompt) inspectorPrompt.textContent = '> SELECT BEACON OR INDEX [1-4]';
      if (inspectorSummary) inspectorSummary.textContent = 'Vectors calibrated. Pick a star on the chart or index to open a portfolio record.';
      if (cursorReadout) cursorReadout.textContent = skyCursorText || 'LOCK: STANDBY // 04 CONTACTS';
      if (inspTarget) inspTarget.textContent = 'SECTOR 04 / STANDBY';
      if (inspCoords) inspCoords.textContent = 'RA 12h00m / DEC +00\u00b000\'';
      if (inspClass) inspClass.textContent = 'ECLIPTIC SURVEY';
      if (inspStatus) {
        inspStatus.textContent = 'AWAITING LOCK';
        inspStatus.classList.add('quiet-state');
        inspStatus.classList.remove('signal-state');
      }
      return;
    }

    if (inspectorPrompt) inspectorPrompt.textContent = locked ? '> RECORD OPEN // ESC RETURNS TO CHART' : '> RECORD PREVIEW';
    if (inspectorSummary) {
      const summary = document.getElementById(entry.id)?.querySelector('.record-body');
      inspectorSummary.textContent = summary?.textContent.trim() || '';
    }
    if (cursorReadout) {
      cursorReadout.textContent = `${locked ? 'LOCKED' : 'TRACK'}: ${entry.code}/${entry.label.toUpperCase()} // ${entry.coords}`;
    }
    if (inspTarget) inspTarget.textContent = entry.designation;
    if (inspCoords) inspCoords.textContent = entry.coords;
    if (inspClass) inspClass.textContent = entry.spectral;
    if (inspStatus) {
      inspStatus.textContent = locked ? 'SIGNAL LOCKED' : 'TRACKING TARGET';
      inspStatus.classList.add('signal-state');
      inspStatus.classList.remove('quiet-state');
    }
  }

  function reflectSweep() {
    const state = reduced.matches ? 'reduced' : document.hidden || departed ? 'hidden' : held ? 'held' : 'running';
    chart.dataset.sweep = state;
    const label = reduced.matches ? 'Scan static: reduced motion' : held ? 'Resume scan' : 'Hold scan';
    if (scanState) {
      scanState.textContent = state === 'reduced' ? 'SCAN STATIC' : state === 'hidden' ? 'SCAN PAUSED' : state === 'held' ? 'SCAN HELD' : 'SCAN RUNNING';
    }
    toggle.disabled = reduced.matches;
    toggle.setAttribute('aria-pressed', String(held));
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label + ' (H)');
    const glyph = toggle.querySelector?.('.btn-glyph');
    const text = toggle.querySelector?.('.btn-label');
    if (glyph) glyph.replaceChildren(held ? '\u25b7' : '\u2161');
    if (text) text.replaceChildren(held ? 'RESUME SCAN' : 'HOLD SCAN');
    syncFxLoop();
  }

  function reflectRoute(focus = false) {
    const route = routeId();
    const selected = contacts.find(link => link.dataset.contact === route) || null;
    const selectedNav = navLinks.find(link => link.dataset.nav === route) || null;

    contacts.forEach(link => {
      if (link === selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    navLinks.forEach(link => {
      if (link === selectedNav) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    pointerId = null;
    keyboardId = null;
    skyCursorText = null;

    document.title = selected
      ? 'Yeon Jun Kim // ' + route[0].toUpperCase() + route.slice(1)
      : 'Yeon Jun Kim // Star Chart';

    if (selected) {
      sonarPings.length = 0;
      const matchedOrigin = lastActivated && (lastActivated.dataset.contact === route || lastActivated.dataset.nav === route)
        ? lastActivated
        : selected;
      returnTarget = matchedOrigin;
      lastActivated = null;
      if (currentRoute !== route) {
        const entry = catalogById.get(route);
        appendLog(`LOCK ACQUIRED -> ${entry.label.toUpperCase()} [${entry.code}]`);
        playTuiSound('lock');
      }
      currentRoute = route;
      if (focus) document.getElementById(route)?.focus({ preventScroll: !compact.matches });
    } else {
      if (currentRoute && sections.has(currentRoute)) {
        appendLog('LOCK RELEASED -> CHART STANDBY.');
      }
      currentRoute = '';
      if (focus && returnTarget) {
        returnTarget.focus({ preventScroll: !compact.matches });
      }
    }
    reflectInspector();
    syncFxLoop();
    if (focus && pendingJump) {
      const pending = pendingJump;
      pendingJump = null;
      if (pending.route === route) pending.fn();
    }
  }

  function toggleSweep() {
    if (!reduced.matches) {
      held = !held;
      reflectSweep();
      appendLog(held ? 'SCAN HOLD ENGAGED.' : 'SCAN SWEEP RESUMED.');
    }
  }

  // Pointer hover and keyboard focus own separate tracking channels. A mouse
  // click's retained focus cannot leave a phantom tracking box after it exits.
  document.addEventListener('pointerdown', () => {
    const changed = inputMode !== 'pointer' || keyboardId !== null;
    inputMode = 'pointer';
    keyboardId = null;
    if (changed) reflectInspector();
  });
  function bindTargetEvents(list, attr) {
    for (const link of list) {
      const id = link.dataset[attr];
      link.addEventListener('pointerenter', event => {
        if (event.pointerType === 'touch') return;
        inputMode = 'pointer';
        pointerId = id;
        skyCursorText = null;
        reflectInspector();
      });
      link.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch' || (inputMode === 'pointer' && pointerId === id)) return;
        inputMode = 'pointer';
        pointerId = id;
        skyCursorText = null;
        reflectInspector();
      });
      link.addEventListener('pointerleave', event => {
        if (event.pointerType === 'touch') return;
        if (pointerId === id) { pointerId = null; reflectInspector(); }
      });
      link.addEventListener('focus', () => {
        if (inputMode === 'keyboard') {
          keyboardId = id;
          skyCursorText = null;
          reflectInspector();
        }
      });
      link.addEventListener('blur', () => {
        if (keyboardId === id) { keyboardId = null; reflectInspector(); }
      });
      link.addEventListener('click', () => { lastActivated = link; });
    }
  }

  bindTargetEvents(contacts, 'contact');
  bindTargetEvents(navLinks, 'nav');

  // Star chart live sky cursor readout and empty-sky expanding ASCII sonar ping.
  function chartCoordsFromEvent(event, useCachedRect = false) {
    if (!chartScreen || typeof chartScreen.getBoundingClientRect !== 'function') return null;
    const rect = (useCachedRect && cachedChartRect) || chartScreen.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    if (useCachedRect) cachedChartRect = rect;
    if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return null;
    const relX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const relY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const totalMinutes = Math.min(23 * 60 + 59, Math.floor(relX * 24 * 60));
    const raH = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const raM = String(totalMinutes % 60).padStart(2, '0');
    const decNum = Math.round(60 - relY * 120);
    const decSign = decNum >= 0 ? '+' : '-';
    const decDeg = String(Math.abs(decNum)).padStart(2, '0');
    const spec = narrowMedia.matches ? NARROW_SPEC : WIDE_SPEC;
    const col = Math.max(1, Math.min(spec.cols - 2, Math.floor(relX * spec.cols)));
    const row = Math.max(1, Math.min(spec.rows - 2, Math.floor(relY * spec.rows)));
    return {
      relX, relY, col, row, specKey: spec.key,
      ra: `${raH}h${raM}m`,
      dec: `${decSign}${decDeg}\u00b0`,
      readout: `SKY CURSOR // RA ${raH}h${raM}m / DEC ${decSign}${decDeg}\u00b0`,
      shortLabel: `RA ${raH}h${raM}m DEC ${decSign}${decDeg}\u00b0`,
    };
  }

  function triggerSonarPing(coords, customLog = null) {
    if (!coords) return;
    playTuiSound('ping');
    appendLog(customLog || `PING // ${coords.shortLabel}`);
    if (!shouldAnimateFx()) return;
    sonarPings.push({
      col: coords.col,
      row: coords.row,
      specKey: coords.specKey,
      startedAtMs: animElapsedMs,
    });
    while (sonarPings.length > 4) sonarPings.shift();
    const activeSpec = narrowMedia.matches ? NARROW_SPEC : WIDE_SPEC;
    renderFxFrame(activeSpec, animElapsedMs, false);
  }

  chartScreen?.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    if (event.target?.closest?.('.star-link')) {
      if (skyCursorText !== null) {
        skyCursorText = null;
        reflectInspector();
      }
      return;
    }
    if (sections.has(routeId()) || pointerId || keyboardId) return;
    const coords = chartCoordsFromEvent(event, true);
    if (!coords) return;
    skyCursorText = coords.readout;
    if (cursorReadout && cursorReadout.textContent !== skyCursorText) cursorReadout.textContent = skyCursorText;
  });

  chartScreen?.addEventListener('pointerleave', event => {
    cachedChartRect = null;
    if (event.pointerType === 'touch') return;
    if (skyCursorText !== null) {
      skyCursorText = null;
      reflectInspector();
    }
  });

  window.addEventListener('resize', () => { cachedChartRect = null; }, { passive: true });
  window.addEventListener('scroll', () => { cachedChartRect = null; }, { passive: true });

  chartScreen?.addEventListener('click', event => {
    if (event.defaultPrevented || event.pointerType === 'touch') return;
    if (event.target?.closest?.('.star-link')) return;
    if (sections.has(routeId())) return;
    const coords = chartCoordsFromEvent(event);
    if (!coords) return;
    triggerSonarPing(coords);
  });

  toggle.hidden = false;
  toggle.addEventListener('click', toggleSweep);
  if (audioToggle) {
    audioToggle.hidden = false;
    reflectAudio();
    audioToggle.addEventListener('click', toggleAudio);
  }
  if (cmdToggle) {
    cmdToggle.hidden = false;
    cmdToggle.addEventListener('click', () => openPalette(cmdToggle));
  }
  window.addEventListener('hashchange', () => reflectRoute(true));
  document.addEventListener('visibilitychange', reflectSweep);
  window.addEventListener('pagehide', () => { departed = true; reflectSweep(); });
  window.addEventListener('pageshow', () => { departed = false; reflectSweep(); });
  reduced.addEventListener('change', reflectSweep);
  narrowMedia.addEventListener?.('change', () => {
    renderAllFx(animElapsedMs, reduced.matches);
  });

  function isEditableElement(el) {
    return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
  }

  document.addEventListener('keydown', event => {
    inputMode = 'keyboard';
    if (event.defaultPrevented) return;

    // Ctrl+K / Cmd+K toggles Command Palette from anywhere.
    if (!event.repeat && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key?.toLowerCase() === 'k') {
      if (cmdPalette) {
        event.preventDefault();
        togglePalette();
      }
      return;
    }

    // Command Palette takes highest priority while open (Escape closes it before lightbox/dossier).
    if (cmdPalette && !cmdPalette.hidden) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape' && !event.repeat && !event.shiftKey) {
        event.preventDefault();
        closePalette();
        return;
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.shiftKey) {
        event.preventDefault();
        stepPaletteSelection(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Enter' && !event.repeat && !event.shiftKey && document.activeElement !== cmdClose) {
        event.preventDefault();
        executeSelectedCommand();
        return;
      }
      return;
    }

    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const active = document.activeElement;
    if (isEditableElement(active)) return;
    const onChart = active === document.body || active === chart || active?.closest?.('.star-chart');

    if (event.key === '/' && cmdPalette && (!lightbox || lightbox.hidden) && (!active || onChart)) {
      event.preventDefault();
      openPalette();
      return;
    }

    if (!onChart) return;

    if (lightbox && !lightbox.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
        return;
      }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && lightboxGallery.length > 1) {
        event.preventDefault();
        stepLightbox(event.key === 'ArrowRight' ? 1 : -1);
        return;
      }
    }

    if (event.key === 'Escape' && sections.has(routeId())) {
      event.preventDefault();
      location.hash = 'map';
    } else if (event.key.toLowerCase() === 'h') {
      if (!reduced.matches) {
        event.preventDefault();
        toggleSweep();
      }
    } else if (/^[1-4]$/.test(event.key)) {
      const entry = CATALOG[Number(event.key) - 1];
      if (entry) {
        event.preventDefault();
        location.hash = entry.id;
      }
    } else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key) && active?.tagName !== 'BUTTON' && active !== replay && !active?.closest('.destination')) {
      const offset = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
      const inNav = navLinks.includes(active) || sections.has(routeId());
      const pool = inNav ? navLinks : contacts;
      const selected = pool.includes(active)
        ? active
        : pool.find(link => (inNav ? link.dataset.nav : link.dataset.contact) === routeId());
      const index = selected ? pool.indexOf(selected) + offset : offset > 0 ? 0 : pool.length - 1;
      pool[(index + pool.length) % pool.length].focus({ preventScroll: !compact.matches });
      event.preventDefault();
    }
  });

  // Contact owns the URLs so editing one HTML block also updates shortcuts.
  const operatorLinks = document.getElementById('operator-links');
  for (const channel of document.querySelectorAll('[data-contact-channel]')) {
    const href = channel.getAttribute('href');
    if (!href) continue;
    const shortcut = document.createElement('a');
    shortcut.setAttribute('class', 'op-link');
    shortcut.setAttribute('href', href);
    shortcut.textContent = channel.textContent;
    operatorLinks?.append(shortcut);
  }

  /* Fluid dossier interactivity: console lightbox gallery,
     waypoint navigation, clickable Jack deck + readout, About tag readouts,
     Seoul KST clock + phase, quick-mail bar, Copy email, and channel-guide highlighting. */
  const lightbox = document.getElementById('media-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const lightboxSource = document.getElementById('lightbox-source');
  const lightboxCounter = document.getElementById('lightbox-counter');
  const lightboxPrev = document.getElementById('lightbox-prev');
  const lightboxNext = document.getElementById('lightbox-next');
  const lightboxClose = document.getElementById('lightbox-close');
  let lightboxTrigger = null;
  let lightboxGallery = [];
  let lightboxIndex = 0;

  function extractMediaItem(trigger) {
    if (!trigger) return null;
    if (trigger.classList?.contains('media-zoom-btn')) {
      const figure = trigger.closest('.project-media');
      const img = figure?.querySelector('img');
      const link = figure?.querySelector('a');
      const src = img?.getAttribute('src');
      if (!src) return null;
      return {
        src,
        alt: img.getAttribute('alt') || '',
        caption: img.getAttribute('alt') || '',
        href: link?.getAttribute('href') || '',
        sourceLabel: link?.querySelector('.project-media-caption')?.textContent?.trim() || 'Open original',
        trigger,
      };
    }
    if (trigger.classList?.contains('paper-pipeline')) {
      const entry = trigger.closest('.paper-entry');
      const title = entry?.querySelector('cite')?.textContent?.trim();
      const link = entry?.querySelector('a');
      const src = trigger.getAttribute('src');
      if (!src) return null;
      const alt = trigger.getAttribute('alt') || '';
      return {
        src,
        alt,
        caption: title ? `${title} \u2014 ${alt}` : alt,
        href: link?.getAttribute('href') || '',
        sourceLabel: link?.textContent?.trim() || 'Open source',
        trigger,
      };
    }
    return null;
  }

  function collectDossierGallery(trigger) {
    const dossier = trigger?.closest?.('.destination');
    if (!dossier) return [];
    return [...document.querySelectorAll('.media-zoom-btn, .paper-pipeline')]
      .filter(node => isInside(node, dossier))
      .map(extractMediaItem)
      .filter(Boolean);
  }

  function renderLightboxItem() {
    const item = lightboxGallery[lightboxIndex];
    if (!item || !lightboxImg) return;
    lightboxImg.setAttribute('src', item.src);
    lightboxImg.setAttribute('alt', item.alt || '');
    if (lightboxCaption) lightboxCaption.textContent = item.caption || item.alt || '';
    if (lightboxSource) {
      if (item.href) {
        lightboxSource.setAttribute('href', item.href);
        lightboxSource.textContent = `${item.sourceLabel || 'Open original'} \u2192`;
        lightboxSource.hidden = false;
      } else {
        lightboxSource.hidden = true;
      }
    }
    const hasGallery = lightboxGallery.length > 1;
    if (lightboxCounter) {
      lightboxCounter.hidden = !hasGallery;
      if (hasGallery) {
        const current = String(lightboxIndex + 1).padStart(2, '0');
        const total = String(lightboxGallery.length).padStart(2, '0');
        lightboxCounter.textContent = `${current} / ${total}`;
      }
    }
    if (lightboxPrev) lightboxPrev.hidden = !hasGallery;
    if (lightboxNext) lightboxNext.hidden = !hasGallery;
  }

  function openLightbox({ src, alt, caption, href, sourceLabel, trigger }) {
    if (!lightbox || !lightboxImg || !src) return;
    lightboxTrigger = trigger || document.activeElement;
    const gallery = trigger ? collectDossierGallery(trigger) : [];
    const matchedIndex = gallery.findIndex(entry => entry.trigger === trigger);
    if (matchedIndex >= 0) {
      lightboxGallery = gallery;
      lightboxIndex = matchedIndex;
    } else {
      lightboxGallery = [{ src, alt, caption, href, sourceLabel, trigger }];
      lightboxIndex = 0;
    }
    renderLightboxItem();
    lightbox.hidden = false;
    lightboxClose?.focus?.();
  }

  function stepLightbox(delta) {
    if (!lightbox || lightbox.hidden || lightboxGallery.length <= 1) return;
    lightboxIndex = (lightboxIndex + delta + lightboxGallery.length) % lightboxGallery.length;
    renderLightboxItem();
    playTuiSound?.('click');
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lightboxTrigger?.focus?.();
    lightboxTrigger = null;
    lightboxGallery = [];
    lightboxIndex = 0;
  }

  lightboxPrev?.addEventListener('click', () => stepLightbox(-1));
  lightboxNext?.addEventListener('click', () => stepLightbox(1));
  lightboxClose?.addEventListener('click', closeLightbox);
  lightbox?.addEventListener('click', event => {
    if (event.target === lightbox) closeLightbox();
  });
  window.addEventListener('hashchange', closeLightbox);

  for (const btn of document.querySelectorAll('.media-zoom-btn')) {
    btn.addEventListener('click', () => {
      const item = extractMediaItem(btn);
      if (item) openLightbox(item);
    });
  }

  for (const diagram of document.querySelectorAll('.paper-pipeline')) {
    const inspectDiagram = () => {
      const item = extractMediaItem(diagram);
      if (item) openLightbox(item);
    };
    diagram.addEventListener('click', inspectDiagram);
    diagram.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        inspectDiagram();
      }
    });
  }

  // Smooth constellation waypoint roll-down navigation for Projects and Research.
  const dossierPanel = document.querySelector('.dossier-panel');
  let waypointScrollLockUntil = 0;

  function setActiveWaypoint(trackId, buttons, activeBtn) {
    const activeIndex = buttons.indexOf(activeBtn);
    for (const btn of buttons) {
      btn.setAttribute('aria-pressed', String(btn === activeBtn));
    }
    const track = document.getElementById(trackId);
    if (!track) return;
    const legs = [...document.querySelectorAll('.waypoint-leg')].filter(leg => leg.isDescendantOf ? leg.isDescendantOf(track) : track.contains?.(leg));
    legs.forEach((leg, index) => {
      leg.classList.toggle('is-passed', activeIndex > index);
    });
  }

  function isDossierScrollable() {
    if (!dossierPanel || typeof dossierPanel.scrollTo !== 'function') return false;
    if (typeof dossierPanel.scrollHeight !== 'number' || typeof dossierPanel.clientHeight !== 'number') return true;
    return dossierPanel.scrollHeight > dossierPanel.clientHeight + 2;
  }

  function rollToCategory(trackId, target, buttons, activeBtn, logLabel, silent = false) {
    setActiveWaypoint(trackId, buttons, activeBtn);
    if (!target) return;
    target.classList.remove('is-jump-target');
    const behavior = reduced.matches ? 'auto' : 'smooth';
    waypointScrollLockUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + (reduced.matches ? 0 : 700);
    if (
      isDossierScrollable()
      && typeof dossierPanel.getBoundingClientRect === 'function'
      && typeof target.getBoundingClientRect === 'function'
    ) {
      const panelRect = dossierPanel.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const stickyBar = target.closest('.destination')?.querySelector('.dossier-filters');
      const barHeight = stickyBar?.getBoundingClientRect ? Math.min(120, stickyBar.getBoundingClientRect().height) : 48;
      const top = Math.max(0, (dossierPanel.scrollTop || 0) + (targetRect.top - panelRect.top) - (barHeight + 16));
      dossierPanel.scrollTo({ top, behavior });
    } else if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior, block: 'start' });
    }
    target.classList.add('is-jump-target');
    if (!silent) {
      appendLog(`JUMP -> ${logLabel}`);
      playTuiSound('click');
    }
  }

  const projectJumpBtns = [...document.querySelectorAll('[data-project-jump]')];
  const projectGroups = [...document.querySelectorAll('[data-project-group]')];
  for (const btn of projectJumpBtns) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.projectJump;
      const target = projectGroups.find(group => group.dataset.projectGroup === key);
      rollToCategory('projects-filters', target, projectJumpBtns, btn, `PROJECTS:${key.toUpperCase()}`);
    });
  }

  const researchJumpBtns = [...document.querySelectorAll('[data-research-jump]')];
  const researchSections = [...document.querySelectorAll('[data-research-section]')];
  for (const btn of researchJumpBtns) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.researchJump;
      const target = researchSections.find(section => section.dataset.researchSection === key);
      rollToCategory('research-filters', target, researchJumpBtns, btn, `RESEARCH:${key.toUpperCase()}`);
    });
  }

  // Gently sync the active waypoint node as the user scrolls inside a dossier or mobile document flow.
  function syncActiveWaypoint() {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    if (nowMs < waypointScrollLockUntil) return;
    const route = routeId();
    const pairs = route === 'projects'
      ? { trackId: 'projects-filters', buttons: projectJumpBtns, targets: projectGroups, attr: 'projectGroup' }
      : route === 'research'
        ? { trackId: 'research-filters', buttons: researchJumpBtns, targets: researchSections, attr: 'researchSection' }
        : null;
    if (!pairs || !pairs.buttons.length) return;
    const refTop = isDossierScrollable() && typeof dossierPanel.getBoundingClientRect === 'function'
      ? dossierPanel.getBoundingClientRect().top + 96
      : 96;
    let currentIndex = 0;
    pairs.targets.forEach((section, idx) => {
      if (typeof section.getBoundingClientRect === 'function' && section.getBoundingClientRect().top <= refTop) {
        currentIndex = idx;
      }
    });
    const activeKey = pairs.targets[currentIndex]?.dataset?.[pairs.attr];
    const activeBtn = pairs.buttons.find(b => (b.dataset.projectJump || b.dataset.researchJump) === activeKey) || pairs.buttons[0];
    if (activeBtn && activeBtn.getAttribute('aria-pressed') !== 'true') {
      setActiveWaypoint(pairs.trackId, pairs.buttons, activeBtn);
    }
  }
  dossierPanel?.addEventListener('scroll', syncActiveWaypoint, { passive: true });
  window.addEventListener('scroll', syncActiveWaypoint, { passive: true });

  // About: click the shuffling Jack deck or [ CUT DECK ] button to deal/cut immediately to the next Jack.
  const jackArtEl = document.querySelector('.jack-art');
  const jackCutBtn = document.getElementById('jack-cut-btn');
  if (jackArtEl && hasJackLayers) {
    jackArtEl.classList.add('is-interactive');
    jackArtEl.setAttribute('title', 'Click to cut and deal the next Jack');
    jackArtEl.addEventListener('click', cutJackDeck);
  }
  if (jackCutBtn && hasJackLayers) {
    jackCutBtn.addEventListener('click', cutJackDeck);
  }

  // About: interactive interest & hobby chips revealing concise personal notes.
  const tagChips = [...document.querySelectorAll('.tag-chip')];
  const tagDefaults = new Map();
  for (const list of document.querySelectorAll('[data-tag-group]')) {
    const out = document.getElementById(list.dataset.tagGroup);
    if (out) tagDefaults.set(list.dataset.tagGroup, out.textContent);
  }
  for (const chip of tagChips) {
    chip.addEventListener('click', () => {
      const list = chip.closest('[data-tag-group]');
      const groupId = list?.dataset?.tagGroup;
      const out = groupId ? document.getElementById(groupId) : null;
      const wasPressed = chip.getAttribute('aria-pressed') === 'true';
      for (const peer of tagChips) {
        if (peer.closest('[data-tag-group]') === list) peer.setAttribute('aria-pressed', 'false');
      }
      if (wasPressed) {
        if (out) {
          out.textContent = tagDefaults.get(groupId) || '';
          out.classList.remove('has-note');
        }
        playTuiSound('click');
        return;
      }
      chip.setAttribute('aria-pressed', 'true');
      if (out) {
        out.textContent = `> [ ${chip.textContent.trim().toUpperCase()} ] ${chip.dataset.tagNote || ''}`;
        out.classList.add('has-note');
      }
      playTuiSound('click');
    });
  }

  // Contact: live Seoul KST clock + time-of-day badge, quick-mail bar, Copy email, and channel-guide hover.
  const seoulClockEl = document.getElementById('seoul-clock');
  const seoulPhaseEl = document.getElementById('seoul-phase');
  function getSeoulTimeInfo(date = new Date()) {
    let hhmm = '';
    try {
      if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
        hhmm = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Seoul',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          hourCycle: 'h23',
        }).format(date);
      }
    } catch { /* fall back to fixed UTC+9 offset below */ }
    if (!/^\d{2}:\d{2}$/.test(hhmm)) {
      const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
      hhmm = kst.toISOString().slice(11, 16);
    }
    let hour = Number(hhmm.slice(0, 2));
    if (hour === 24) {
      hour = 0;
      hhmm = `00${hhmm.slice(2)}`;
    }
    const phase = hour >= 6 && hour <= 17
      ? 'DAYTIME'
      : hour >= 18 && hour <= 22
        ? 'EVENING'
        : 'LATE NIGHT';
    return { clock: `${hhmm} KST`, hour, phase };
  }
  function formatSeoulTime(date = new Date()) {
    return getSeoulTimeInfo(date).clock;
  }
  function updateSeoulClock() {
    const info = getSeoulTimeInfo();
    if (seoulClockEl) {
      seoulClockEl.textContent = info.clock;
      seoulClockEl.setAttribute('datetime', info.clock);
    }
    if (seoulPhaseEl) {
      seoulPhaseEl.textContent = info.phase;
      const tone = info.phase === 'DAYTIME' ? 'day' : info.phase === 'EVENING' ? 'evening' : 'night';
      seoulPhaseEl.dataset.phase = tone;
      seoulPhaseEl.setAttribute('data-phase', tone);
    }
  }
  updateSeoulClock();
  window.addEventListener('hashchange', updateSeoulClock);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateSeoulClock(); });
  if (typeof setInterval === 'function') {
    setInterval(() => {
      if (!document.hidden && routeId() === 'contact') updateSeoulClock();
    }, 15000);
  }

  const quickMailBar = document.getElementById('quick-mail-bar');
  const quickMailBtns = [...document.querySelectorAll('.quick-mail-btn')];
  const emailChannelEl = document.querySelector('[data-contact-channel="email"]');
  const emailChannelHref = emailChannelEl?.getAttribute('href') || '';
  if (quickMailBar) {
    if (!emailChannelHref) {
      quickMailBar.hidden = true;
    } else {
      const baseMail = emailChannelHref.startsWith('mailto:') ? emailChannelHref.split('?')[0] : '';
      for (const btn of quickMailBtns) {
        const currentHref = btn.getAttribute('href') || '';
        const queryIdx = currentHref.indexOf('?');
        const query = queryIdx >= 0 ? currentHref.slice(queryIdx) : '';
        if (baseMail) btn.setAttribute('href', `${baseMail}${query}`);
        btn.addEventListener('click', () => {
          const topic = (btn.dataset.mailTopic || btn.textContent || 'EMAIL').trim().toUpperCase();
          appendLog(`MAIL DRAFT -> ${topic}`);
          playTuiSound?.('click');
        });
      }
    }
  }

  const copyEmailBtn = document.getElementById('copy-email-btn');
  let copyResetTimer = 0;
  copyEmailBtn?.addEventListener('click', () => {
    const emailHref = document.querySelector('[data-contact-channel="email"]')?.getAttribute('href') || '';
    const email = copyEmailBtn.dataset.copyEmail || emailHref.replace(/^mailto:/i, '');
    if (!email) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(email).catch?.(() => {});
      }
    } catch { /* ignore restricted clipboard contexts */ }
    copyEmailBtn.textContent = `Copied: ${email}`;
    copyEmailBtn.classList.add('is-copied');
    appendLog('EMAIL COPIED -> CLIPBOARD.');
    playTuiSound?.('click');
    if (typeof clearTimeout === 'function' && copyResetTimer) clearTimeout(copyResetTimer);
    if (typeof setTimeout === 'function') {
      copyResetTimer = setTimeout(() => {
        copyEmailBtn.textContent = 'Copy email';
        copyEmailBtn.classList.remove('is-copied');
      }, 2200);
    }
  });

  const contactChannelEls = [...document.querySelectorAll('[data-contact-channel]')];
  const guideChannelEls = [...document.querySelectorAll('[data-guide-channel]')];
  function highlightChannel(name) {
    for (const guide of guideChannelEls) {
      guide.classList.toggle('is-active', Boolean(name && guide.dataset.guideChannel === name));
    }
    for (const link of contactChannelEls) {
      link.classList.toggle('is-linked', Boolean(name && link.dataset.contactChannel === name));
    }
  }
  for (const link of contactChannelEls) {
    const name = link.dataset.contactChannel;
    link.addEventListener('pointerenter', () => highlightChannel(name));
    link.addEventListener('focus', () => highlightChannel(name));
    link.addEventListener('pointerleave', () => highlightChannel(null));
    link.addEventListener('blur', () => highlightChannel(null));
  }
  for (const guide of guideChannelEls) {
    const name = guide.dataset.guideChannel;
    guide.addEventListener('pointerenter', () => highlightChannel(name));
    guide.addEventListener('pointerleave', () => highlightChannel(null));
  }

  // Operator Command Palette: ranked fuzzy/prefix autocomplete + 23 power-user & fun commands.
  const cmdPalette = document.getElementById('cmd-palette');
  const cmdInput = document.getElementById('cmd-input');
  const cmdList = document.getElementById('cmd-list');
  const cmdOutput = document.getElementById('cmd-output');
  const cmdClose = document.getElementById('cmd-close');
  let paletteTrigger = null;
  let renderedItems = [];
  let selectedIndex = 0;
  let fortuneIndex = 0;

  const FORTUNES = [
    '"Explore. Dream. Discover." \u2014 H. Jackson Brown Jr. (SEL-RX transmission)',
    'Signal hides inside the noise until you pick the right filter. \u2014 DSP log',
    'Breadth connects the dots that specialization leaves in separate orbits. \u2014 Generalist note',
    'Every spectrum tells a story if you integrate long enough. \u2014 Astrometric survey',
    'Four suits, one hand: switch frames when the problem shifts. \u2014 Operator deck',
  ];

  function showPaletteOutput(text) {
    if (!cmdOutput) return;
    cmdOutput.textContent = text;
    cmdOutput.hidden = false;
  }

  function navigateToSection(id) {
    closeLightbox();
    if (id === 'map') {
      if (sections.has(routeId())) {
        location.hash = 'map';
        reflectRoute(false);
      } else {
        appendLog('CHART STANDBY ACTIVE.');
      }
      chart?.focus?.({ preventScroll: !compact.matches });
      return;
    }
    if (routeId() !== id) {
      location.hash = id;
      reflectRoute(false);
    }
    document.getElementById(id)?.focus?.({ preventScroll: !compact.matches });
  }

  function jumpToProjectGroup(key) {
    closePalette({ restoreFocus: false });
    const switched = routeId() !== 'projects';
    navigateToSection('projects');
    const btn = projectJumpBtns.find(node => node.dataset.projectJump === key);
    const target = projectGroups.find(node => node.dataset.projectGroup === key);
    if (btn && target) {
      rollToCategory('projects-filters', target, projectJumpBtns, btn, `PROJECTS:${key.toUpperCase()}`);
      if (switched) {
        pendingJump = {
          route: 'projects',
          fn: () => rollToCategory('projects-filters', target, projectJumpBtns, btn, `PROJECTS:${key.toUpperCase()}`, true),
        };
      }
    }
  }

  function jumpToResearchSection(key) {
    closePalette({ restoreFocus: false });
    const switched = routeId() !== 'research';
    navigateToSection('research');
    const btn = researchJumpBtns.find(node => node.dataset.researchJump === key);
    const target = researchSections.find(node => node.dataset.researchSection === key);
    if (btn && target) {
      rollToCategory('research-filters', target, researchJumpBtns, btn, `RESEARCH:${key.toUpperCase()}`);
      if (switched) {
        pendingJump = {
          route: 'research',
          fn: () => rollToCategory('research-filters', target, researchJumpBtns, btn, `RESEARCH:${key.toUpperCase()}`, true),
        };
      }
    }
  }

  function openContactChannel(channel, label) {
    const link = document.querySelector(`[data-contact-channel="${channel}"]`);
    const href = link?.getAttribute('href') || '';
    if (!href) {
      showPaletteOutput(`${label.toUpperCase()} // Channel is currently unconfigured.`);
      playTuiSound('click');
      return;
    }
    try {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(href, '_blank', 'noopener');
      }
    } catch { /* ignore blocked popups */ }
    appendLog(`OPEN CHANNEL -> ${label.toUpperCase()}`);
    playTuiSound('click');
    showPaletteOutput(`OPENED // ${label.toUpperCase()} -> ${href}`);
  }

  const COMMANDS = [
    {
      id: 'projects', aliases: ['work', '1'], category: 'NAV',
      desc: 'Open Projects dossier (05 builds: 02 hackathons, 03 personal)',
      run() { closePalette({ restoreFocus: false }); navigateToSection('projects'); },
    },
    {
      id: 'research', aliases: ['papers', '2'], category: 'NAV',
      desc: 'Open Research dossier (04 papers, 03 awards)',
      run() { closePalette({ restoreFocus: false }); navigateToSection('research'); },
    },
    {
      id: 'about', aliases: ['bio', '3'], category: 'NAV',
      desc: 'Open About dossier & ASCII Jack deck',
      run() { closePalette({ restoreFocus: false }); navigateToSection('about'); },
    },
    {
      id: 'contact', aliases: ['links', '4'], category: 'NAV',
      desc: 'Open Contact channels & Seoul KST clock',
      run() { closePalette({ restoreFocus: false }); navigateToSection('contact'); },
    },
    {
      id: 'chart', aliases: ['map', 'home'], category: 'NAV',
      desc: 'Return to Star Chart overview',
      run() { closePalette({ restoreFocus: false }); navigateToSection('map'); },
    },
    {
      id: 'hackathons', aliases: ['signaltrace', 'biotwin'], category: 'JUMP',
      desc: 'Jump to Projects -> Hackathon Participation',
      run() { jumpToProjectGroup('hackathons'); },
    },
    {
      id: 'personal', aliases: ['elsewhere', 'allowance'], category: 'JUMP',
      desc: 'Jump to Projects -> Personal projects',
      run() { jumpToProjectGroup('personal'); },
    },
    {
      id: 'ippg', aliases: ['ppg', 'bp'], category: 'JUMP',
      desc: 'Jump to Research -> iPPG Research & papers',
      run() { jumpToResearchSection('ippg'); },
    },
    {
      id: 'sleep', aliases: ['aauwss'], category: 'JUMP',
      desc: 'Jump to Research -> Sleep Research',
      run() { jumpToResearchSection('sleep'); },
    },
    {
      id: 'stress', aliases: ['emotion', 'bvp'], category: 'JUMP',
      desc: 'Jump to Research -> Stress/Emotion Research',
      run() { jumpToResearchSection('stress'); },
    },
    {
      id: 'awards', aliases: ['honors', 'prizes'], category: 'JUMP',
      desc: 'Jump to Research -> Awards (03 coauthored honors)',
      run() { jumpToResearchSection('awards'); },
    },
    {
      id: 'email', aliases: ['mail', 'copy-email'], category: 'COMMS',
      desc: 'Copy yeonjunkim70@gmail.com to clipboard',
      run() {
        const emailHref = document.querySelector('[data-contact-channel="email"]')?.getAttribute('href') || '';
        const email = emailHref ? emailHref.replace(/^mailto:/i, '').split('?')[0] : '';
        if (!email) {
          showPaletteOutput('EMAIL // Channel is currently unconfigured.');
          playTuiSound('click');
          return;
        }
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(email).catch?.(() => {});
          }
        } catch { /* ignore restricted clipboard contexts */ }
        appendLog('EMAIL COPIED -> CLIPBOARD.');
        playTuiSound('click');
        showPaletteOutput(`EMAIL COPIED // ${email}`);
      },
    },
    {
      id: 'github', aliases: ['gh', 'code', 'repos'], category: 'LINK',
      desc: 'Open GitHub profile (calavera16)',
      run() { openContactChannel('github', 'GitHub'); },
    },
    {
      id: 'youtube', aliases: ['yt', 'videos'], category: 'LINK',
      desc: 'Open YouTube channel (@calavera6712)',
      run() { openContactChannel('youtube', 'YouTube'); },
    },
    {
      id: 'instagram', aliases: ['ig', 'social'], category: 'LINK',
      desc: 'Open Instagram profile (@yj_07_25)',
      run() { openContactChannel('instagram', 'Instagram'); },
    },
    {
      id: 'help', aliases: ['?', 'commands', 'ls'], category: 'INFO',
      desc: 'List all available console commands',
      run() {
        playTuiSound('click');
        appendLog('CMD -> HELP INDEX');
        showPaletteOutput([
          'NAV   // projects · research · about · contact · chart (map/home)',
          'JUMP  // hackathons · personal · ippg · sleep · stress · awards',
          'COMMS // email · github · youtube · instagram · help',
          'FUN   // ping · cut · scan · seoul · whoami · sound (audio/mute) · fortune',
        ].join('\n'));
      },
    },
    {
      id: 'ping', aliases: ['sonar', 'radar'], category: 'FUN',
      desc: 'Emit an ASCII sonar ping across the star chart',
      run() {
        if (!sections.has(routeId())) {
          const spec = narrowMedia.matches ? NARROW_SPEC : WIDE_SPEC;
          const centerCoords = {
            col: Math.floor(spec.cols / 2),
            row: Math.floor(spec.rows / 2),
            specKey: spec.key,
            shortLabel: 'RA 12h00m DEC +00\u00b0',
          };
          triggerSonarPing(centerCoords, 'SONAR PING -> SEL-RX PONG');
          if (shouldAnimateFx()) {
            closePalette({ restoreFocus: false });
            chart?.focus?.({ preventScroll: !compact.matches });
          } else {
            showPaletteOutput('PONG // SEL-RX ONLINE (SCAN HELD/STATIC \u2014 RESUME SCAN FOR SONAR RING)');
          }
        } else {
          playTuiSound('ping');
          appendLog('SONAR PING -> SEL-RX PONG');
          showPaletteOutput('PONG // SEL-RX ONLINE \u00b7 RUN [chart] TO SEE EXPANDING SONAR RING');
        }
      },
    },
    {
      id: 'cut', aliases: ['deck', 'jack', 'shuffle'], category: 'FUN',
      desc: 'Cut the ASCII Jack deck in About to the next suit',
      run() {
        closePalette({ restoreFocus: false });
        const switched = routeId() !== 'about';
        if (switched) navigateToSection('about');
        else (jackCutBtn || document.getElementById('about'))?.focus?.({ preventScroll: !compact.matches });
        cutJackDeck();
        if (switched && reduced.matches) {
          const cutTargetMs = shuffleElapsedMs;
          pendingJump = {
            route: 'about',
            fn: () => {
              shuffleElapsedMs = cutTargetMs;
              renderJackShuffle(shuffleElapsedMs, false);
              updateJackIndicator(shuffleElapsedMs, false);
            },
          };
        }
      },
    },
    {
      id: 'scan', aliases: ['hold', 'sweep', 'resume'], category: 'FUN',
      desc: 'Hold or resume the star chart sweep scan',
      run() {
        playTuiSound('click');
        if (reduced.matches) {
          showPaletteOutput('SCAN STATIC // REDUCED MOTION PREFERENCE ACTIVE');
          return;
        }
        toggleSweep();
        showPaletteOutput(`SCAN STATUS // ${held ? 'HELD (PAUSED)' : 'RUNNING (LIVE SWEEP)'}`);
      },
    },
    {
      id: 'seoul', aliases: ['time', 'kst', 'clock'], category: 'FUN',
      desc: 'Check live Seoul local time & day phase (KST)',
      run() {
        updateSeoulClock();
        const info = getSeoulTimeInfo();
        playTuiSound('click');
        appendLog(`CMD -> SEOUL ${info.clock} (${info.phase})`);
        showPaletteOutput(`SEL // SEOUL \u00b7 ${info.clock} \u00b7 ${info.phase}`);
      },
    },
    {
      id: 'whoami', aliases: ['operator', 'id', 'calavera'], category: 'FUN',
      desc: 'Display verified operator dossier card',
      run() {
        playTuiSound('click');
        appendLog('CMD -> WHOAMI');
        showPaletteOutput('YEON JUN KIM (CALAVERA) // HALLYM UNIV. CS // INDEPENDENT UNDERGRADUATE RESEARCHER // AI, BIOMEDICAL SIGNALS, EMBEDDED, ASTRONOMY');
      },
    },
    {
      id: 'sound', aliases: ['audio', 'mute', 'synth', 'sfx'], category: 'FUN',
      desc: 'Toggle optional Web Audio TUI synthesizer',
      run() {
        toggleAudio();
        showPaletteOutput(`AUDIO SYNTH // ${audioEnabled ? 'ON (SUBTLE TUI TONES ACTIVE)' : 'OFF (SILENT MODE)'}`);
      },
    },
    {
      id: 'fortune', aliases: ['quote', 'signal', 'transmission'], category: 'FUN',
      desc: 'Decode a deep-space / generalist transmission quote',
      run() {
        const index = fortuneIndex;
        const text = FORTUNES[index];
        fortuneIndex = (fortuneIndex + 1) % FORTUNES.length;
        playTuiSound('click');
        appendLog(`CMD -> FORTUNE [0${index + 1}/0${FORTUNES.length}]`);
        showPaletteOutput(`RX FORTUNE [0${index + 1}/0${FORTUNES.length}] // ${text}`);
      },
    },
  ];

  function isSubsequence(needle, haystack) {
    let i = 0;
    for (let j = 0; j < haystack.length && i < needle.length; j++) {
      if (haystack[j] === needle[i]) i++;
    }
    return i === needle.length;
  }

  function scoreCommand(cmd, rawQuery) {
    const q = String(rawQuery || '').trim().toLowerCase().replace(/^\/+/, '');
    if (!q) return 1;
    const id = cmd.id.toLowerCase();
    const aliases = (cmd.aliases || []).map(a => a.toLowerCase());
    const desc = cmd.desc.toLowerCase();
    if (id === q || aliases.includes(q)) return 100;
    if (id.startsWith(q) || aliases.some(a => a.startsWith(q))) return 80;
    if (id.includes(q) || aliases.some(a => a.includes(q)) || desc.includes(q)) return 50;
    if (isSubsequence(q, id) || aliases.some(a => isSubsequence(q, a)) || isSubsequence(q, `${id} ${desc}`)) return 25;
    return 0;
  }

  function syncPaletteSelection() {
    for (let i = 0; i < renderedItems.length; i++) {
      const { el } = renderedItems[i];
      const active = i === selectedIndex;
      el.classList.toggle('is-selected', active);
      el.setAttribute('aria-selected', String(active));
    }
    if (cmdInput) {
      const current = renderedItems[selectedIndex];
      if (current) cmdInput.setAttribute('aria-activedescendant', current.el.id);
      else cmdInput.removeAttribute('aria-activedescendant');
    }
  }

  function renderPaletteList(query = '') {
    if (!cmdList) return;
    const ranked = COMMANDS
      .map((cmd, order) => ({ cmd, order, score: scoreCommand(cmd, query) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.order - b.order));

    renderedItems = [];
    cmdList.replaceChildren();

    if (ranked.length === 0) {
      selectedIndex = 0;
      const empty = document.createElement('li');
      empty.setAttribute('class', 'cmd-empty');
      empty.classList.add('cmd-empty');
      empty.setAttribute('role', 'presentation');
      empty.textContent = 'No matching commands. Type "help" for full index.';
      cmdList.append(empty);
      syncPaletteSelection();
      return;
    }

    if (selectedIndex >= ranked.length) selectedIndex = 0;

    ranked.forEach(({ cmd }, idx) => {
      const item = document.createElement('li');
      item.id = `cmd-opt-${cmd.id}`;
      item.setAttribute('id', item.id);
      item.setAttribute('class', 'cmd-item');
      item.classList.add('cmd-item');
      item.setAttribute('role', 'option');
      item.setAttribute('data-cmd-id', cmd.id);
      item.dataset.cmdId = cmd.id;

      const cursor = document.createElement('span');
      cursor.setAttribute('class', 'cmd-item-cursor');
      cursor.classList.add('cmd-item-cursor');
      cursor.setAttribute('aria-hidden', 'true');
      cursor.textContent = '>';

      const cat = document.createElement('span');
      cat.setAttribute('class', 'cmd-cat');
      cat.classList.add('cmd-cat');
      cat.textContent = `[${cmd.category}]`;

      const name = document.createElement('span');
      name.setAttribute('class', 'cmd-name');
      name.classList.add('cmd-name');
      name.textContent = cmd.id;

      const desc = document.createElement('span');
      desc.setAttribute('class', 'cmd-desc');
      desc.classList.add('cmd-desc');
      desc.textContent = cmd.desc;

      item.append(cursor, cat, name, desc);
      item.addEventListener('pointerenter', () => {
        selectedIndex = idx;
        syncPaletteSelection();
      });
      item.addEventListener('click', () => {
        selectedIndex = idx;
        syncPaletteSelection();
        cmd.run();
        if (cmdPalette && !cmdPalette.hidden) cmdInput?.focus?.();
      });

      cmdList.append(item);
      renderedItems.push({ cmd, el: item });
    });

    syncPaletteSelection();
  }

  function stepPaletteSelection(delta) {
    if (!renderedItems.length) return;
    selectedIndex = (selectedIndex + delta + renderedItems.length) % renderedItems.length;
    syncPaletteSelection();
    renderedItems[selectedIndex]?.el?.scrollIntoView?.({ block: 'nearest' });
  }

  function executeSelectedCommand() {
    const entry = renderedItems[selectedIndex];
    if (!entry) {
      showPaletteOutput('UNKNOWN COMMAND // Type "help" to list all console commands.');
      playTuiSound('click');
      return;
    }
    entry.cmd.run();
  }

  function openPalette(trigger = null) {
    if (!cmdPalette) return;
    paletteTrigger = trigger || document.activeElement;
    if (cmdInput) cmdInput.value = '';
    if (cmdOutput) {
      cmdOutput.hidden = true;
      cmdOutput.textContent = '';
    }
    selectedIndex = 0;
    renderPaletteList('');
    cmdPalette.hidden = false;
    cmdInput?.focus?.();
    playTuiSound('click');
  }

  function closePalette({ restoreFocus = true } = {}) {
    if (!cmdPalette || cmdPalette.hidden) return;
    cmdPalette.hidden = true;
    const target = paletteTrigger;
    paletteTrigger = null;
    if (restoreFocus && target && typeof target.focus === 'function') {
      target.focus();
    }
  }

  function togglePalette() {
    if (!cmdPalette) return;
    if (cmdPalette.hidden) openPalette();
    else closePalette();
  }

  cmdInput?.addEventListener('input', () => {
    selectedIndex = 0;
    renderPaletteList(cmdInput.value || '');
  });
  cmdInput?.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && !event.repeat && !event.shiftKey) {
      event.preventDefault();
      closePalette();
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.shiftKey) {
      event.preventDefault();
      stepPaletteSelection(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && !event.repeat && !event.shiftKey) {
      event.preventDefault();
      executeSelectedCommand();
    }
  });
  cmdClose?.addEventListener('click', () => closePalette());
  cmdPalette?.addEventListener('click', event => {
    if (event.target === cmdPalette) closePalette();
  });
  window.addEventListener('hashchange', () => closePalette({ restoreFocus: false }));

  // Live GoatCounter site visit counter (https://calavera16.goatcounter.com/counter/TOTAL.json).
  // Fails silently offline or under adblockers so the top band stays spotless.
  const VISIT_COUNTER_URL = 'https://calavera16.goatcounter.com/counter/TOTAL.json';
  function loadVisitCounter() {
    const wrap = document.getElementById('visit-counter');
    const out = document.getElementById('visit-count');
    if (!wrap || !out || typeof fetch !== 'function') return;
    if (!/^https?:\/\//i.test(String(location?.href || ''))) return;
    try {
      Promise.resolve(fetch(VISIT_COUNTER_URL))
        .then(res => (res && res.ok ? res.json() : null))
        .then(data => {
          const raw = String(data?.count ?? '').trim();
          if (!/^\d[\d,\s]*$/.test(raw)) return;
          out.textContent = raw;
          wrap.hidden = false;
          appendLog(`RX COUNTER // ${raw} VISITS LOGGED.`);
        })
        .catch(() => {});
    } catch { /* ignore restricted fetch contexts */ }
  }

  stampSession();
  renderLog();
  renderStaticCharts();
  renderJackShuffle(0, reduced.matches);
  updateJackIndicator(0, reduced.matches);
  reflectRoute();
  reflectSweep();
  loadVisitCounter();
})();
