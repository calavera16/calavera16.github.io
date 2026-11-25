/* Hand-crafted high-resolution multi-color character-cell opening cinema for SEL / SEOUL RX.
   Renders 3 choreographed scenes directly into 6 color-separated <pre> layers
   at 245x83 (wide) and 79x53 (portrait narrow) CRT resolution:
     Act 0A (0.00-2.10s): Deep-space Milky Way, beacon lock, ignition & departure
     Act 0B (2.10-4.25s): Rotating 3D ASCII Earth, East Asia lights & Seoul lock
     Act 0C (4.25-6.40s): Seoul rooftop parabolic radio dish & phosphor capture
   Zero external dependencies, instant load, reduced-motion & visibility safe. */
(function () {
  "use strict";

  const WIDE = { cols: 245, rows: 83, wide: true, suffix: "" };
  const NARROW = { cols: 79, rows: 53, wide: false, suffix: "-narrow" };
  const LAYERS = ["grid", "cool", "warm", "struct", "signal", "fx"];
  const DURATION = 6.4;
  const STEP_MS = 50; // 20 Hz crisp CRT terminal cadence
  const CHAR_ASPECT = 1.90;

  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => {
    const x = clamp(t);
    return x * x * (3 - 2 * x);
  };

  function hash2(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function makeBuffers(cols, rows) {
    const out = {};
    for (const name of LAYERS) {
      out[name] = Array.from({ length: rows }, () => Array(cols).fill(" "));
    }
    return out;
  }

  function clearBuffers(bufs, cols, rows) {
    for (const name of LAYERS) {
      const grid = bufs[name];
      for (let r = 0; r < rows; r++) grid[r].fill(" ");
    }
  }

  function put(buf, cols, rows, c, r, ch) {
    const ci = Math.round(c);
    const ri = Math.round(r);
    if (ci < 1 || ci >= cols - 1 || ri < 1 || ri >= rows - 1) return;
    buf[ri][ci] = ch;
  }

  function putRaw(buf, cols, rows, c, r, ch) {
    const ci = Math.round(c);
    const ri = Math.round(r);
    if (ci < 0 || ci >= cols || ri < 0 || ri >= rows) return;
    buf[ri][ci] = ch;
  }

  function writeText(buf, cols, rows, c, r, text) {
    const ri = Math.round(r);
    if (ri < 0 || ri >= rows) return;
    const start = Math.round(c);
    for (let i = 0; i < text.length; i++) {
      const ci = start + i;
      if (ci >= 1 && ci < cols - 1) buf[ri][ci] = text[i];
    }
  }

  function writeTextCleared(bufs, layer, cols, rows, c, r, text) {
    const ri = Math.round(r);
    if (ri < 1 || ri >= rows - 1) return;
    const start = Math.round(c);
    for (let i = 0; i < text.length; i++) {
      const ci = start + i;
      if (ci < 1 || ci >= cols - 1) continue;
      for (const name of LAYERS) {
        if (name !== "grid") bufs[name][ri][ci] = " ";
      }
      bufs[layer][ri][ci] = text[i];
    }
  }

  function drawFrame(bufs, spec, camTag) {
    const { cols, rows, wide } = spec;
    const g = bufs.grid;
    putRaw(g, cols, rows, 0, 0, "\u250c");
    putRaw(g, cols, rows, cols - 1, 0, "\u2510");
    putRaw(g, cols, rows, 0, rows - 1, "\u2514");
    putRaw(g, cols, rows, cols - 1, rows - 1, "\u2518");
    const stepX = wide ? 31 : 22;
    for (let c = 1; c < cols - 1; c++) {
      const tick = c % stepX === 0;
      g[0][c] = tick ? "\u252c" : "\u2500";
      g[rows - 1][c] = tick ? "\u2534" : "\u2500";
    }
    const stepY = wide ? 14 : 10;
    for (let r = 1; r < rows - 1; r++) {
      const tick = r % stepY === 0;
      g[r][0] = tick ? "\u251c" : "\u2502";
      g[r][cols - 1] = tick ? "\u2524" : "\u2502";
    }
    if (camTag) {
      const label = ` ${camTag} `;
      for (let i = 0; i < label.length && 2 + i < cols - 2; i++) {
        g[0][2 + i] = label[i];
      }
    }
  }

  function lineChar(dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy) * CHAR_ASPECT;
    if (ax > ay * 2.1) return "\u2500";
    if (ay > ax * 2.1) return "\u2502";
    return dx * dy > 0 ? "\\" : "/";
  }

  function drawLine(buf, cols, rows, x0, y0, x1, y1, chOrNull, stride = 1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy) * 1.5)));
    const glyph = chOrNull || lineChar(dx, dy);
    for (let i = 0; i <= steps; i += stride) {
      const u = i / steps;
      put(buf, cols, rows, x0 + dx * u, y0 + dy * u, glyph);
    }
  }

  // Precomputed deterministic star catalogues scaled to high-res grids.
  function makeStars(cols, rows) {
    const count = Math.round(cols * rows * 0.016);
    const stars = [];
    for (let i = 0; i < count; i++) {
      const x = 2 + hash2(i * 1.7 + 3.1, 11.4) * (cols - 4);
      const y = 2 + hash2(i * 2.3 + 7.9, 29.2) * (rows - 4);
      const mag = hash2(i * 4.1, 53.7);
      const warm = hash2(i * 5.9, 89.3) > 0.62;
      const phase = hash2(i * 3.3, 17.8) * Math.PI * 2;
      const speed = 1.6 + hash2(i * 6.7, 41.1) * 3.2;
      const glyph = mag > 0.91 ? "*" : mag > 0.74 ? "+" : mag > 0.36 ? "\u00b7" : ".";
      stars.push({ x, y, mag, warm, phase, speed, glyph });
    }
    return stars;
  }

  const STAR_CACHE = new Map();
  function getStars(cols, rows) {
    const key = `${cols}x${rows}`;
    if (!STAR_CACHE.has(key)) STAR_CACHE.set(key, makeStars(cols, rows));
    return STAR_CACHE.get(key);
  }

  // Spatial noise is interpolated before sampling: finer cells reveal structure
  // inside the dust lanes rather than adding per-frame character flicker.
  function fieldNoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const sx = smooth(x - ix), sy = smooth(y - iy);
    return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), sx),
      lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), sx), sy);
  }

  const NEBULA_CACHE = new Map();
  function getNebula(spec) {
    const { cols, rows } = spec;
    const key = `${cols}x${rows}`;
    if (NEBULA_CACHE.has(key)) return NEBULA_CACHE.get(key);
    const density = new Float32Array(cols * rows);
    const warm = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * 175 / cols, y = r * 59 / rows;
        const wave = Math.sin(x * 0.055) * 4.0 + Math.cos(y * 0.14) * 1.65;
        const offset = (y - 30.68) + (x - 87.5) * 0.1955 + wave;
        const dist = Math.abs(offset) / 12.685;
        const cloud = fieldNoise(x * 0.12, y * 0.17);
        const filament = fieldNoise(x * 0.48 + 19, y * 0.58 + 7);
        const lane = Math.abs(offset + Math.sin(x * 0.095) * 2.3 - 1.3);
        const rift = lane < 1.1 + cloud * 1.1 ? 0.24 : 1;
        const i = r * cols + c;
        density[i] = Math.exp(-dist * dist * 1.48) *
          (0.34 + cloud * 0.47 + filament * 0.19) * rift;
        warm[i] = cloud > 0.62 && filament > 0.53 && dist < 0.72 ? 1 : 0;
      }
    }
    const nebula = { density, warm };
    NEBULA_CACHE.set(key, nebula);
    return nebula;
  }

  // Offline 0.5-degree land silhouette from the bundled NASA Earth atlas.
  // Box-filter RGB samples classify land where B <= 1.03G and B <= 1.14R.
  // Each north-to-south row alternates water/land run lengths in base 36;
  // decode once to cumulative cell edges. No image load, fetch or canvas readback.
  // This is a cinematic coast mask; sub-cell coastal inlets are approximate.
  const LAND_ROWS = `k0
k0
k0
k0
k0
k0
k0
k0
k0
k0
k0
k0
k0
7w.a.3.1.bq
5o.j.1l.s.bg
5h.10.13.s.8.1.bf
52.18.f.9.1.1.2.1.4.6.6.n.4.8.bi
51.6.2.d.2.m.c.22.7.d.as
4s.4.d.3.2.1.9.i.9.28.3.c.65.6.4n
4q.b.g.l.8.2m.6a.3.4r
4o.i.1.q.h.2j.1z.2.7.b.3u.a.4g
4v.e.2.j.k.2i.1r.8.1.6.48.9.4h
49.5.g.a.2.o.b.2p.1u.g.4i.7.47
4e.3.4.4.j.j.8.2u.22.7.4.2.8s
3q.5.t.1.g.2.3.e.g.2s.1x.8.6.4.8p
3i.2.1l.h.p.2m.1x.5.4q.6.45
3b.4.1.2.15.6.9.l.k.2n.23.1.2r.4.1t.c.42
39.4.8.3.9.2.9.2.3.1.2.4.b.4.18.4.2.2.7.27.1.1.4q.6.1q.t.1e.2.2a
3j.9.6.7.8.8.5.1.5.5.1q.25.4g.8.1l.16.1c.e.1.1.1x
3k.3.2.1.2.c.b.6.3.4.4.o.18.22.4d.6.1l.1d.1b.g.2.9.1f.2.6
3p.5.u.1.a.e.1.5.1b.22.49.6.1h.1f.1h.4.f.7.1.2.1j
34.7.3l.1z.49.5.1i.1d.4.2.20.7.1j
34.f.y.4.5.8.1z.1q.1.6.47.6.1k.1h.1.2.k.4.u.8.1z
33.h.2.1.g.3.9.5.5.8.5.5.4.7.2.6.18.1p.4e.4.r.3.9.2.7.26.8.d.m.9.1x
33.c.1.8.1.3.4.1.3.5.6.1.3.7.3.4.8.6.2.a.1f.1o.2.3.47.5.s.5.6.1.1.4.6.2r.k.g.1.1.1f.1.9
31.b.3.k.2.5.9.8.3.2.8.7.2.9.3.1.1.6.15.1o.4c.5.r.8.4.9.6.2n.j.o.1b.2.8
34.7.4.l.1.5.b.5.4.2.8.8.2.k.13.3.2.1o.45.8.q.8.2.g.2.1.1.2l.5.3.2.z.1j
0.4.31.1.c.p.h.6.9.6.1.r.14.1g.2.4.48.5.o.u.1.2k.5.18.1.9.15.1
18.c.1x.6.3.i.f.7.8.11.13.1e.4.4.2l.1.5.1.1k.1.k.3k.2.1p.10
10.1.1.r.13.1.u.l.c.8.c.9.1.4.2.i.u.1.5.1b.1.1.2s.d.22.5a.10
y.16.j.b.4.1.f.t.9.1.4.6.j.1.b.i.r.3.4.1i.2d.3.2.i.22.5e.8.2.3.c.7
x.1e.3.q.1.7.d.d.3.7.7.5.4.7.b.6.d.f.y.1f.2e.w.u.3.l.9.6.5l.5.g.2
0.2.q.2u.3.6.p.4.5.6.1.4.5.8.e.c.z.1c.2c.3.1.14.x.c.2.d.4.66
0.4.o.2u.d.2.1.5.c.3.6.b.6.6.d.2.4.c.s.16.1.1.2n.18.b.4.9.77
0.8.n.2r.9.1.5.a.7.2.1.3.1.e.5.8.a.4.5.f.n.15.2p.1e.7.3.7.7a
0.a.n.33.1.14.2.a.i.h.l.14.2o.1h.6.2.6.7c
0.a.2.5.j.29.3.23.j.4.1.i.g.12.2o.12.3.e.7.7j
0.1.1.h.9.4.5.27.5.1.2.1r.4.1.k.6.1.6.3.7.i.10.12.1.1m.15.8.4.5.7o
0.1.2.g.6.2i.6.1o.2.3.q.d.5.3.l.s.v.4.2.c.1i.k.5.j.c.7r
8.8.b.2f.3.2.1.1q.1.3.2.3.f.1.3.g.6.1.n.o.10.g.1g.j.8.i.b.7s
b.4.c.9.2.43.3.6.a.n.t.n.10.h.1f.j.7.l.4.2.4.7q.2
12.41.4.6.1.2.i.g.s.k.12.c.1h.l.6.n.5.7t.3
12.3x.9.4.5.2.h.7.1.7.q.l.15.5.1k.k.6.8n.3
k.1.9.44.b.1.r.6.4.3.s.j.2s.k.8.8p.2
t.43.h.2.q.4.z.g.2q.m.7.8s.1
s.42.q.1.3.4.4.1.d.1.y.e.2p.n.8.7v.3.m.9
s.41.v.b.1b.d.2n.o.9.7j.7.4.3.j.d
s.40.x.c.1a.b.2o.o.9.i.2.6y.7.3.5.h.f
t.y.5.2v.x.g.1c.6.2o.o.9.j.3.6u.g.g.h
q.2.2.p.2.6.8.2r.z.f.1e.3.2q.q.8.5.9.3.1.6u.f.7.2.1.6.1.j
z.i.4.3.l.2h.z.g.9.2.3w.p.l.6p.1.8.f.4.x
10.g.v.2f.y.h.8.4.3v.8.2.e.c.6l.j.3.e.5.y
15.b.x.4.1.29.w.k.5.6.3t.7.5.b.d.6k.10.6.z
19.6.14.2b.v.k.1.9.37.3.k.3.7.a.g.6g.11.6.10
19.4.4.2.x.2.1.1.1.2a.v.u.35.3.w.9.g.6f.z.a.z
18.3.4.3.z.1.4.29.w.u.34.7.n.2.4.8.a.3.3.6d.10.b.z
16.3.1c.2h.p.u.33.7.m.4.5.7.9.6i.10.e.y
14.3.1g.2h.n.u.34.5.n.4.5.3.d.6h.11.e.y
10.3.1j.1.2.2i.j.w.35.5.l.3.4.1.1.2.e.6f.12.d.10
z.1.1m.1.3.2k.f.z.32.7.k.2.1.1.2.1.i.4w.1.1h.13.c.11
2r.2o.7.15.2s.5.5.4.k.3.k.4y.1.1g.14.d.10
2r.2o.7.16.2r.5.6.5.j.3.4.2.6.5.1.4y.2.1i.13.8.14
2m.2.4.2o.6.12.2.4.2m.7.7.6.g.c.1.57.1.1m.2.3.w.8.14
2n.1.6.2m.6.1a.2l.7.5.7.b.5o.2.1t.2.2.q.7.15
2u.2o.5.19.2l.6.5.b.8.5n.1.1z.r.4.17
2w.2m.5.19.2k.6.6.b.6.7p.r.4.17
2x.2m.2.1a.2l.3.9.a.6.5m.2.1y.2.2.r.3.18
2x.3u.4.1.2x.9.4.7n.4.2.q.1.1a
2z.3q.5.1.2w.3.1.1.8.7p.3.3.21
2x.4.1.39.i.2.38.52.1.2n.3.3.21
2z.3.2.35.k.3.35.7s.4.3.20
31.2.3.31.l.8.2x.1.2.7t.3.2.22
33.2.2.2z.4.5.c.9.2x.7v.4.2.22
37.1v.6.x.2.5.1.1.d.a.2q.80.29
33.1x.8.w.1.7.e.1.2.2.1.4.2u.7w.6.1.23
34.1u.4.2.6.14.m.2.2u.7t.7.2.22
34.21.3.16.3i.1u.1.9.5.o.3.4t.7.1.23
34.3b.7.1.3a.1s.4.5.6.m.8.16.1.3j.2c
34.23.3.2.2.13.4.1.3c.s.1.x.7.3.6.k.a.15.1.3j.2d
34.22.4.3.6.s.4.6.3d.q.3.w.8.3.5.k.8.4r.2e
34.22.2.5.4.s.4.4.3h.q.6.s.9.2.7.i.8.4q.c.1.23
34.21.2.7.3.p.6.3.3j.j.2.6.5.r.l.g.7.4q.d.3.21
34.21.2.8.1.6.5.c.9.1.3k.i.6.5.6.p.n.f.7.4p.c.7.1y
34.20.3.8.1.n.3g.c.1.a.5.2.8.6.7.m.p.e.8.4m.e.7.1y
33.22.2.v.3g.o.g.6.8.j.s.c.a.4d.j.6.21
34.21.2.9.4.i.3h.n.c.1.4.6.9.h.s.d.9.1d.1.2y.2r
34.2a.4.k.3h.m.d.1.6.7.7.h.a.4.e.d.8.1.2.48.2s
34.2t.3m.k.p.5.6.i.6.b.9.f.b.46.2t
34.2t.3m.i.g.2.a.6.4.9.4.2.5.14.7.49.l.3.25
34.2s.3m.i.h.2.b.3.3.1.2.6.8.1a.7.3r.2.e.n.3.25
35.2q.3n.i.h.2.d.1.7.6.6.1b.8.3o.4.3.3.6.p.4.24
35.2q.3m.i.i.2.d.2.7.5.8.18.9.3n.5.1.7.4.p.3.25
35.2p.3n.j.w.1.9.4.8.18.a.3l.d.6.o.3.25
36.2l.1.1.3p.h.18.5.6.18.a.3m.c.7.m.3.26
37.2k.3r.g.r.5.d.3.8.18.a.3n.2.1.a.6.k.4.26
37.2k.3r.f.u.3.d.3.9.19.8.3t.8.5.j.5.26
38.2k.3v.5.e.4.2.a.10.3.2.6.1.1.1.u.5.2l.1.16.a.6.g.6.27
38.2k.3w.1.c.k.12.1.5.2.5.4p.c.6.e.8.27
39.2j.3w.1.a.n.1e.4o.d.6.d.9.27
3a.2h.3x.2.3.1.3.p.r.2.f.2.4.4n.e.5.7.d.2a
3b.2f.3x.z.17.2.5.4n.d.3.9.5.1.3.2.1.2c
3d.2b.3z.x.1f.4s.k.1.7.2.2f
3g.26.40.z.1e.4s.i.1.4.3.2.1.2g
3h.24.3y.14.1b.4t.h.3.2.1.2m
3i.22.3y.1a.e.3.p.4t.i.2.2p
3i.20.3z.1d.a.7.n.4u.h.2.2p
3j.1z.3z.1e.9.a.j.4v.h.2.2p
3j.3.3.1s.3z.1g.8.f.5.4.4.4w.38
3k.2.4.1r.40.1j.4.5o.38
3k.3.4.1a.8.8.40.7b.38
3l.2.4.11.2.7.c.4.3z.39.4.3z.38
3m.3.2.z.o.4.3y.2d.1.u.5.3z.38
3n.2.3.w.r.3.3w.2g.1.u.5.3x.39
3o.2.3.t.t.4.3u.2h.1.u.5.3x.39
3n.4.4.q.u.4.3r.2l.4.r.6.3u.3a
3n.4.4.q.u.4.3q.2m.4.s.7.3r.3b
3q.2.5.o.v.4.3p.2n.4.s.8.4.2.3i.3c
3r.2.4.o.v.4.3n.2p.5.r.e.3h.3d
3s.1.5.o.v.2.3o.2q.5.q.2.1.9.1.3.3f.3d
3s.2.5.m.x.1.3n.2r.5.r.1.1.8.2.9.3.8.2x.3e
3s.2.6.l.4l.2s.5.s.6.4.l.2v.5.2.38
3u.1.6.j.4l.2u.5.r.5.6.l.2t.5.3.38
3v.2.6.h.4k.2v.6.13.k.2r.6.2.39
3w.1.6.h.4k.2v.6.15.j.2o.7.3.39
44.g.t.1.2.4.3j.2x.6.15.j.2j.c.1.3a
45.f.r.2.4.7.3f.2y.5.15.j.2h.3p
45.g.10.4.3d.30.4.15.k.17.2.14.3s
46.f.h.4.h.4.3b.30.4.14.m.y.a.v.5.1.3v
46.g.d.7.j.4.3a.2z.5.12.p.w.b.t.6.1.3v
45.h.d.6.l.5.38.2z.6.10.t.s.d.r.43
1c.2.2s.h.c.6.t.1.2.1.31.2z.7.y.u.q.g.p.7.3.3u
1c.2.2t.g.c.6.u.5.2z.30.7.x.u.p.h.o.7.3.3v
49.f.a.7.u.8.2x.2z.8.u.x.n.j.n.7.2.3w
4a.h.2.b.k.2.6.1.2.3.8.2.2s.31.6.u.x.m.l.n.t.3.38
4d.r.40.31.7.r.z.l.m.o.s.3.38
4f.o.41.32.7.p.11.i.o.p.r.4.37
4h.m.40.33.7.m.14.h.p.q.q.4.37
4k.6.1.c.40.33.8.j.16.g.q.4.2.l.p.3.38
4t.a.1.1.2.4.3s.34.6.j.17.e.y.m.n.3.39
4u.j.3p.36.6.g.1a.c.10.m.m.3.39
4v.i.3p.38.4.d.1d.c.10.m.n.2.39
4x.g.3p.39.3.c.1f.b.10.m.o.1.39
50.d.3q.39.3.8.1i.b.11.l.o.1.3.1.35
55.8.3q.3a.2.4.1n.b.10.3.2.g.n.1.3a
56.7.3q.3b.1.2.1p.a.11.3.2.g.o.1.39
56.7.n.1.32.3c.1r.a.11.3.5.d.v.2.31
57.5.n.2.2.1.30.3a.f.1.1d.9.11.2.7.c.w.1.31
58.4.m.2.3.4.2y.3a.b.4.1e.8.12.1.7.b.r.2.3.1.32
59.4.h.d.30.39.3.b.1e.8.11.2.8.9.s.3.35
59.4.g.7.2.a.3.4.2o.3n.1f.6.12.1.c.4.w.1.35
5b.3.f.7.2.j.2o.3l.1f.5.13.1.c.3.w.2.1.1.33
5d.2.5.3.5.8.2.l.2m.3k.1g.4.3.1.10.2.b.2.13.1.30
5d.4.1.2.3.2.2.x.2m.3j.1h.2.4.2.z.3.1e.2.30
5g.3.5.11.2l.3i.1j.1.4.3.z.2.1a.2.1.4.2z
5i.1.5.12.2l.3h.1o.3.z.3.18.2.1.5.2z
5o.13.2l.3f.1p.4.z.2.1b.5.2z
5p.13.2m.3c.1q.3.11.3.19.3.31
5p.14.2m.o.6.2h.1q.2.13.3.t.2.d.3.31
5q.1a.2g.l.9.2g.2v.4.r.4.3g
5p.1d.2f.h.d.2e.2m.1.9.5.p.7.3e
5q.1d.2g.4.o.2d.2n.5.5.5.o.6.3g
5p.1g.3d.26.2o.4.5.6.l.8.3g
5q.1g.3d.24.2r.4.4.5.k.8.3h
5p.1h.3e.22.2t.4.4.4.j.9.3h
5o.1j.3d.21.2v.4.3.4.g.c.3h
5n.1m.3b.20.2w.5.4.3.f.d.3g
5n.1n.3a.1y.30.5.3.2.e.e.3g
5m.1o.39.1x.32.7.d.j.c.1.32
5k.1r.38.1w.33.9.b.h.6.8.33
5k.1r.38.1b.1.j.35.8.b.h.c.1.34
5k.1r.38.1a.3.h.37.7.b.h.3h
5j.1s.1.1.35.1a.4.g.39.6.c.g.t.2.2m
5j.1x.32.1a.4.g.39.8.b.e.5.2.2.2.h.6.2k
5j.1z.31.19.3.g.3b.7.2.1.8.d.6.4.l.4.7.1.2c
5j.20.30.19.3.f.3c.8.b.c.6.4.o.1.6.4.2a
5j.24.2x.1o.3f.8.1.1.8.b.6.3.1.2.m.3.4.9.26
5k.29.2s.1n.3g.8.f.5.6.3.1.2.9.1.3.4.5.4.2.c.24
5j.2c.2r.1m.3h.7.h.2.8.2.2.2.8.1.f.i.21
5i.2e.2r.z.1.k.3j.6.r.2.2.2.p.j.1z
5i.2f.2r.y.1.j.3l.5.r.2.x.h.d.1.1j
5i.2j.2n.1i.3m.4.r.1.10.f.c.1.1k
5i.2k.2n.y.1.i.5i.h.5.5.1l
5j.2j.2n.1g.3r.3.1q.i.4.3.1m
5k.2i.2o.x.2.h.3q.5.4.2.1i.h.1u
5l.2h.2o.y.1.i.3q.d.1f.h.1u
5l.2h.2o.1h.3x.6.1e.d.1.5.1t
5m.2g.2p.y.1.h.42.1.1.2.1a.3.2.8.5.3.1s
5n.2f.2p.1g.49.1.1.1.5.4.7.2.s.6.6.4.1r
5n.2e.2p.1h.4q.2.v.1.b.4.1q
5o.2c.2r.1g.4h.1.7.1.1a.4.1p
5o.2b.2s.1h.7s
5o.2a.2u.1h.7r
5p.28.2v.1h.5n.1.23
5q.27.2v.14.2.b.54.1.i.2.22
5q.26.2v.15.1.c.53.6.1.1.c.2.22
5r.24.2v.1j.h.1.4i.c.b.2.22
5r.23.2v.18.1.b.h.2.4g.c.b.4.21
5s.22.2v.18.1.b.g.3.4g.c.b.4.21
5s.22.2v.1k.f.4.49.2.4.c.c.4.21
5t.21.2v.1l.d.5.47.5.2.d.c.7.1y
5u.20.2u.1l.d.7.45.m.b.7.1y
5v.9.2.1o.2u.1l.b.7.46.o.a.7.1y
5x.1x.2u.1k.a.9.46.q.8.8.1x
5z.1v.2u.1i.b.a.44.u.5.9.1x
61.1s.2v.1g.c.b.42.x.4.a.1w
62.1r.2v.1e.e.b.42.1b.1r.2.3
63.1q.2v.1d.f.b.41.1c.1w
63.1p.2x.1c.g.9.42.1c.1w
64.1o.2x.1a.i.9.41.1e.1v
64.1o.2y.18.j.8.40.1i.1t
64.1n.2z.17.k.8.3x.1n.1r
64.1n.30.17.i.9.3s.1.1.1q.w.1.u
64.1m.32.16.h.a.3r.1u.w.1.t
64.1m.32.16.h.9.3q.1x.x.1.r
64.1l.34.16.g.9.3p.1y.1p
63.1l.35.16.g.9.3o.21.1n
63.1f.3b.16.g.8.3p.21.1n
63.1d.3d.16.g.8.3o.23.1m
63.1b.3f.16.g.8.3o.24.1l
63.19.3h.14.j.6.3p.25.1k
63.18.3j.11.m.3.3s.25.1j
63.18.3j.10.4i.26.1i
63.18.3j.10.4i.26.1i
63.18.3j.10.4i.26.1i
62.19.3k.z.4i.26.1i
62.19.3k.y.4j.27.1h
62.18.3m.x.4k.26.1h
61.18.3o.v.4l.26.1h
61.17.3q.t.4n.25.1h
62.16.3q.s.4o.24.1i
61.16.3s.q.4p.24.1i
61.16.3s.q.4q.23.1i
61.14.3v.o.4r.23.1i
61.13.3w.n.4t.p.7.15.1j
61.12.3y.l.4u.k.g.11.1j
61.12.3x.l.4v.i.i.10.1k
61.11.3y.j.4w.h.l.6.1.r.1l
61.10.40.e.50.g.n.4.2.q.1m
60.10.42.5.58.8.w.1.3.r.1m
60.w.2.1.9h.5.14.o.1n
60.u.av.o.1a.1.c
5z.u.ay.l.1c.1.b
5z.v.ax.l.1o
5y.x.ax.k.1o
5y.w.ay.j.1f.2.8
5x.w.b0.f.1i.2.8
5x.v.b4.5.1.4.1k.6.4
5y.q.d2.6.4
5y.m.d4.6.6
5y.m.d6.4.6
5x.m.d8.2.7
5x.m.d8.2.7
5x.h.bo.2.1.3.1c.2.4.2.8
5z.f.bo.6.1c.4.c
5w.1.2.f.bp.5.1b.4.d
5w.1.2.f.bp.5.1a.5.d
5z.f.bq.2.1b.4.f
5y.f.d2.6.f
5y.f.d0.5.i
5y.f.cz.6.i
5y.c.d0.8.i
5x.c.d1.7.j
5u.f.d3.4.k
5w.d.dr
5w.g.do
5v.h.do
5v.g.dp
5t.g.dr
5u.1.1.d.dr
5w.c.ds
5w.a.du
5w.a.du
5w.a.du
5w.2.1.7.h.5.d8
5w.b.dt
5x.1.2.3.1.3.dt
61.1.1.5.ds
5y.2.4.5.dr
65.5.dq
65.2.1.4.do
66.1.dt
k0
k0
k0
k0
k0
k0
k0
k0
k0
k0
k0
k0
k0
k0
k0
6w.2.d2
6q.2.d8
6m.5.d9
6g.1.2.7.da
6g.9.8m.3.4m
6e.a.8n.5.4.3.2.4.47
6d.a.66.b.1f.2.8.4.e.k.b.6.w.2.4.6.2g
67.1.3.c.66.d.1e.f.2.z.4.d.a.2.2.8.5.k.28
66.2.1.1.1.c.63.k.1a.3k.1w
6a.d.5w.19.2.2.m.3m.1w
6a.g.5o.1i.i.3v.1r
61.1.6.i.5i.1p.f.3q.1.3.2.d.1f
60.5.2.g.3b.2.1p.3.3.5.8.1u.7.3x.3.2.1.3.2.8.1.1.19
5t.1.4.p.3b.3.q.4.1.4.m.j.1.62.1.n.14
5i.2.c.r.35.1.2.d.1.12.3.7j.13
5i.1.b.1.1.r.2t.9m.2.1.v
5x.q.2q.9z.o
5u.u.2m.a7.j
4b.d.1b.p.2g.a9.2.1.k
4a.e.2.e.k.3.8.p.2a.ah.l
4b.1.1.19.2.9.1.p.29.ae.1.1.1.1.m
2z.7.r.3.c.2a.29.ab.u
2t.x.8.3.c.29.26.a9.2.3.u
2h.1h.1.6.8.28.23.af.x
29.22.2.2a.20.ag.x
20.4r.1s.ai.z
1w.50.1m.aj.z
1m.5f.1b.ap.z
17.a.3.5o.z.av.y
16.66.q.b2.5.g.b
z.48.1.eo.4
0.k0
0.k0
0.k0
0.k0
0.k0
0.k0
0.k0
0.5u.1.e5
0.j6.1.t
0.j5.3.s
0.k0
0.jk.1.f
0.a.2.j6.2.4.2.a
0.a.1.2.3.jk
0.k0
0.k0
0.k0
0.k0
0.k0
0.k0
0.k0
0.k0
0.k0`.split("\n").map(row => {
    let edge = 0;
    return Uint16Array.from(row.split("."), run => (edge += parseInt(run, 36)));
  });

  function isEastAsiaLand(lonDeg, latDeg) {
    const lon = ((lonDeg + 180) % 360 + 360) % 360;
    const x = Math.floor(lon * 2);
    const row = LAND_ROWS[clamp(Math.floor((90 - latDeg) * 2), 0, 359)];
    let lo = 0, hi = row.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (x < row[mid]) hi = mid;
      else lo = mid + 1;
    }
    return (lo & 1) === 1;
  }

  const MAJOR_CITIES = [
    { lon: 126.98, lat: 37.57, bright: 1.0 },  // Seoul
    { lon: 129.07, lat: 35.18, bright: 0.72 }, // Busan
    { lon: 139.69, lat: 35.68, bright: 0.95 }, // Tokyo
    { lon: 135.50, lat: 34.69, bright: 0.78 }, // Osaka
    { lon: 121.47, lat: 31.23, bright: 0.90 }, // Shanghai
    { lon: 116.41, lat: 39.90, bright: 0.86 }, // Beijing
    { lon: 114.17, lat: 22.32, bright: 0.80 }, // Hong Kong / Shenzhen
    { lon: 121.56, lat: 25.03, bright: 0.68 }, // Taipei
  ];

  // =========================================================================
  // ACT 0A (0.00 -> 2.10s): DEEP SPACE MILKY WAY, BEACON LOCK & DEPARTURE
  // =========================================================================
  function renderDeepSpace(bufs, spec, t) {
    const { cols, rows } = spec;
    const wide = spec.wide;
    const u = clamp(t / 2.1);
    const warp = smooth((t - 1.32) / 0.72);
    const driftX = t * (wide ? 2.1 : 1.0) * cols / (wide ? 175 : 79);
    const driftY = t * (wide ? 0.52 : 0.25) * rows / (wide ? 59 : 35);

    drawFrame(bufs, spec, wide ? "CAM 01 // ECLIPTIC DEEP SPACE" : "CAM 01 // DEEP SPACE");

    // Sweeping diagonal multi-color Milky Way dust band with fine high-res filaments.
    const nebula = getNebula(spec);
    for (let r = 2; r < rows - 2; r++) {
      for (let c = 2; c < cols - 2; c++) {
        const sx = Math.min(cols - 1, c + Math.floor(driftX));
        const sy = Math.min(rows - 1, r + Math.floor(driftY));
        const i = sy * cols + sx;
        const density = nebula.density[i] * (1 - warp * 0.68);
        if (density < 0.23) continue;
        const warmPocket = nebula.warm[i];
        const ch = density > 0.72 ? "\u2592" : density > 0.56 ? "\u2591" : density > 0.40 ? ":" : "\u00b7";
        if (warmPocket) bufs.warm[r][c] = ch;
        else bufs.cool[r][c] = ch;
      }
    }

    // Crisp twinkling starfield; stretches radially into warp streaks on launch.
    const stars = getStars(cols, rows);
    const sx0 = Math.round(cols * 0.27);
    const sy0 = Math.round(rows * 0.35);
    const midX = cols * 0.5;
    const midY = rows * 0.5;
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      if (tw < 0.18 && s.mag < 0.5) continue;
      const px = ((s.x - driftX * (0.25 + s.mag * 0.55)) % (cols - 4) + (cols - 4)) % (cols - 4) + 2;
      const py = ((s.y - driftY * (0.2 + s.mag * 0.3)) % (rows - 4) + (rows - 4)) % (rows - 4) + 2;
      if (Math.hypot((px - sx0) / CHAR_ASPECT, py - sy0) < (wide ? 4.2 : 2.8)) continue;
      const targetLayer = s.warm ? bufs.warm : bufs.cool;
      if (warp > 0.08) {
        const vx = px - midX;
        const vy = py - midY;
        const mag = Math.hypot(vx, vy) || 1;
        const stretch = warp * (wide ? 9.5 : 4.6) * (0.4 + s.mag);
        const x1 = px + (vx / mag) * stretch;
        const y1 = py + (vy / mag) * stretch * 0.48;
        drawLine(targetLayer, cols, rows, px, py, x1, y1, null);
        put(bufs.struct, cols, rows, x1, y1, s.mag > 0.7 ? "+" : "\u00b7");
      } else {
        const ch = tw > 0.85 && s.mag > 0.72 ? "*" : s.glyph;
        put(targetLayer, cols, rows, px, py, ch);
      }
    }

    // Hero beacon target lock (0.32-0.90s), ignition flare (0.85-1.45s), & launch (1.32-2.05s).
    const lockP = smooth((t - 0.32) / 0.58);
    const ignite = smooth((t - 0.85) / 0.22) * (1 - smooth((t - 1.32) / 0.45));
    const depart = smooth((t - 1.32) / 0.70);

    const endX = cols * 0.88;
    const endY = rows * 0.74;
    const ctrlX = cols * 0.62;
    const ctrlY = rows * 0.28;
    const dp = depart * depart;
    const headX = (1 - dp) * (1 - dp) * sx0 + 2 * (1 - dp) * dp * ctrlX + dp * dp * endX;
    const headY = (1 - dp) * (1 - dp) * sy0 + 2 * (1 - dp) * dp * ctrlY + dp * dp * endY;

    // Contracting target lock brackets around source star before departure.
    if (t >= 0.30 && depart < 0.35) {
      const brX = Math.round(lerp(cols * 0.095, cols * 0.034, lockP));
      const brY = Math.round(lerp(rows * 0.115, rows * 0.052, lockP));
      put(bufs.fx, cols, rows, sx0 - brX, sy0 - brY, "\u250c");
      put(bufs.fx, cols, rows, sx0 + brX, sy0 - brY, "\u2510");
      put(bufs.fx, cols, rows, sx0 - brX, sy0 + brY, "\u2514");
      put(bufs.fx, cols, rows, sx0 + brX, sy0 + brY, "\u2518");
      if (t >= 0.62) {
        const tag = wide ? "TX-01 // CARRIER DETECTED" : "TX-01 // CARRIER";
        writeTextCleared(
          bufs,
          t >= 0.88 ? "signal" : "fx",
          cols,
          rows,
          Math.max(3, sx0 - Math.floor(tag.length * 0.45)),
          Math.max(2, sy0 - brY - (wide ? 6 : 4)),
          tag,
        );
      }
    }

    // Ignition optical cross-flare.
    if (ignite > 0.02) {
      const rx = Math.round(cols * 0.145 * ignite);
      const ry = Math.round(rows * 0.155 * ignite);
      for (let k = 1; k <= rx; k++) {
        const ch = k <= rx * 0.45 ? "\u2500" : k <= rx * 0.75 ? "-" : "\u00b7";
        const layer = k <= rx * 0.28 ? bufs.fx : bufs.signal;
        put(layer, cols, rows, headX - k, headY, ch);
        put(layer, cols, rows, headX + k, headY, ch);
      }
      for (let k = 1; k <= ry; k++) {
        const ch = k <= ry * 0.55 ? "\u2502" : "\u00b7";
        const layer = k <= ry * 0.35 ? bufs.fx : bufs.signal;
        put(layer, cols, rows, headX, headY - k, ch);
        put(layer, cols, rows, headX, headY + k, ch);
      }
      if (ignite > 0.42) {
        for (let k = 1; k <= Math.max(2, Math.round(ry * 0.72)); k++) {
          put(bufs.signal, cols, rows, headX - k * 2, headY - k, "\\");
          put(bufs.signal, cols, rows, headX + k * 2, headY + k, "\\");
          put(bufs.signal, cols, rows, headX + k * 2, headY - k, "/");
          put(bufs.signal, cols, rows, headX - k * 2, headY + k, "/");
        }
      }
    }

    // Glowing tapered wake during departure.
    if (depart > 0.02) {
      const trailSamples = wide ? 56 : 28;
      const trailSpan = Math.min(dp, 0.42);
      for (let i = 1; i <= trailSamples; i++) {
        const frac = i / trailSamples;
        const p = Math.max(0, dp - trailSpan * frac);
        const tx = (1 - p) * (1 - p) * sx0 + 2 * (1 - p) * p * ctrlX + p * p * endX;
        const ty = (1 - p) * (1 - p) * sy0 + 2 * (1 - p) * p * ctrlY + p * p * endY;
        const ch = frac < 0.22 ? "\u2550" : frac < 0.55 ? "\u2500" : frac < 0.80 ? "-" : "\u00b7";
        put(frac < 0.25 ? bufs.fx : bufs.signal, cols, rows, tx, ty, ch);
      }
    }

    // Source / travelling carrier core.
    const coreCh = t >= 0.85 ? "\u25c8" : t >= 0.50 ? "*" : "+";
    put(t >= 0.85 ? bufs.fx : bufs.signal, cols, rows, headX, headY, coreCh);
    if (t >= 0.88) {
      put(bufs.signal, cols, rows, headX - 1, headY, "(");
      put(bufs.signal, cols, rows, headX + 1, headY, ")");
    }

    // Clean subtle transition scan-bar wipe on last 0.16s.
    if (u > 0.92) {
      const sweepRow = Math.round(((u - 0.92) / 0.08) * (rows - 2)) + 1;
      for (let c = 1; c < cols - 1; c++) put(bufs.fx, cols, rows, c, sweepRow, "\u2500");
    }
  }

  // =========================================================================
  // ACT 0B (2.10 -> 4.25s): ORBITAL APPROACH — ROTATING 3D ASCII EARTH & SEOUL
  // =========================================================================
  function renderOrbitalApproach(bufs, spec, t) {
    const { cols, rows } = spec;
    const wide = spec.wide;
    const localT = clamp(t - 2.10, 0, 2.15);
    const p = smooth(localT / 2.05);

    drawFrame(bufs, spec, wide ? "CAM 02 // ORBITAL APPROACH" : "CAM 02 // ORBIT");

    // Sparse background stars outside globe.
    const stars = getStars(cols, rows);
    for (let i = 0; i < stars.length; i += 2) {
      const s = stars[i];
      const tw = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      if (tw < 0.25) continue;
      put(s.warm ? bufs.warm : bufs.cool, cols, rows, s.x, s.y, s.mag > 0.8 ? "+" : "\u00b7");
    }

    // High-res 3D sphere projection balanced between left HUD and right Seoul callout.
    const cx = cols * (wide ? 0.56 : 0.50);
    const cy = rows * (wide ? 0.53 : 0.52);
    const narrowMaxR = Math.min(rows * 0.36, (cols * 0.42) / CHAR_ASPECT);
    const R = wide ? lerp(rows * 0.285, rows * 0.395, p) : lerp(narrowMaxR * 0.72, narrowMaxR, p);
    const centerLonDeg = lerp(104, 128, p);
    const tiltRad = 0.26;
    const cosTilt = Math.cos(tiltRad);
    const sinTilt = Math.sin(tiltRad);
    const sunX = 0.72;
    const sunY = -0.34;
    const sunZ = 0.60;

    function projectGeo(lonDeg, latDeg) {
      const phi = (latDeg * Math.PI) / 180;
      const lam = ((lonDeg - centerLonDeg) * Math.PI) / 180;
      const x0 = Math.cos(phi) * Math.sin(lam);
      const y0 = -Math.sin(phi);
      const z0 = Math.cos(phi) * Math.cos(lam);
      const y1 = y0 * cosTilt + z0 * sinTilt;
      const z1 = -y0 * sinTilt + z0 * cosTilt;
      if (z1 <= 0.05) return null;
      return {
        c: cx + x0 * R * CHAR_ASPECT,
        r: cy + y1 * R,
        z: z1,
      };
    }

    const rMin = Math.max(2, Math.floor(cy - R - 1));
    const rMax = Math.min(rows - 3, Math.ceil(cy + R + 1));
    const cMin = Math.max(2, Math.floor(cx - R * CHAR_ASPECT - 1));
    const cMax = Math.min(cols - 3, Math.ceil(cx + R * CHAR_ASPECT + 1));
    const rimInner = 1 - 1.05 / R;
    const gridDeg = wide ? 20 : 30;
    const gridHalf = gridDeg * 0.5;
    const gridThresh = gridHalf - (wide ? 0.68 : 0.96);

    for (let r = rMin; r <= rMax; r++) {
      const ny = (r - cy) / R;
      for (let c = cMin; c <= cMax; c++) {
        const nx = (c - cx) / (R * CHAR_ASPECT);
        const d2 = nx * nx + ny * ny;
        if (d2 > 1.0) continue;
        bufs.cool[r][c] = " ";
        bufs.warm[r][c] = " ";
        const nz = Math.sqrt(Math.max(0, 1 - d2));
        const d = Math.sqrt(d2);

        const gy = ny * cosTilt - nz * sinTilt;
        const gz = ny * sinTilt + nz * cosTilt;
        const latDeg = (-Math.asin(clamp(gy, -1, 1)) * 180) / Math.PI;
        const lonDeg = centerLonDeg + (Math.atan2(nx, gz) * 180) / Math.PI;
        const solar = nx * sunX + ny * sunY + nz * sunZ;

        // Crisp 1-cell atmospheric horizon limb.
        if (d > rimInner) {
          const ax = Math.abs(nx);
          const ay = Math.abs(ny);
          let rimCh;
          if (ay > ax * 2.15) rimCh = "\u2500";
          else if (ax > ay * 2.15) rimCh = "\u2502";
          else rimCh = nx * ny > 0 ? "/" : "\\";
          if (solar > 0.08) bufs.fx[r][c] = rimCh;
          else if (solar > -0.25) bufs.struct[r][c] = rimCh;
          else bufs.cool[r][c] = rimCh;
          continue;
        }

        const land = isEastAsiaLand(lonDeg, latDeg);
        const latLine = Math.abs(((latDeg + 90) % gridDeg) - gridHalf) > gridThresh;
        const lonLine = Math.abs((((lonDeg + 540) % gridDeg) - gridHalf)) > gridThresh;

        if (land) {
          // Geographic detail stays fixed to the rotating globe, including a
          // one-cell coast edge and broad terrain ridges across the mainland.
          const geoStep = 40 / R;
          const coast = !isEastAsiaLand(lonDeg + geoStep, latDeg) ||
            !isEastAsiaLand(lonDeg - geoStep, latDeg) ||
            !isEastAsiaLand(lonDeg, latDeg + geoStep) ||
            !isEastAsiaLand(lonDeg, latDeg - geoStep);
          const ridge = Math.sin(lonDeg * 0.31 + Math.sin(latDeg * 0.19) * 2) *
            Math.cos(latDeg * 0.42 - lonDeg * 0.12);
          if (coast) bufs.struct[r][c] = solar > 0.05 ? ":" : ".";
          else if (solar > 0.36) bufs.struct[r][c] = ridge > 0.32 ? "\u2592" : "\u2591";
          else if (solar > 0.05) bufs.struct[r][c] = ridge > 0.32 ? "\u2591" : ":";
          else if (solar > -0.18) bufs.struct[r][c] = ":";
          else bufs.cool[r][c] = "\u00b7";
        } else if (latLine && lonLine) {
          bufs.cool[r][c] = "+";
        } else if (latLine) {
          bufs.cool[r][c] = "-";
        } else if (lonLine) {
          bufs.cool[r][c] = "\u00b7";
        } else if (solar > 0.45 && hash2(Math.floor(lonDeg * 0.45), Math.floor(latDeg * 0.45)) > 0.74) {
          bufs.cool[r][c] = "~";
        }
      }
    }

    // East Asian night city-light pinpoints.
    for (const city of MAJOR_CITIES) {
      const pt = projectGeo(city.lon, city.lat);
      if (!pt) continue;
      put(bufs.warm, cols, rows, pt.c, pt.r, city.bright > 0.88 ? "*" : "+");
    }

    // Seoul target projection & incoming carrier trajectory arc.
    const seoul = projectGeo(126.98, 37.57) || { c: cx + 2, r: cy - 4 };
    const startX = cols * 0.06;
    const startY = rows * 0.14;
    const arcCtrlX = cols * (wide ? 0.33 : 0.28);
    const arcCtrlY = rows * 0.10;

    // Subtle planned dotted trajectory vector.
    const arcSteps = wide ? 68 : 34;
    for (let i = 2; i < arcSteps; i += 2) {
      const u = i / arcSteps;
      const ax = (1 - u) * (1 - u) * startX + 2 * (1 - u) * u * arcCtrlX + u * u * seoul.c;
      const ay = (1 - u) * (1 - u) * startY + 2 * (1 - u) * u * arcCtrlY + u * u * seoul.r;
      put(bufs.grid, cols, rows, ax, ay, "\u00b7");
    }

    // Carrier pulse riding down the arc to Seoul lock!
    const flightP = smooth(localT / 1.78);
    const trailLen = 0.28;
    const trailSteps = wide ? 42 : 22;
    for (let i = 1; i <= trailSteps; i++) {
      const frac = i / trailSteps;
      const u = Math.max(0, flightP - trailLen * frac);
      if (u <= 0) continue;
      const tx = (1 - u) * (1 - u) * startX + 2 * (1 - u) * u * arcCtrlX + u * u * seoul.c;
      const ty = (1 - u) * (1 - u) * startY + 2 * (1 - u) * u * arcCtrlY + u * u * seoul.r;
      const ch = frac < 0.25 ? "\u2550" : frac < 0.60 ? "\u2500" : "\u00b7";
      put(frac < 0.28 ? bufs.fx : bufs.signal, cols, rows, tx, ty, ch);
    }

    const headX = (1 - flightP) * (1 - flightP) * startX + 2 * (1 - flightP) * flightP * arcCtrlX + flightP * flightP * seoul.c;
    const headY = (1 - flightP) * (1 - flightP) * startY + 2 * (1 - flightP) * flightP * arcCtrlY + flightP * flightP * seoul.r;
    put(bufs.fx, cols, rows, headX, headY, "\u25c8");

    // Seoul target reticle + lock ring.
    const sc = Math.round(seoul.c);
    const sr = Math.round(seoul.r);
    put(bufs.signal, cols, rows, sc - 2, sr, "[");
    put(bufs.signal, cols, rows, sc + 2, sr, "]");
    put(bufs.fx, cols, rows, sc, sr, flightP > 0.92 ? "\u25c8" : "+");

    if (flightP > 0.85) {
      const ring = smooth((flightP - 0.85) / 0.15);
      const rx = Math.round(2 + ring * (wide ? 9 : 4));
      const ry = Math.round(1 + ring * (wide ? 4 : 2));
      put(bufs.signal, cols, rows, sc - rx, sr, "(");
      put(bufs.signal, cols, rows, sc + rx, sr, ")");
      put(bufs.signal, cols, rows, sc, sr - ry, "\u2500");
      put(bufs.signal, cols, rows, sc, sr + ry, "\u2500");
    }

    // Crisp left-margin orbital telemetry HUD (wide) or compact top-left HUD (narrow).
    const altKm = Math.max(4.2, lerp(420, 4.2, p * p)).toFixed(1).padStart(5, " ");
    const doppler = lerp(0.48, 0.0, p).toFixed(2);
    if (wide) {
      const hudTop = Math.round(rows * 0.34);
      writeTextCleared(bufs, "grid", cols, rows, 5, hudTop - 2, "\u2500\u2500 ORBITAL TELEMETRY \u2500\u2500");
      const lines = [
        "PHASE   02 / ORBITAL ENTRY",
        "TARGET  SEL / SEOUL RX",
        "COORDS  37.57N  126.98E",
        `ALT     ${altKm} KM`,
        `DOPPLER +${doppler} kHz`,
        flightP > 0.85 ? "STATUS  [SEOUL LOCKED]" : "STATUS  [ACQUIRING...]",
      ];
      for (let i = 0; i < lines.length; i++) {
        writeTextCleared(bufs, i === 5 && flightP > 0.85 ? "signal" : "struct", cols, rows, 5, hudTop + i * 2, lines[i]);
      }
      const limbRight = Math.min(cols - 20, Math.round(cx + R * CHAR_ASPECT) + 3);
      const lxStart = sc + 3;
      if (limbRight > lxStart + 2) {
        drawLine(bufs.signal, cols, rows, lxStart, sr, limbRight - 1, sr, "\u2500");
        writeTextCleared(bufs, "fx", cols, rows, limbRight, sr, "SEL // SEOUL RX");
      }
    } else {
      writeTextCleared(bufs, "struct", cols, rows, 2, 2, `ALT ${altKm} KM`);
      writeTextCleared(bufs, "signal", cols, rows, 2, rows - 3, "LOCK: 37.57N 126.98E");
    }
  }

  // =========================================================================
  // ACT 0C (4.25 -> 6.40s): SEOUL ROOFTOP PARABOLIC RADIO DISH & CAPTURE
  // =========================================================================
  function renderObservatoryCapture(bufs, spec, t, reducedStatic = false) {
    const { cols, rows } = spec;
    const wide = spec.wide;
    const scaleX = cols / (wide ? 175 : 79);
    const scaleY = rows / (wide ? 59 : 35);
    const localT = reducedStatic ? 1.35 : clamp(t - 4.25, 0, 2.15);

    drawFrame(
      bufs,
      spec,
      wide ? "CAM 03 // SEOUL ROOFTOP RECEIVER (37.57N 126.98E)" : "CAM 03 // SEOUL RX",
    );

    // Clear nocturnal Seoul sky with twinkling stars.
    const stars = getStars(cols, rows);
    const skyLimit = rows - (wide ? 13 : 8) * scaleY;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (s.y > skyLimit) continue;
      const tw = reducedStatic ? 0.8 : 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      if (tw < 0.22) continue;
      put(s.warm ? bufs.warm : bufs.cool, cols, rows, s.x, s.y, s.mag > 0.82 ? "+" : "\u00b7");
    }

    // Architectural Seoul night skyline along bottom horizon.
    const deckY = rows - Math.round((wide ? 5 : 4) * scaleY);
    const buildings = wide
      ? [
          [4, 11, 6], [17, 10, 9], [46, 12, 7], [60, 9, 5],
          [125, 11, 7], [138, 12, 10], [152, 10, 8], [163, 9, 5],
        ]
      : [
          [3, 8, 4], [12, 7, 6], [58, 8, 5], [68, 8, 4],
        ];
    for (const [baseX, baseW, baseH] of buildings) {
      const bx = Math.round(baseX * scaleX), bw = Math.round(baseW * scaleX);
      const bh = Math.round(baseH * scaleY);
      const top = deckY - bh;
      for (let c = bx; c < bx + bw && c < cols - 2; c++) {
        put(bufs.grid, cols, rows, c, top, "\u2500");
        for (let r = top + 1; r < deckY; r++) {
          const edge = c === bx || c === bx + bw - 1;
          if (edge) put(bufs.grid, cols, rows, c, r, "\u2502");
          else if ((c - bx) % 3 === 1 && (r - top) % 2 === 0 &&
            hash2(Math.floor(c / 3), Math.floor(r / 2)) > 0.36) {
            put(bufs.warm, cols, rows, c, r, ":");
          } else if ((r - top) % 4 === 0) put(bufs.grid, cols, rows, c, r, "\u2500");
        }
      }
      put(bufs.grid, cols, rows, bx, top, "\u250c");
      put(bufs.grid, cols, rows, bx + bw - 1, top, "\u2510");
      // Recessed roof equipment and thin aerials now resolve above the windows.
      drawLine(bufs.grid, cols, rows, bx + 2, top - 1, bx + Math.min(bw - 3, 6), top - 1, "_");
      if (baseH > 5) drawLine(bufs.struct, cols, rows, bx + bw - 3, top, bx + bw - 3, top - 3, "\u2502");
    }

    // Distant Namsan Seoul Tower standing clearly on the left skyline gap.
    const towerX = Math.round((wide ? 36 : 23) * scaleX);
    const towerTop = deckY - Math.round((wide ? 18 : 10) * scaleY);
    drawLine(bufs.grid, cols, rows, towerX, deckY - 1, towerX, towerTop + 3, "\u2502");
    if (wide) {
      drawLine(bufs.grid, cols, rows, towerX - 1, deckY - 1, towerX - 1, towerTop + 9, "\u2502");
      drawLine(bufs.grid, cols, rows, towerX + 1, deckY - 1, towerX + 1, towerTop + 9, "\u2502");
      writeText(bufs.struct, cols, rows, towerX - 3, towerTop + 6, "/=====\\");
      writeText(bufs.struct, cols, rows, towerX - 2, towerTop + 7, "\\===/");
    } else {
      writeText(bufs.struct, cols, rows, towerX - 2, towerTop + 4, "/===\\");
    }
    put(bufs.grid, cols, rows, towerX, towerTop + 1, "\u2502");
    put(bufs.grid, cols, rows, towerX, towerTop + 2, "\u2502");
    const mastPulse = reducedStatic || Math.sin(t * 4.5) > 0;
    put(mastPulse ? bufs.signal : bufs.warm, cols, rows, towerX, towerTop, mastPulse ? "*" : "\u00b7");

    // Rooftop observatory deck horizon line.
    for (let c = 2; c < cols - 2; c++) {
      put(bufs.struct, cols, rows, c, deckY, "\u2550");
    }

    // High-res tilted parabolic radio dish aimed upper-left at the incoming signal!
    const dishBaseX = cols * (wide ? 0.58 : 0.54);
    const dishScale = wide ? scaleY : Math.min(scaleX * 1.15, scaleY);
    const vertexX = dishBaseX;
    const vertexY = deckY - (wide ? 14 : 8) * dishScale;
    const tilt = 0.34;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const halfSpan = (wide ? 22.0 : 11.4) * dishScale;
    const focal = (wide ? 17.8 : 9.4) * dishScale;

    const approachP = smooth(localT / 0.85);
    const contactAge = Math.max(0, localT - 0.85);
    const flash = contactAge > 0 ? Math.exp(-contactAge * 2.8) : 0;
    const rippleRadius = contactAge > 0 ? Math.min(halfSpan + 5 * dishScale, contactAge * (wide ? 38 : 22) * dishScale) : -1;

    function dishToScreen(u, v) {
      const rx = u * cosT - v * sinT;
      const ry = u * sinT + v * cosT;
      return {
        c: vertexX + rx * CHAR_ASPECT,
        r: vertexY - ry,
      };
    }

    // Pedestal base, truss cross-bracing, azimuth housing & elevation yoke.
    const pedW = Math.round((wide ? 10 : 5) * scaleX);
    const yokeHalf = Math.round((wide ? 4 : 3) * scaleX);
    const yokeY = vertexY + 1;
    drawLine(bufs.struct, cols, rows, dishBaseX - pedW, deckY - 1, dishBaseX - yokeHalf, yokeY, "/");
    drawLine(bufs.struct, cols, rows, dishBaseX + pedW, deckY - 1, dishBaseX + yokeHalf, yokeY, "\\");
    drawLine(bufs.struct, cols, rows, dishBaseX - yokeHalf, yokeY, dishBaseX + yokeHalf, yokeY, "\u2500");
    put(bufs.struct, cols, rows, dishBaseX - yokeHalf, yokeY, "\u250c");
    put(bufs.struct, cols, rows, dishBaseX + yokeHalf, yokeY, "\u2510");
    if (wide) {
      drawLine(bufs.grid, cols, rows, dishBaseX - yokeHalf + 1, yokeY + 2, dishBaseX + yokeHalf - 1, deckY - 5, "\\");
      drawLine(bufs.grid, cols, rows, dishBaseX + yokeHalf - 1, yokeY + 2, dishBaseX - yokeHalf + 1, deckY - 5, "/");
    }
    for (let r = yokeY + 1; r < deckY; r++) {
      put(bufs.grid, cols, rows, dishBaseX - yokeHalf, r, "\u2502");
      put(bufs.grid, cols, rows, dishBaseX + yokeHalf, r, "\u2502");
      if (r === deckY - 2) {
        writeText(bufs.grid, cols, rows, dishBaseX - yokeHalf + 1, r, "=".repeat(yokeHalf * 2 - 1));
      }
    }
    // Physical status lamp on equipment housing (turns blazing amber on capture!).
    const lampLit = contactAge > 0.08;
    put(lampLit ? bufs.signal : bufs.warm, cols, rows, dishBaseX + 1, deckY - 3, "\u25a0");
    if (wide && lampLit) {
      writeTextCleared(bufs, "signal", cols, rows, dishBaseX + pedW + 2, deckY - 3, "RX LOCKED");
    }

    // Draw parabolic reflector shell + interior panel mesh + sweeping phosphor wave!
    const samples = wide ? 208 : 108;
    const leftRim = dishToScreen(-halfSpan, (halfSpan * halfSpan) / (4 * focal));
    const rightRim = dishToScreen(halfSpan, (halfSpan * halfSpan) / (4 * focal));
    const feedPt = dishToScreen(0, focal);

    for (let i = 1; i < samples; i++) {
      const u = lerp(-halfSpan, halfSpan, i / samples);
      const vParab = (u * u) / (4 * focal);
      const vChord = (halfSpan * halfSpan) / (4 * focal);
      const stepsV = wide ? 13 : 7;
      for (let j = 1; j < stepsV; j++) {
        const v = lerp(vParab + 0.45, vChord - 0.15, j / stepsV);
        const pt = dishToScreen(u, v);
        const radialU = Math.abs(u);
        const inWave = rippleRadius >= 0 && Math.abs(radialU - rippleRadius) < (wide ? 3.4 : 2.1);
        const litBehind = rippleRadius >= 0 && radialU < rippleRadius;
        if (inWave) {
          put(bufs.fx, cols, rows, pt.c, pt.r, "\u2592");
        } else if (litBehind) {
          put(bufs.signal, cols, rows, pt.c, pt.r, j % 2 === 0 ? "\u2591" : ":");
        } else if (i % (wide ? 8 : 5) === 0 || j === Math.floor(stepsV / 2)) {
          put(bufs.cool, cols, rows, pt.c, pt.r, "\u00b7");
        }
      }
    }

    // Reflector panel seams follow the parabola from its curved rim to the
    // aperture chord. The evenly spaced ribs remain visible after capture.
    for (let panel = 1; panel < 12; panel++) {
      const u = lerp(-halfSpan, halfSpan, panel / 12);
      const edge = dishToScreen(u, u * u / (4 * focal));
      const lip = dishToScreen(u, halfSpan * halfSpan / (4 * focal));
      drawLine(bufs.cool, cols, rows, edge.c, edge.r, lip.c, lip.r, ":");
    }

    // Crisp outer parabolic rim & aperture line.
    drawLine(bufs.cool, cols, rows, leftRim.c, leftRim.r, rightRim.c, rightRim.r, "\u00b7", 2);
    for (let i = 0; i <= samples; i++) {
      const u = lerp(-halfSpan, halfSpan, i / samples);
      const v = (u * u) / (4 * focal);
      const pt = dishToScreen(u, v);
      const dvdu = u / (2 * focal);
      const tx = (cosT - dvdu * sinT) * CHAR_ASPECT;
      const ty = -(sinT + dvdu * cosT);
      const ch = lineChar(tx, ty);
      const radialU = Math.abs(u);
      const litRim = rippleRadius >= 0 && radialU <= rippleRadius;
      put(litRim ? bufs.signal : bufs.struct, cols, rows, pt.c, pt.r, ch);
      if (wide && i % 3 === 0) {
        const back = dishToScreen(u, v - 1.1);
        put(bufs.grid, cols, rows, back.c, back.r, ch);
      }
    }

    // Tripod struts converging cleanly onto the focal feed horn!
    const strutLayer = flash > 0.15 ? bufs.signal : bufs.struct;
    drawLine(strutLayer, cols, rows, leftRim.c + 1, leftRim.r, feedPt.c, feedPt.r, null);
    drawLine(strutLayer, cols, rows, rightRim.c - 1, rightRim.r, feedPt.c, feedPt.r, null);
    const midPt = dishToScreen(0, 0.5);
    drawLine(bufs.grid, cols, rows, midPt.c, midPt.r, feedPt.c, feedPt.r, null, 2);

    // Feed horn assembly at exact parabolic focus.
    const fc = Math.round(feedPt.c);
    const fr = Math.round(feedPt.r);
    put(bufs.struct, cols, rows, fc - 1, fr, "[");
    put(bufs.struct, cols, rows, fc + 1, fr, "]");
    put(contactAge > 0 ? bufs.fx : bufs.signal, cols, rows, fc, fr, contactAge > 0 ? "\u25c8" : "=");

    // Incoming beam descending from upper-left sky along the dish axis directly into (fc, fr)!
    const beamStart = dishToScreen(0, focal + (wide ? 42 : 22));
    if (localT < 0.92) {
      const bx = lerp(beamStart.c, fc, approachP);
      const by = lerp(beamStart.r, fr, approachP);
      const wakeSamples = wide ? 36 : 20;
      for (let i = 1; i <= wakeSamples; i++) {
        const frac = i / wakeSamples;
        const pW = Math.max(0, approachP - frac * 0.42);
        const wx = lerp(beamStart.c, fc, pW);
        const wy = lerp(beamStart.r, fr, pW);
        const ch = frac < 0.25 ? "\u2550" : frac < 0.60 ? "\\" : "\u00b7";
        put(frac < 0.22 ? bufs.fx : bufs.signal, cols, rows, wx, wy, ch);
      }
      put(bufs.fx, cols, rows, bx, by, "\u25c8");
    }

    // Contact optical starburst at feed horn!
    if (contactAge > 0) {
      const burst = reducedStatic ? 0.55 : clamp(flash * 1.15 + 0.24, 0, 1);
      const rx = Math.round(cols * 0.11 * burst);
      const ry = Math.round(rows * 0.13 * burst);
      for (let k = 1; k <= rx; k++) {
        const ch = k <= rx * 0.45 ? "\u2500" : "\u00b7";
        put(k <= 3 ? bufs.fx : bufs.signal, cols, rows, fc - k, fr, ch);
        put(k <= 3 ? bufs.fx : bufs.signal, cols, rows, fc + k, fr, ch);
      }
      for (let k = 1; k <= ry; k++) {
        const ch = k <= ry * 0.5 ? "\u2502" : "\u00b7";
        put(k <= 2 ? bufs.fx : bufs.signal, cols, rows, fc, fr - k, ch);
        put(k <= 2 ? bufs.fx : bufs.signal, cols, rows, fc, fr + k, ch);
      }
      for (let k = 1; k <= Math.max(2, Math.round(ry * 0.72)); k++) {
        put(bufs.signal, cols, rows, fc - k * 2, fr - k, "\\");
        put(bufs.signal, cols, rows, fc + k * 2, fr + k, "\\");
        put(bufs.signal, cols, rows, fc + k * 2, fr - k, "/");
        put(bufs.signal, cols, rows, fc - k * 2, fr + k, "/");
      }
      put(bufs.fx, cols, rows, fc, fr, "\u25c8");

      const banner = wide
        ? "[ CARRIER CAPTURED // 1420.405 MHz // BUFFERING PAYLOAD ]"
        : "[ CARRIER CAPTURED // 1420 MHz ]";
      writeTextCleared(bufs, "signal", cols, rows, wide ? 5 : 2, 3, banner);
      if (wide) {
        writeTextCleared(bufs, "struct", cols, rows, 5, 5, "FEED LOCK : NOMINAL  //  SNR +24.8 dB");
      }
    } else if (wide) {
      writeTextCleared(bufs, "struct", cols, rows, 5, 3, "RECEIVER  : TRACKING INCOMING VECTOR");
    }
  }

  function renderFrame(bufs, spec, t, reducedStatic = false) {
    clearBuffers(bufs, spec.cols, spec.rows);
    if (reducedStatic) {
      renderObservatoryCapture(bufs, spec, 5.6, true);
      return;
    }
    if (t < 2.10) renderDeepSpace(bufs, spec, t);
    else if (t < 4.25) renderOrbitalApproach(bufs, spec, t);
    else renderObservatoryCapture(bufs, spec, t, false);
  }

  function buffersToStrings(bufs) {
    const out = {};
    for (const name of LAYERS) {
      out[name] = bufs[name].map((row) => row.join("")).join("\n");
    }
    return out;
  }

  function phaseInfo(t, reduced) {
    if (reduced) {
      return {
        phase: "received",
        tag: "CARRIER CAPTURED",
        range: "DIST 0.0 KM // SEOUL ARRAY LOCKED",
        bar: 100,
      };
    }
    const pct = Math.min(100, Math.round((t / DURATION) * 100));
    if (t < 0.85) {
      return { phase: "space", tag: "SCANNING DEEP SPACE", range: "DIST 41.8 LY // ECLIPTIC SECTOR", bar: pct };
    }
    if (t < 2.10) {
      return { phase: "transit", tag: "CARRIER IGNITION", range: "TX-01 ACTIVE // SIGNAL IN TRANSIT", bar: pct };
    }
    if (t < 4.25) {
      const alt = Math.max(4.2, lerp(420, 4.2, smooth((t - 2.1) / 2.05) ** 2)).toFixed(1);
      return { phase: "orbit", tag: "ORBITAL ENTRY", range: `ALT ${alt} KM // LOCKING SEOUL RX`, bar: pct };
    }
    if (t < 5.10) {
      return { phase: "observatory", tag: "TERMINAL APPROACH", range: "ALT 0.2 KM // TRACKING FEED HORN", bar: pct };
    }
    return { phase: "received", tag: "CARRIER CAPTURED", range: "RX LOCK // HANDING OFF TO CONSOLE", bar: pct };
  }

  window.SignalAsciiIntro = {
    DURATION,
    renderSnapshot(t = 0, specName = "wide", reduced = false) {
      const spec = specName === "narrow" ? NARROW : WIDE;
      const bufs = makeBuffers(spec.cols, spec.rows);
      renderFrame(bufs, spec, t, reduced);
      return buffersToStrings(bufs);
    },
    start(root, options = {}) {
      const reduced = !!options.reducedMotion;
      const onArrival = typeof options.onArrival === "function" ? options.onArrival : () => {};
      const narrowMedia = typeof matchMedia === "function" ? matchMedia("(max-width: 700px)") : { matches: false };

      const wideBufs = makeBuffers(WIDE.cols, WIDE.rows);
      const narrowBufs = makeBuffers(NARROW.cols, NARROW.rows);

      const getEl = (id) => document.getElementById(id);
      const stateTag = getEl("intro-state");
      const rangeMeta = getEl("intro-range");
      const progressText = getEl("intro-progress");
      const layerElements = new Map([WIDE, NARROW].map(spec =>
        [spec, LAYERS.map(name => getEl(`intro-${name}${spec.suffix}`))]));

      function writeToDom(spec, bufs) {
        const elements = layerElements.get(spec);
        for (let i = 0; i < LAYERS.length; i++) {
          const name = LAYERS[i];
          const el = elements[i];
          if (el) el.textContent = bufs[name].map((row) => row.join("")).join("\n");
        }
      }

      function updateTelemetry(t) {
        const info = phaseInfo(t, reduced);
        if (root) root.dataset.phase = info.phase;
        if (stateTag && stateTag.textContent !== info.tag) stateTag.textContent = info.tag;
        if (rangeMeta && rangeMeta.textContent !== info.range) rangeMeta.textContent = info.range;
        if (progressText) {
          const filled = Math.floor((info.bar * 20) / 100);
          const barStr = `[${"\u2588".repeat(filled)}${"\u2591".repeat(20 - filled)}] ${String(info.bar).padStart(3, " ")}%`;
          if (progressText.textContent !== barStr) progressText.textContent = barStr;
        }
      }

      const initialSpec = narrowMedia.matches ? NARROW : WIDE;
      const initialBufs = narrowMedia.matches ? narrowBufs : wideBufs;
      renderFrame(initialBufs, initialSpec, 0, reduced);
      writeToDom(initialSpec, initialBufs);
      updateTelemetry(0);

      let disposed = false;
      let arrived = false;
      let frame = 0;
      let elapsedSec = 0;
      let lastNow = null;
      let lastPaint = -Infinity;
      const targetDuration = reduced ? 1.35 : DURATION;

      function tick(now) {
        frame = 0;
        if (disposed) return;
        if (!document.hidden) {
          if (lastNow !== null) {
            elapsedSec += Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
          }
          lastNow = now;
          if (!reduced && now - lastPaint >= STEP_MS) {
            lastPaint = now;
            if (narrowMedia.matches) {
              renderFrame(narrowBufs, NARROW, elapsedSec, false);
              writeToDom(NARROW, narrowBufs);
            } else {
              renderFrame(wideBufs, WIDE, elapsedSec, false);
              writeToDom(WIDE, wideBufs);
            }
            updateTelemetry(elapsedSec);
          }
          if (elapsedSec >= targetDuration && !arrived) {
            arrived = true;
            onArrival();
            return;
          }
        } else {
          lastNow = null;
        }
        frame = requestAnimationFrame(tick);
      }

      const onResizeMode = () => {
        if (disposed) return;
        const spec = narrowMedia.matches ? NARROW : WIDE;
        const bufs = narrowMedia.matches ? narrowBufs : wideBufs;
        renderFrame(bufs, spec, elapsedSec, reduced);
        writeToDom(spec, bufs);
      };
      narrowMedia.addEventListener?.("change", onResizeMode);

      frame = requestAnimationFrame(tick);

      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
          narrowMedia.removeEventListener?.("change", onResizeMode);
        },
      };
    },
  };
})();
