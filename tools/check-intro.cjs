"use strict";

// Offline regression checks for the native 245x83 wide / 79x53 portrait narrow ASCII intro engine.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const asciiIntroSource = fs.readFileSync("dist/ascii-intro.js", "utf8");
const stationCss = fs.readFileSync("dist/station.css", "utf8");

test("native ascii-intro renders uniform 245x83 wide and 79x53 portrait narrow 3-act scenes cleanly", () => {
  const window = {};
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, { id, textContent: "", dataset: {} });
    return els.get(id);
  };
  const frames = new Map();
  let fid = 0;
  const document = { hidden: false, getElementById: getEl };
  vm.runInNewContext(
    asciiIntroSource,
    {
      window,
      document,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      requestAnimationFrame(cb) { const id = ++fid; frames.set(id, cb); return id; },
      cancelAnimationFrame(id) { frames.delete(id); },
    },
    { filename: "dist/ascii-intro.js" },
  );

  for (const [mode, cols, rows] of [["wide", 245, 83], ["narrow", 79, 53]]) {
    for (const t of [0.4, 1.05, 3.3, 4.7, 5.4]) {
      const snap = window.SignalAsciiIntro.renderSnapshot(t, mode, false);
      for (const layer of ["grid", "cool", "warm", "struct", "signal", "fx"]) {
        const lines = snap[layer].split("\n");
        assert.equal(lines.length, rows, `${mode} t=${t} ${layer} has ${rows} rows`);
        assert.ok(lines.every((l) => l.length === cols), `${mode} t=${t} ${layer} rows are uniformly ${cols} cols`);
      }
      assert.ok(snap.grid.startsWith("\u250c") && snap.grid.endsWith("\u2518"), `${mode} t=${t} keeps box-drawing perimeter`);
    }
    const captureSnap = window.SignalAsciiIntro.renderSnapshot(5.4, mode, false);
    assert.ok(captureSnap.fx.includes("\u25c8"), `${mode} capture frame shows blazing carrier diamond`);
    assert.ok(captureSnap.struct.includes("\u2550"), `${mode} capture frame shows rooftop observatory deck`);
  }

  // Verify animation lifecycle, visibility pause, arrival callback, and clean dispose.
  let arrived = 0;
  const root = { dataset: {} };
  const handle = window.SignalAsciiIntro.start(root, { reducedMotion: false, onArrival: () => { arrived++; } });
  assert.equal(frames.size, 1);
  let now = 0;
  const step = (ms) => {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    for (const cb of pending) cb(now);
  };
  step(100);
  assert.equal(root.dataset.phase, "space");
  document.hidden = true;
  for (let i = 0; i < 40; i++) step(100);
  assert.equal(arrived, 0, "hidden tab pauses ASCII intro timeline");
  document.hidden = false;
  for (let i = 0; i < 80 && !arrived; i++) step(100);
  assert.equal(arrived, 1, "ASCII intro invokes onArrival cleanly upon completion");
  assert.equal(root.dataset.phase, "received");
  assert.equal(frames.size, 0, "completed intro leaves no idle RAF loop");
  handle.dispose();

  // Verify reduced-motion static capture resolves cleanly without mid-frame mutation.
  let reducedArrived = 0;
  const reducedRoot = { dataset: {} };
  const reducedHandle = window.SignalAsciiIntro.start(reducedRoot, {
    reducedMotion: true,
    onArrival: () => { reducedArrived++; },
  });
  for (let i = 0; i < 20 && !reducedArrived; i++) step(100);
  assert.equal(reducedArrived, 1, "reduced-motion intro completes cleanly");
  reducedHandle.dispose();
});

test("CRT intro CSS geometry matches 245x83 wide and 79x53 portrait narrow buffers and removes all legacy 3D assets", () => {
  assert.match(stationCss, /width:\s*245ch;/);
  assert.match(stationCss, /font-size:\s*min\(\.643cqi,\s*1\.038cqh,\s*7\.7px\)/);
  assert.match(stationCss, /width:\s*79ch;/);
  assert.match(stationCss, /font-size:\s*min\(1\.98cqi,\s*1\.62cqh,\s*8\.8px\)/);
  for (const [cols, rows, inlineScale, blockScale] of [[245, 83, 0.00643, 0.01038], [79, 53, 0.0198, 0.0162]]) {
    assert.ok(cols * 0.625 * inlineScale < 1, `${cols}ch fits inside CRT well`);
    assert.ok(rows * 1.14 * blockScale < 1, `${rows} rows fit inside CRT well`);
  }
  for (const removed of [
    "dist/assets",
    "dist/cosmos.js",
    "dist/cosmos-baked.js",
    "dist/flight.js",
    "dist/galaxies.js",
    "dist/observatory.js",
    "dist/seoul-terrain.js",
  ]) {
    assert.equal(fs.existsSync(removed), false, `unused 3D artifact ${removed} is removed`);
  }
});
