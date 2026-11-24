"use strict";

// Offline controller regression checks: no browser, child process, or network.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../dist/station.js"), "utf8");

function harness({ reducedMotion = false, backToMessage = false, historyState = null, quote = "  A signal\n from space.  " } = {}) {
  let document;
  let timestamp = "2026-11-21T08:09:10.123Z";
  class Element extends EventTarget {
    constructor() {
      super();
      this.hidden = false;
      this.inert = false;
      this.disabled = false;
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.children = new Map();
      this.entries = [];
      this.textContent = "";
    }
    append(...nodes) { this.entries.push(...nodes); }
    get textContent() { return this.entries.length ? this.entries.map(child => child.textContent).join("") : this.text || ""; }
    set textContent(value) { this.entries = []; this.text = value; }
    replaceChildren() { this.entries = []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelector(selector) { return this.children.get(selector) || null; }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = null; }
  }
  const ids = Object.fromEntries([
    "space", "ascii-intro-shell", "intro-skip-btn", "intro-portfolio-link",
    "terminal", "terminal-portfolio-link", "decoder", "message", "portfolio-handoff",
    "decode-progress", "decode-percent", "receiver-location", "receive-log",
    "decode-segments", "decode-step", "decode-buffer", "decode-settled",
    "decode-scrambled", "decoder-state", "spectrum-grid", "spectrum-trace",
    "spectrum-grid-narrow", "spectrum-trace-narrow", "spectrum-axis", "spectrum-axis-narrow",
  ].map(name => [name, new Element()]));
  const actions = Object.fromEntries(["decode", "replay", "skip", "portfolio"].map(name => [name, new Element()]));
  actions.portfolio.setAttribute("href", "portfolio.html");
  ids["decode-buffer"].append(ids["decode-settled"], ids["decode-scrambled"]);
  ids.decoder.children.set(".decoder-content", new Element());
  ids.message.children.set("blockquote", new Element());
  ids.message.querySelector("blockquote").textContent = quote;
  const fields = Object.fromEntries(["station-name", "receiver-name", "receiver-coordinates", "payload-bytes", "session-utc", "receive-utc"].map(key => [key, [new Element(), new Element(), new Element()]]));
  document = Object.assign(new EventTarget(), {
    body: new Element(), hidden: false, activeElement: null,
    getElementById: name => ids[name],
    createElement: () => new Element(),
    querySelectorAll: selector => fields[selector.slice(6, -1)] || [],
    querySelector: selector => actions[selector.match(/"(.*?)"/)[1]],
  });
  const starts = [];
  const window = new EventTarget();
  window.SignalAsciiIntro = {
    start(root, options) {
      const renderer = { root, options, disposed: 0, dispose() { this.disposed++; } };
      starts.push(renderer);
      return renderer;
    },
  };
  let now = 0;
  let frameId = 0;
  const frames = new Map();
  const timers = new Map();
  const navigations = [];
  const history = { state: historyState || (backToMessage ? { transmissionRead: true } : null), replaceState(state) { this.state = state; } };
  const location = { search: "", hash: "", assign(href) { navigations.push(href); } };
  vm.runInNewContext(source, {
    document, window, HTMLElement: Element, AbortController, TextEncoder,
    Date: class extends Date { constructor() { super(timestamp); } },
    location, history, performance: { now: () => now },
    setTimeout(callback, delay) { const id = ++frameId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  }, { filename: "dist/station.js" });
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  async function advance(milliseconds) {
    for (let remaining = milliseconds; remaining > 0;) {
      const step = Math.min(50, remaining);
      remaining -= step;
      now += step;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) { timers.delete(id); timer.callback(); }
      }
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
      await flush();
    }
  }
  function event(target, type, properties = {}) {
    const value = new Event(type, { cancelable: true });
    Object.assign(value, properties);
    target.dispatchEvent(value);
    return value;
  }
  function only(name) {
    for (const key of ["space", "terminal", "decoder", "message"]) {
      assert.equal(ids[key].hidden, key !== name, `${key} visibility at ${name}`);
      assert.equal(ids[key].inert, key !== name, `${key} interaction at ${name}`);
    }
  }
  return {
    ids, actions, fields, document, window, starts, frames, timers, navigations, history, flush, advance, event, only,
    setTime: value => { timestamp = value; },
    click: name => event(actions[name], "click"),
    escape: properties => event(window, "keydown", { key: "Escape", ...properties }),
    enter: properties => event(window, "keydown", { key: "Enter", ...properties }),
    stage: () => document.body.dataset.stage,
    staleFrames: () => [...frames.values()],
  };
}

async function earlyEscape() {
  const h = harness();
  assert.equal(h.stage(), "space");
  assert.equal(h.starts.length, 1, "native ASCII intro starts immediately on frame 0");
  assert.equal(h.escape({ repeat: true }).defaultPrevented, false);
  assert.equal(h.stage(), "space");
  h.ids.terminal.scrollTop = 900;
  assert.equal(h.escape().defaultPrevented, true);
  assert.equal(h.starts[0].disposed, 1, "skip disposes active ASCII intro loop");
  assert.equal(h.ids.terminal.scrollTop, 0, "skip opens at the receiver heading");
  h.only("terminal");
  assert.equal(h.document.activeElement, h.actions.decode);
}

async function consoleMetadata() {
  const h = harness();
  assert.equal(h.fields["station-name"][0].textContent, "SEL / SEOUL RX");
  assert.equal(h.fields["session-utc"][0].textContent, "2026-11-21 08:09:10 UTC");
  assert.equal(h.fields["session-utc"][0].attributes.datetime, "2026-11-21T08:09:10Z");
  assert.equal(h.fields["payload-bytes"][0].textContent, String(new TextEncoder().encode("A signal from space.").length));
  assert.equal(h.fields["receiver-coordinates"][0].textContent, "37.5665 N / 126.9780 E");
  assert.equal(h.ids["receive-log"].entries.length, 0, "no capture or decoder event before actual reception");
  h.click("skip");
  assert.equal(h.fields["receive-utc"][0].textContent, "2026-11-21 08:09:10 UTC");
  assert.equal(h.ids["receive-log"].entries.length, 3);
  assert.match(h.ids["receive-log"].entries[1].textContent, /20 bytes buffered/);
  assert.equal(h.frames.size, 0, "static capture has no animation loop");
  for (const [suffix, width] of [["", 65], ["-narrow", 37]]) {
    const grid = h.ids[`spectrum-grid${suffix}`].textContent.split("\n");
    const trace = h.ids[`spectrum-trace${suffix}`].textContent.split("\n");
    assert.equal(grid.length, 13);
    assert.ok(grid.every(row => row.length === width));
    assert.equal(trace[0][Math.floor(width / 2)], "\u2584", "carrier peak stays centered at either width");
    const capRows = [];
    for (let column = 0; column < width; column++) {
      const cap = trace.findIndex(row => row[column] === "\u2584");
      assert.ok(cap >= 0, "each sampled bin has a cap");
      capRows.push(cap);
      assert.ok(trace.slice(cap + 1).every(row => row[column] === "\u2591"), "light-shade body fills every bin below its cap");
    }
    assert.ok(capRows[Math.floor(width / 2) - 1] < capRows[Math.floor(width / 2) - 2], "carrier shoulders taper into noise floor");
    if (width === 65) assert.notDeepEqual(capRows.slice(0, 16), capRows.slice(16, 32), "captured noise does not tile a 16-bin pattern");
    const axis = h.ids[`spectrum-axis${suffix}`].textContent.split("\n")[0];
    assert.equal(axis.length, width);
    assert.equal(axis[Math.floor(width / 2)], "0", "zero label aligns under carrier");
    assert.equal(axis.slice(0, 2), "-4");
    assert.equal(axis.slice(-2), "+4");
  }
  const fullTrace = h.ids["spectrum-trace"].textContent.split("\n");
  const narrowTrace = h.ids["spectrum-trace-narrow"].textContent.split("\n");
  for (let bin = 0; bin < 37; bin++) {
    const capturedBin = Math.round((bin * 64) / 36);
    assert.equal(narrowTrace.findIndex(row => row[bin] === "\u2584"), fullTrace.findIndex(row => row[capturedBin] === "\u2584"), "phone spectrum samples the same captured shape");
  }
  h.setTime("2026-11-21T08:10:20.123Z");
  h.click("decode");
  assert.match(h.ids["receive-log"].entries[2].textContent, /Decoder started by operator/);
  assert.match(h.ids["receive-log"].entries[2].textContent, /^08:10:20 UTC/);
  assert.equal(h.fields["receive-utc"][0].textContent, "2026-11-21 08:09:10 UTC", "decode does not change capture UTC");
}

async function lifecycle(reducedMotion) {
  const h = harness({ reducedMotion });
  assert.equal(h.starts.length, 1);
  const first = h.starts[0];
  assert.equal(first.options.reducedMotion, reducedMotion);
  h.ids.terminal.scrollTop = 900;
  first.options.onArrival();
  assert.equal(h.ids.terminal.scrollTop, 0, "natural arrival starts at the receiver heading");
  assert.equal(h.stage(), "arrival");
  assert.equal(h.ids.space.hidden, false);
  assert.equal(h.ids.terminal.hidden, false);
  assert.equal(h.ids.terminal.inert, true);
  assert.equal(h.actions.decode.disabled, true);
  await h.advance(reducedMotion ? 150 : 350);
  assert.ok(Number(h.ids.terminal.style.opacity) > 0 && Number(h.ids.terminal.style.opacity) < 1);
  assert.equal(first.disposed, 0, "intro survives the crossfade");
  await h.advance(800);
  h.only("terminal");
  assert.equal(first.disposed, 1);
  assert.equal(h.document.activeElement, h.actions.decode);
  first.options.onArrival();
  assert.equal(h.stage(), "terminal", "duplicate arrival cannot restart transition");

  h.click("decode");
  h.click("decode");
  assert.equal(h.stage(), "decoding");
  await h.advance(500);
  h.only("decoder");
  assert.equal(h.document.activeElement, h.ids.decoder.querySelector(".decoder-content"));
  const previous = h.ids["decode-progress"].value;
  const previousBuffer = h.ids["decode-buffer"].textContent;
  h.document.hidden = true;
  await h.advance(5000);
  assert.equal(h.ids["decode-progress"].value, previous);
  assert.equal(h.ids["decode-buffer"].textContent, previousBuffer, "hidden time freezes glyphs as well as progress");
  h.document.hidden = false;
  for (let i = 0; h.ids["decode-progress"].value !== 100 && i < 100; i++) await h.advance(50);
  assert.equal(h.ids["decode-progress"].value, 100);
  assert.equal(h.ids["decode-buffer"].textContent, "A signal from space.");
  assert.equal(h.ids["decoder-state"].textContent, "COMPLETE");
  assert.equal(h.ids["decode-segments"].textContent, `[${"\u2588".repeat(32)}]`);
  h.document.hidden = true;
  await h.advance(5000);
  h.only("decoder");
  h.document.hidden = false;
  await h.advance(2500);
  assert.equal(h.stage(), "message");
  h.only("message");
  assert.equal(h.document.activeElement, h.ids.message.querySelector("blockquote"));
  assert.equal(h.actions.replay.disabled, false);
  assert.equal(h.frames.size, 0, "completed decoder creates no idle animation loop");
  assert.equal(h.timers.size, 0, "message waits at the reader's own pace with zero auto-open countdown");
  await h.advance(30000);
  assert.equal(h.navigations.length, 0, "message never auto-redirects while reading");

  h.ids.terminal.scrollTop = 900;
  h.click("replay");
  await h.flush();
  h.only("space");
  assert.equal(h.starts.length, 2);
  assert.equal(h.ids["decode-progress"].value, 0);
  assert.notEqual(h.ids["decode-buffer"].textContent, "A signal from space.", "replay resets decoded cells");
  first.options.onArrival();
  assert.equal(h.stage(), "space", "previous run's arrival is inert after replay");
  const second = h.starts[1];
  second.options.onArrival();
  const stale = h.staleFrames();
  h.click("skip");
  h.only("terminal");
  assert.equal(second.disposed, 1);
  for (const callback of stale) callback(100000);
  await h.flush();
  assert.equal(h.stage(), "terminal", "cancelled RAF cannot reopen arrival");
  assert.equal(h.ids.terminal.style.opacity, "1");

  h.click("decode");
  const cancelledDecode = h.staleFrames();
  h.event(h.window, "pagehide");
  for (const callback of cancelledDecode) callback(200000);
  await h.advance(10000);
  assert.equal(h.stage(), "decoding", "pagehide abort prevents later message reveal");
  assert.equal(h.frames.size, 0);
  h.event(h.window, "pageshow", { persisted: true });
  await h.flush();
  h.only("space");
  assert.equal(h.starts.length, 3, "back-forward cache restore starts one fresh run");
  h.event(h.window, "pagehide");
  assert.equal(h.starts[2].disposed, 1);
}

async function decodingBuffer(reducedMotion) {
  const quote = "Read this: a longer-word, then UTF-8 caf\u00e9!";
  const h = harness({ reducedMotion, quote: `  ${quote}\n ` });
  const buffer = h.ids["decode-buffer"];
  const nodes = buffer.entries.slice();
  const initial = buffer.textContent;
  assert.equal(initial.length, quote.length);
  assert.match(initial, /^[A-Z0-9 ]+$/, "noise adds no punctuation-based wrapping opportunities");
  assert.deepEqual([...initial].flatMap((char, index) => char === " " ? [index] : []), [...quote].flatMap((char, index) => char === " " ? [index] : []), "original spaces survive scrambling");
  assert.equal(nodes.length, 2, "buffer uses only one settled span and one scrambling span");
  h.click("skip");
  h.click("decode");
  await h.advance(reducedMotion ? 400 : 600);
  const before = buffer.textContent;
  await h.advance(50);
  const after = buffer.textContent;
  const count = Math.floor((quote.length * h.ids["decode-progress"].value) / 100);
  assert.equal(after.slice(0, count), quote.slice(0, count), "displayed percentage locks the exact prefix");
  assert.equal(h.ids["decode-settled"].textContent, quote.slice(0, count));
  assert.ok(count > 0);
  if (reducedMotion) {
    assert.equal(after.slice(count).replace(/ /g, ""), "X".repeat(quote.slice(count).replace(/ /g, "").length));
  } else {
    assert.equal(after.slice(count), before.slice(count), "scramble holds glyphs within one 100 ms bucket");
    await h.advance(50);
    const nextCount = Math.floor((quote.length * h.ids["decode-progress"].value) / 100);
    assert.notEqual(buffer.textContent.slice(nextCount), after.slice(nextCount), "unsettled glyphs alternate at 10 Hz");
  }
  assert.deepEqual(buffer.entries, nodes, "buffer spans persist throughout decoding");
  h.event(h.window, "pagehide");
  assert.equal(h.frames.size, 0, "abort also cancels scrambling");
}

async function messageNavigation() {
  const h = harness();
  h.click("skip");
  h.click("decode");
  for (let i = 0; h.actions.replay.disabled || h.stage() !== "message"; i++) {
    assert.ok(i < 200);
    await h.advance(50);
  }
  assert.equal(h.timers.size, 0, "no auto-open timer on message stage");
  // Clicking Open portfolio preserves read history for browser Back.
  h.click("portfolio");
  assert.equal(h.history.state.transmissionRead, true);
  assert.equal(h.history.state.transmissionTiming.sessionUTC, "2026-11-21 08:09:10 UTC");
  assert.equal(h.history.state.transmissionTiming.receiveUTC, "2026-11-21 08:09:10 UTC");
  // Pressing Enter while reading focused quote also opens portfolio cleanly.
  h.ids.message.querySelector("blockquote").focus();
  assert.equal(h.enter().defaultPrevented, true);
  assert.deepEqual(h.navigations, ["portfolio.html"]);
  // Browser Back restores the decoded quote directly without re-running the intro.
  const returned = harness({
    historyState: {
      transmissionRead: true,
      transmissionTiming: { sessionUTC: "2026-11-20 07:08:09 UTC", receiveUTC: "2026-11-20 07:08:12 UTC" },
    },
  });
  returned.only("message");
  assert.equal(returned.starts.length, 0, "Back returns directly to quote");
  assert.equal(returned.fields["session-utc"][0].textContent, "2026-11-20 07:08:09 UTC");
  assert.equal(returned.fields["receive-utc"][0].textContent, "2026-11-20 07:08:12 UTC");
  returned.click("replay");
  assert.equal(returned.history.state.transmissionTiming, undefined, "Replay clears stored timing");
  assert.equal(returned.history.state.transmissionRead, false);
  assert.equal(returned.fields["receive-utc"][0].textContent, "Awaiting capture");
}

test("station console markup, spectrum, escape, decode buffer, lifecycle and clean manual handoff", async () => {
  const html = fs.readFileSync(path.join(__dirname, "../dist/index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../dist/station.css"), "utf8");
  assert.equal((html.match(/data-action="decode"/g) || []).length, 1, "one native decode control");
  const heading = html.indexOf('id="terminal-title"');
  const panels = html.indexOf('class="reception-grid"', heading);
  assert.ok(heading >= 0 && panels > heading, "receiver heading precedes its panels");
  assert.match(html.slice(heading, panels), /<button\b[^>]*\bdata-action="decode"/, "Decode is reachable above the receiver panels");
  assert.match(html, /id="decode-buffer" aria-hidden="true"/, "scrambled text stays out of accessibility announcements");
  assert.match(html, /id="decode-settled"><\/span><span id="decode-scrambled"/, "no extra whitespace at the moving reveal boundary");
  assert.match(html, /<noscript>[\s\S]*portfolio\.html[\s\S]*<\/noscript>/, "no-JS visitors get a direct link to the portfolio");
  assert.match(html, /<title>Yeon Jun Kim \/\/ Transmission<\/title>/);
  assert.match(html, /viewBox='0 0 32 32'/);
  assert.match(html, /id="intro-portfolio-link"[^>]+href="portfolio\.html"/, "ASCII intro footer exposes 1-click fast-path to portfolio");
  assert.match(html, /class="message-attribution"[^>]*>OPERATOR \/\/ YEON JUN KIM/, "decoded message displays operator identity");
  assert.match(html, /class="band-mode"> \/\/ RECEIVER CONSOLE<\/span>/);
  assert.match(html, /src="ascii-intro\.js/);

  // Verify all deleted 3D & 10-second countdown artifacts are completely gone.
  assert.equal(html.includes("Preview 3D intro"), false, "Preview 3D intro link is removed");
  assert.equal(html.includes("10 seconds of reading"), false, "10-second auto-open copy is removed");
  assert.equal(html.includes("Stay and read"), false, "Stay and read button is removed");
  assert.equal(html.includes("handoff-hairline"), false, "countdown hairline is removed");
  assert.equal(html.includes("seoul-landscape-credits"), false, "3D satellite terrain credits are removed");
  assert.equal(html.includes("<canvas"), false, "unused WebGL canvas is removed");
  assert.equal(css.includes("Pixelify"), false, "opening console shares unified hardware monospace voice");
  assert.equal(css.includes("reading-progress"), false, "countdown keyframe is removed from CSS");
  assert.match(css, /width: min\(100%, 1480px\)/, "console is bounded on large monitors");
  assert.match(css, /font-size: clamp\(\.78125rem, \.92vw, \.96875rem\)/, "instrument type stays between 12.5 and 15.5px");
  const typography = fs.readFileSync(path.join(__dirname, "../dist/typography.css"), "utf8");
  assert.match(html, /href="typography\.css\?v=site-type-1"/);
  assert.ok(html.indexOf('href="typography.css') > html.indexOf('href="station.css'), "shared roles follow the console base styles");
  assert.match(typography, /\.console-heading :is\(h1, h2\),[\s\S]*?\.load-failure > h1\s*\{[^}]*font-size: var\(--type-title\)/);
  assert.match(typography, /\.station-panel legend,[\s\S]*?font-size: var\(--type-section\)/);
  assert.match(typography, /\.noscript-copy,[\s\S]*?#decode-step\s*\{[^}]*font-size: var\(--type-description\)/);
  assert.match(typography, /\.message blockquote\s*\{[^}]*font-size: var\(--type-section\)/, "quote shares the reading scale");
  assert.doesNotMatch(typography, /font-family:/, "shared sizing preserves the current quote and console faces");

  await consoleMetadata();
  await earlyEscape();
  await decodingBuffer(false);
  await decodingBuffer(true);
  await lifecycle(false);
  await lifecycle(true);
  await messageNavigation();
});
