"use strict";

// Run the shipped controller with an offline DOM, clock and animation queue.
// No browser, renderer, network connection or child process is required.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync("dist/portfolio.html", "utf8");
const css = fs.readFileSync("dist/portfolio.css", "utf8");
const typography = fs.readFileSync("dist/typography.css", "utf8");
const source = fs.readFileSync("dist/portfolio.js", "utf8");

function harness({ hash = "", search = "", reducedMotion = false, compact = false, markup = html } = {}) {
  let document;
  const elements = [];
  class Element extends EventTarget {
    constructor(tag, attributes = {}) {
      super();
      this.tagName = tag.toUpperCase();
      this.attributes = { ...attributes };
      this.id = attributes.id || "";
      this.dataset = {};
      for (const [name, value] of Object.entries(attributes)) {
        if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      }
      this.hidden = "hidden" in attributes;
      this.disabled = false;
      this.style = { setProperty(name, value) { this[name] = value; } };
      this._text = "";
      this.children = [];
      this.parentElement = null;
      const classes = new Set((attributes.class || "").split(/\s+/).filter(Boolean));
      this.classList = {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle(value, force = !classes.has(value)) { force ? classes.add(value) : classes.delete(value); return force; },
      };
    }
    get textContent() {
      return this.children.length ? this.children.map(child => typeof child === "string" ? child : child.textContent).join("") : this._text;
    }
    set textContent(value) {
      this.children = [];
      this._text = String(value);
    }
    get href() { return this.attributes.href; }
    set href(value) { this.attributes.href = value; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    get firstElementChild() { return this.children.find(child => child instanceof Element) || null; }
    remove() {
      if (!this.parentElement) return;
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
      this.parentElement = null;
    }
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) {
        this.children.splice(index, 1);
        child.parentElement = null;
      }
      return child;
    }
    append(...nodes) {
      for (const node of nodes) {
        if (node instanceof Element) node.parentElement = this;
        this.children.push(node);
      }
    }
    replaceChildren(...nodes) {
      this.children = [];
      this._text = "";
      if (nodes.length === 1 && typeof nodes[0] === "string") {
        this._text = nodes[0];
      } else {
        this.append(...nodes);
      }
    }
    isDescendantOf(ancestor) {
      let current = this.parentElement;
      while (current) {
        if (current === ancestor) return true;
        current = current.parentElement;
      }
      return false;
    }
    querySelector(selector) {
      return elements.find(element => element !== this && element.matches(selector) && element.isDescendantOf(this)) || null;
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 600 }; }
    matches(selector) {
      if (selector.startsWith("#")) return this.id === selector.slice(1);
      if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
      const attr = selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
      if (attr) return attr[2] === undefined ? attr[1] in this.attributes : this.getAttribute(attr[1]) === attr[2];
      return this.tagName.toLowerCase() === selector;
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  }
  const ancestors = [];
  const decode = text => text.replace(/&(?:rsquo|mdash|middot|deg|gt|lt|amp);/g, entity => ({
    '&rsquo;': "'", '&mdash;': '\u2014', '&middot;': '\u00b7', '&deg;': '\u00b0', '&gt;': '>', '&lt;': '<', '&amp;': '&',
  })[entity]).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
  for (const [token, closing, tag, raw = "", text] of markup.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9-]*)(\s[^>]*?)?>|([^<]+)/gi)) {
    if (token.startsWith('<!--')) continue;
    if (text !== undefined) {
      ancestors.at(-1)?.append(decode(text));
      continue;
    }
    if (closing) {
      if (ancestors.at(-1)?.tagName === tag.toUpperCase()) ancestors.pop();
      continue;
    }
    const attributes = Object.fromEntries([...raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value ?? ""]));
    const element = new Element(tag, attributes);
    ancestors.at(-1)?.append(element);
    elements.push(element);
    if (!token.endsWith("/>") && !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag)) ancestors.push(element);
  }
  const select = selector => elements.filter(element => selector.split(",").some(part => element.matches(part.trim())));
  document = Object.assign(new EventTarget(), {
    hidden: false, activeElement: null, body: elements.find(element => element.tagName === "BODY"),
    documentElement: elements.find(element => element.tagName === "HTML"),
    getElementById: id => elements.find(element => element.id === id) || null,
    querySelector: selector => select(selector)[0] || null,
    querySelectorAll: select,
    createElement: tag => new Element(tag),
  });
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const window = new EventTarget();
  let currentHash = hash;
  const hashWrites = [];
  const historyWrites = [];
  const location = {
    get hash() { return currentHash; },
    set hash(value) { hashWrites.push(value); currentHash = value && !value.startsWith("#") ? `#${value}` : value; },
    search, href: `https://example.test/portfolio.html${search}${hash}`,
  };
  const history = { replaceState(_state, _title, value) { historyWrites.push(value); location.hash = value.startsWith("#") ? value : ""; } };
  const media = Object.assign(new EventTarget(), { matches: reducedMotion });
  const compactMedia = Object.assign(new EventTarget(), { matches: compact });
  window.matchMedia = query => query.includes('prefers-reduced-motion') ? media : compactMedia;
  vm.runInNewContext(source, {
    document, window, location, history, URL, URLSearchParams, HTMLElement: Element, Date,
    performance: { now: () => now }, matchMedia: window.matchMedia,
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  }, { filename: "dist/portfolio.js" });
  function event(target, type, properties = {}) {
    const ev = new Event(type, { cancelable: true, bubbles: true });
    Object.assign(ev, properties);
    target.dispatchEvent(ev);
    if (elements.includes(target)) document.dispatchEvent(ev);
    return ev;
  }
  return {
    document, window, location, elements, frames, select, event, media, hashWrites, historyWrites,
    id: id => document.getElementById(id),
    click: element => event(element, "click"),
    route(value) { location.hash = value; event(window, "hashchange"); },
    frame(milliseconds = 100) {
      now += milliseconds;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(now));
    },
    visibility(hidden) { document.hidden = hidden; event(document, "visibilitychange"); },
  };
}

test("four named stars and navigation index retain native destinations and populated records", () => {
  const h = harness();
  const names = ["projects", "research", "about", "contact"];
  const starLinks = h.select(".star-link");
  const navLinks = h.select(".index-link");
  assert.equal(starLinks.length, 4);
  assert.equal(navLinks.length, 4);
  assert.deepEqual(starLinks.map(link => link.dataset.contact), names);
  assert.deepEqual(navLinks.map(link => link.dataset.nav), names);
  for (const link of [...starLinks, ...navLinks]) {
    const key = link.dataset.contact || link.dataset.nav;
    assert.equal(link.tagName, "A");
    assert.equal(link.getAttribute("href"), `#${key}`);
    assert.equal(h.click(link).defaultPrevented, false, "native fragment activation works for pointer and touch");
  }
  assert.equal(h.select(".destination").length, 4);
  assert.equal(h.select(".back-link").length, 4);
  for (const name of names) assert.equal(h.id(name).getAttribute("tabindex"), "-1");
  for (const name of names) {
    const summary = h.id(name).querySelector('.record-body').textContent.trim();
    const maxLength = name === 'about' ? 300 : 200;
    assert.ok(summary.length > 0 && summary.length < maxLength, `${name} has a nonempty concise preview`);
    h.route(`#${name}`);
    assert.equal(h.id('inspector-summary').textContent, summary);
  }
  for (const stale of ['will appear here', 'RECORD BUFFER READY', 'Contact details have not been added', 'CV / RESUME']) {
    assert.equal(html.includes(stale), false, `no stale template copy: ${stale}`);
  }
  assert.match(css, /\.destination:target\s*\{\s*display:\s*block/);
  assert.match(css, /\.primary-pane:has\(\.destination:target\) \.chart-panel\s*\{\s*display:\s*none/);
});

test("pure character-cell TUI starmap workstation matches receiving console palette with zero hologram graphics", () => {
  const h = harness();
  const chart = h.select('.chart-panel')[0];
  assert.equal(h.select("img").filter(image => image.isDescendantOf(chart)).length, 0, "no raster or SVG hologram images in star chart");
  assert.equal(h.select("svg").filter(image => image.isDescendantOf(chart)).length, 0, "no smooth vector globe or SVG scan overlays in star chart");
  assert.ok(!html.includes("holo-projection.svg") && !css.includes("holo-projection.svg"));
  assert.ok(!html.includes("portfolio-atlas.svg") && !css.includes("portfolio-atlas.svg"));
  assert.ok(!html.includes(">?</"), "glyphs are not corrupted during Windows writes");

  // No orphaned assets remain in dist/assets/.
  for (const orphan of ["dish.webp", "holo-projection.svg", "portfolio-atlas.svg", "space-grotesk.ttf", "space-grotesk-license.txt"]) {
    assert.equal(fs.existsSync(`dist/assets/${orphan}`), false, `orphaned asset ${orphan} is removed`);
  }
  assert.match(html, /<noscript>[\s\S]*Navigation Index[\s\S]*<\/noscript>/, "no-JS users get guidance on chart viewport");
  assert.match(h.select("[data-session-utc]")[0].textContent, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/, "session UTC matches receiving console date+time format");
  assert.equal(h.id("sweep-toggle").getAttribute("aria-keyshortcuts"), "H");
  for (const [index, link] of h.select(".star-link").entries()) {
    assert.equal(link.getAttribute("aria-keyshortcuts"), String(index + 1));
  }
  for (const [index, link] of h.select(".index-link").entries()) {
    assert.equal(link.getAttribute("aria-keyshortcuts"), String(index + 1));
  }
  for (const link of h.select(".back-link")) {
    assert.equal(link.getAttribute("aria-keyshortcuts"), "Escape");
  }

  // Palette continuity with dist/station.css plus multi-color astronomical phosphor accents.
  for (const token of ["#141716", "#e3b871", "#9bb5a6", "#deddd2", "#53594f", "--nebula-cool", "--nebula-warm", "--star-cool", "--star-warm", "--fx-phosphor"]) {
    assert.ok(css.includes(token), `console palette token ${token} is preserved`);
  }

  // Dense multi-pane TUI workstation landmarks & portfolio template identity/quick-links.
  for (const selector of [".console-band", ".workstation-grid", ".chart-panel", ".index-panel", ".inspector-panel", ".operator-links", ".log-panel", ".console-footer", "nav"]) {
    assert.ok(h.select(selector).length >= 1, `workstation includes ${selector}`);
  }
  assert.match(html, /id="chart-title">Yeon Jun Kim &mdash; Portfolio<\/h1>/, "portfolio header displays owner name");
  assert.match(html, /class="sector-tag">STUDENT/, "sector tag displays current role");
  assert.equal(h.id("operator-links").children.length, h.select("[data-contact-channel]").filter(link => link.getAttribute("href")).length, "inspector mirrors configured contact channels");

  // Rectangular high-res character-cell buffers for wide (121x41) and narrow (57x25) charts.
  for (const [suffix, cols, rows] of [["", 121, 41], ["-narrow", 57, 25]]) {
    for (const prefix of ["map-grid", "map-nebula-cool", "map-nebula-warm", "map-stars", "map-stars-warm", "map-vectors", "map-fx", "map-reticle"]) {
      const lines = h.id(`${prefix}${suffix}`).textContent.split("\n");
      assert.equal(lines.length, rows, `${prefix}${suffix} has ${rows} character rows`);
      assert.ok(lines.every(line => line.length === cols), `${prefix}${suffix} rows are uniformly ${cols} columns`);
    }
    const gridText = h.id(`map-grid${suffix}`).textContent;
    assert.ok(gridText.startsWith("\u250c") && gridText.endsWith("\u2518"), `box-drawing perimeter on map-grid${suffix}`);
    assert.ok(gridText.includes("\u253c"), `coordinate graticule intersections on map-grid${suffix}`);
    assert.ok(/[\u00b7:\u2591\u2592]/.test(h.id(`map-nebula-cool${suffix}`).textContent), `cool nebula clouds on map-nebula-cool${suffix}`);
    assert.ok(/[\u00b7:\u2591\u2592]/.test(h.id(`map-nebula-warm${suffix}`).textContent), `warm H-II nebula knots on map-nebula-warm${suffix}`);
    assert.ok(/[\u00b7.,+*\u00b0]/.test(h.id(`map-stars${suffix}`).textContent), `cool spectral starfield populated on map-stars${suffix}`);
    assert.ok(/[\u00b7.,+*\u00b0]/.test(h.id(`map-stars-warm${suffix}`).textContent), `warm spectral starfield populated on map-stars-warm${suffix}`);
    assert.ok(/[\u2500\u2502\u2571\u2572\u00b7]/.test(h.id(`map-vectors${suffix}`).textContent), `constellation routes on map-vectors${suffix}`);
  }
});

test("reticle lock, target inspector telemetry and telemetry log track hover, focus and route state", () => {
  const h = harness();
  assert.equal(h.id("insp-target").textContent, "SECTOR 04 / STANDBY");
  assert.equal(h.id("insp-status").textContent, "AWAITING LOCK");
  assert.equal(h.id("telemetry-log").children.length, 3);
  assert.equal(h.id("map-reticle").textContent.trim(), "", "idle chart has no amber reticle or primary lock");

  // Touch pointerenter must not stick hover previews on mobile devices.
  const researchNav = h.select(".index-link")[1];
  const researchStar = h.select(".star-link")[1];
  h.event(researchNav, "pointerenter", { pointerType: "touch" });
  assert.equal(h.id("insp-target").textContent, "SECTOR 04 / STANDBY");
  assert.equal(researchStar.classList.contains("is-preview"), false);

  // Mouse hovering a side-index link previews it on the chart and inspector without locking route.
  h.id("research").querySelector(".record-body").textContent = "Research summary for the inspector.";
  h.event(researchNav, "pointerenter", { pointerType: "mouse" });
  assert.equal(h.id("insp-target").textContent, "HD-02 / RESEARCH");
  assert.equal(h.id("insp-status").textContent, "TRACKING TARGET");
  assert.equal(h.id("inspector-summary").textContent, "Research summary for the inspector.");
  assert.ok(h.id("insp-status").classList.contains("signal-state"));
  assert.equal(researchStar.classList.contains("is-preview"), true);
  assert.ok(h.id("map-reticle").textContent.includes("v") && h.id("map-reticle").textContent.includes(">"), "vernier crosshair tracks hovered target");

  h.event(researchNav, "pointerleave", { pointerType: "mouse" });
  assert.equal(h.id("insp-target").textContent, "SECTOR 04 / STANDBY");
  assert.equal(researchStar.classList.contains("is-preview"), false);

  // Locking a route updates inspector status, active record flag, reticle and appends incrementally to telemetry log.
  const existingThirdItem = h.id("telemetry-log").children[2];
  h.route("#research");
  assert.equal(h.id("insp-target").textContent, "HD-02 / RESEARCH");
  assert.equal(h.id("insp-status").textContent, "SIGNAL LOCKED");
  assert.equal(h.id("inspector-prompt").textContent, "> RECORD OPEN // ESC RETURNS TO CHART");
  assert.equal(h.id("map").classList.contains("has-lock"), true);
  assert.equal(h.id("telemetry-log").children[2], existingThirdItem, "appendLog preserves existing <li> nodes so aria-live announces only new events");
  assert.match(h.id("telemetry-log").children.at(-1).textContent, /LOCK ACQUIRED -> RESEARCH \[HD-02\]/);

  // Returning to chart releases lock and caps telemetry log at 4 entries by removing only the oldest item.
  const acquiredItem = h.id("telemetry-log").children[3];
  h.route("#map");
  assert.equal(h.id("insp-status").textContent, "AWAITING LOCK");
  assert.equal(h.id("inspector-prompt").textContent, "> SELECT BEACON OR INDEX [1-4]");
  assert.equal(h.id("telemetry-log").children.length, 4);
  assert.equal(h.id("telemetry-log").children[2], acquiredItem, "oldest entry is evicted without recreating surviving nodes");
  assert.match(h.id("telemetry-log").children.at(-1).textContent, /LOCK RELEASED -> CHART STANDBY/);
});

test("native hashes and Back routes sync chart + index aria-current and restore originating focus", () => {
  const h = harness();
  const starLinks = h.select(".star-link");
  const navLinks = h.select(".index-link");
  for (const name of ["projects", "research", "about", "contact"]) {
    h.route(`#${name}`);
    assert.equal(h.document.activeElement, h.id(name));
    for (const link of starLinks) assert.equal(link.getAttribute("aria-current"), link.dataset.contact === name ? "page" : null);
    for (const link of navLinks) assert.equal(link.getAttribute("aria-current"), link.dataset.nav === name ? "page" : null);
    assert.match(h.document.title.toLowerCase(), new RegExp(name));
    h.route("#map");
    assert.equal(h.document.activeElement, starLinks.find(link => link.dataset.contact === name));
    assert.ok(starLinks.every(link => link.getAttribute("aria-current") === null));
    assert.ok(navLinks.every(link => link.getAttribute("aria-current") === null));
  }
  // Navigating via the side index restores focus back to that side-index item on close.
  h.click(navLinks[2]);
  h.route("#about");
  h.route("#map");
  assert.equal(h.document.activeElement, navLinks[2], "closing a section opened from side index restores focus to that index item");

  h.route("#research");
  h.route("");
  assert.equal(h.document.activeElement, starLinks[1], "browser Back to fragment-free map returns focus");
  const direct = harness({ hash: "#contact" });
  direct.route("#map");
  assert.equal(direct.document.activeElement, direct.select(".star-link")[3], "closing a direct link also returns focus");
});

test("arrow navigation wraps stars and side index, 1-4 jumps directly, and native shortcuts remain intact", () => {
  const h = harness();
  const links = h.select(".star-link");
  const navLinks = h.select(".index-link");
  links[0].focus();
  assert.equal(h.event(links[0], "keydown", { key: "ArrowRight" }).defaultPrevented, true);
  assert.equal(h.document.activeElement, links[1]);
  links[0].focus();
  h.event(links[0], "keydown", { key: "ArrowLeft" });
  assert.equal(h.document.activeElement, links[3]);
  links[3].focus();
  h.event(links[3], "keydown", { key: "ArrowDown" });
  assert.equal(h.document.activeElement, links[0]);
  assert.equal(h.event(links[0], "keydown", { key: "Enter" }).defaultPrevented, false);

  // Arrow cycling inside the side navigation index stays within the index pool.
  navLinks[0].focus();
  assert.equal(h.event(navLinks[0], "keydown", { key: "ArrowDown" }).defaultPrevented, true);
  assert.equal(h.document.activeElement, navLinks[1]);
  h.event(navLinks[1], "keydown", { key: "ArrowUp" });
  assert.equal(h.document.activeElement, navLinks[0]);
  h.event(navLinks[0], "keydown", { key: "ArrowUp" });
  assert.equal(h.document.activeElement, navLinks[3]);

  // Number keys 1-4 jump directly to the corresponding destination fragment.
  for (const [key, expected] of [["1", "#projects"], ["2", "#research"], ["3", "#about"], ["4", "#contact"]]) {
    assert.equal(h.event(h.document.body, "keydown", { key }).defaultPrevented, true);
    assert.equal(h.location.hash, expected);
  }

  links[0].focus();
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    assert.equal(h.event(links[0], "keydown", { key: "ArrowRight", [modifier]: true }).defaultPrevented, false);
    assert.equal(h.document.activeElement, links[0]);
  }
});

test("Escape closes records from content, close links and scan controls", () => {
  const h = harness();
  const returns = h.select(".back-link");
  const links = h.select(".star-link");
  for (const [index, name] of ["projects", "research", "about", "contact"].entries()) {
    for (const control of [h.id(name), returns[index], h.id("sweep-toggle")]) {
      h.route(`#${name}`);
      control.focus();
      assert.equal(h.event(control, "keydown", { key: "Escape" }).defaultPrevented, true);
      assert.equal(h.location.hash, "#map");
      h.event(h.window, "hashchange");
      assert.equal(h.document.activeElement, links[index]);
    }
    assert.equal(returns[index].getAttribute("href"), "#map");
    assert.equal(h.click(returns[index]).defaultPrevented, false);
  }
});

test("editable controls retain native keyboard handling", () => {
  const h = harness({ hash: "#research" });
  for (const control of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) {
    h.document.activeElement = control;
    for (const key of ["Escape", "ArrowDown", "h", "1", "4"]) {
      assert.equal(h.event(h.document, "keydown", { key }).defaultPrevented, false);
      assert.equal(h.document.activeElement, control);
      assert.equal(h.location.hash, "#research");
      assert.equal(h.select(".star-chart")[0].dataset.sweep, "running");
    }
  }
});

test("scan hold, hidden pages, reduced motion and bfcache preserve operator state", () => {
  const h = harness();
  const chart = h.id("map");
  const toggle = h.id("sweep-toggle");
  const scanState = h.id("scan-state");
  assert.equal(chart.dataset.sweep, "running");
  assert.equal(scanState.textContent, "SCAN RUNNING");
  assert.equal(h.frames.size, 1, "animated ASCII FX loop runs while chart is visible and active");
  const fxStart = h.id("map-fx").textContent;
  h.frame(200);
  h.frame(200);
  h.frame(200);
  assert.notEqual(h.id("map-fx").textContent, fxStart, "animated ASCII FX updates star twinkle, scan echo and spine packets");
  h.document.body.focus();
  assert.equal(h.event(h.document, "keydown", { key: "h" }).defaultPrevented, true);
  assert.equal(chart.dataset.sweep, "held");
  assert.equal(h.frames.size, 0, "holding scan cancels the FX animation frame");
  assert.equal(scanState.textContent, "SCAN HELD");
  assert.equal(toggle.getAttribute("aria-label"), "Resume scan");
  assert.equal(toggle.querySelector(".btn-glyph").textContent, "\u25b7");
  assert.equal(toggle.querySelector(".btn-label").textContent, "RESUME SCAN");
  h.event(h.document, "keydown", { key: "h", repeat: true });
  assert.equal(chart.dataset.sweep, "held");
  h.visibility(true);
  assert.equal(chart.dataset.sweep, "hidden");
  assert.equal(scanState.textContent, "SCAN PAUSED");
  h.visibility(false);
  assert.equal(chart.dataset.sweep, "held");
  h.click(toggle);
  assert.equal(chart.dataset.sweep, "running");
  assert.equal(h.frames.size, 1, "resuming scan restarts the FX loop");
  assert.equal(scanState.textContent, "SCAN RUNNING");
  assert.equal(toggle.getAttribute("aria-label"), "Hold scan");
  assert.equal(toggle.querySelector(".btn-glyph").textContent, "\u2161");
  assert.equal(toggle.querySelector(".btn-label").textContent, "HOLD SCAN");
  h.route("#projects");
  assert.equal(h.frames.size, 0, "opening a dossier pauses chart FX while the chart is hidden");
  h.route("#map");
  assert.equal(h.frames.size, 1, "returning to the chart resumes FX");
  h.event(h.window, "pagehide");
  assert.equal(chart.dataset.sweep, "hidden");
  assert.equal(h.frames.size, 0, "pagehide cancels active FX frame");
  h.event(h.window, "pageshow", { persisted: true });
  assert.equal(chart.dataset.sweep, "running");
  assert.equal(h.frames.size, 1, "bfcache pageshow resumes FX");
  h.media.matches = true;
  h.event(h.media, "change");
  assert.equal(chart.dataset.sweep, "reduced");
  assert.equal(h.frames.size, 0, "reduced motion cancels FX loop and leaves static stars");
  assert.equal(scanState.textContent, "SCAN STATIC");
  assert.equal(toggle.disabled, true);
  h.media.matches = false;
  h.event(h.media, "change");
  assert.equal(chart.dataset.sweep, "running");
  const reduced = harness({ reducedMotion: true });
  assert.equal(reduced.id("map").dataset.sweep, "reduced");
  assert.equal(reduced.id("sweep-toggle").disabled, true);
  assert.equal(reduced.frames.size, 0, "reduced motion never schedules an animation loop");
});

test("single-clock terminal scan aligns verniers, compact probe and beacon pings with zero full-height radar curtain", () => {
  const h = harness();
  assert.equal(h.select(".scan-pass").length, 0, "no detached CSS full-height radar curtain");
  assert.equal(css.includes("@keyframes acquisition"), false, "scan motion uses one synced character-cell clock");
  for (const link of h.select(".star-link")) {
    const style = link.getAttribute("style");
    assert.match(style, /--x:[\d.]+%;--y:[\d.]+%/);
    assert.match(style, /--x-narrow:[\d.]+%;--y-narrow:[\d.]+%/, `${link.dataset.contact} defines narrow grid coordinates`);
  }
  // Advance to crossing Work (col 21) and verify top v, bottom ^, and beacon ping share one column.
  for (let i = 0; i < 40; i++) h.frame(80); // 3.2s -> col 21 (Work)
  const fxWork = h.id("map-fx").textContent.split("\n");
  const workCol = fxWork[0].indexOf("v");
  assert.ok(workCol >= 1 && workCol === fxWork[fxWork.length - 1].indexOf("^"), "top and bottom verniers align on exact same column");
  const workLink = h.select(".star-link")[0];
  assert.equal(workLink.classList.contains("is-pinged"), true, "beacon echo triggers synchronously at scanCol crossing");

  // Sample the floating cross-probe along all 3 constellation segments:
  // Projects (21,9) -> Research (44,26) descends, Research -> About (83,15) rises, About -> Contact (101,33) descends.
  const sampleProbeRow = () => {
    const rows = h.id("map-fx").textContent.split("\n");
    const col = rows[0].indexOf("v");
    assert.equal(col, rows[rows.length - 1].indexOf("^"), "verniers remain locked together");
    const verticalMarks = rows.slice(1, -1).filter(row => /[\u2502\u2506\u253c\u00b7]/.test(row[col])).length;
    assert.ok(verticalMarks >= 5 && verticalMarks <= 14, `terminal scan probe is compact (${verticalMarks} interior rows)`);
    return { col, row: rows.findIndex(row => row[col] === "\u253c") };
  };
  for (let i = 0; i < 20; i++) h.frame(80); // 4.8s -> midpoint Projects -> Research (col ~32)
  assert.equal(workLink.classList.contains("is-pinged"), false, "beacon echo clears after scan passes");
  const seg1 = sampleProbeRow();
  for (let i = 0; i < 38; i++) h.frame(80); // ~7.8s -> near Research -> About climb (col ~52)
  const seg2Early = sampleProbeRow();
  for (let i = 0; i < 30; i++) h.frame(80); // ~10.2s -> closer to About (col ~68)
  const seg2Late = sampleProbeRow();
  for (let i = 0; i < 45; i++) h.frame(80); // ~13.8s -> midpoint About -> Contact (col ~92)
  const seg3 = sampleProbeRow();
  assert.ok(seg1.row >= 14 && seg1.row <= 21, `Projects->Research segment tracks route (col=${seg1.col}, row=${seg1.row})`);
  assert.ok(seg2Late.row < seg2Early.row, `Research->About segment rises upward (${seg2Early.row} -> ${seg2Late.row})`);
  assert.ok(seg3.row > seg2Late.row, `About->Contact segment descends again (${seg2Late.row} -> ${seg3.row})`);

  assert.match(css, /\.star-link\.is-pinged \.star-core::after/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /--core:\s*2\.15em;/, "star core scales fluidly with em rather than fixed px");
  assert.match(css, /overflow-x:\s*auto;/, "chart viewport keeps fallback horizontal scroll safety");
  assert.match(css, /\.inspector-panel\s*\{\s*order:\s*-1;\s*\}/, "mobile stacks target inspector directly beneath the star chart");
  assert.match(css, /background:\s*var\(--signal\)/, "active/focused targets use reverse-video phosphor amber");
  assert.match(css, /@media \(max-width: 700px\)/, "narrow layout switches to compact 57ch grid");
  assert.match(css, /\.chart-screen\s*\{\s*width:\s*57ch;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("replay returns cleanly to index.html and displays SEL / SEOUL RX callsign", () => {
  const h = harness({ search: "?unknown=discard" });
  const replay = h.select(".replay")[0];
  const target = new URL(replay.href, h.location.href);
  assert.equal(target.pathname.split("/").pop() + target.search, "index.html");
  assert.equal(h.click(replay).defaultPrevented, false);
  assert.equal(h.select("[data-station-name]")[0].textContent, "SEL / SEOUL RX");
});

test("dossiers replace the chart in the primary pane and keep native scrolling/focus routes", () => {
  const h = harness({ hash: "#research" });
  const pane = h.select(".primary-pane")[0];
  const dossier = h.select(".dossier-panel")[0];
  const inspector = h.select(".inspector-panel")[0];
  for (const section of h.select(".destination")) {
    assert.equal(section.parentElement, dossier);
    assert.equal(section.isDescendantOf(pane), true);
    assert.equal(section.isDescendantOf(inspector), false);
  }
  assert.equal(h.select(".index-link")[1].getAttribute("aria-current"), "page");
  assert.match(css, /\.primary-pane:has\(\.destination:target\) \.dossier-panel\s*\{\s*display:\s*block/);
  assert.match(css, /\.dossier-panel\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;[^}]*overscroll-behavior:\s*contain/s);
  assert.match(css, /max-width:\s*70ch/);
  assert.equal((html.match(/\[ESC\] Return to star chart/g) || []).length, 4);
  for (const hook of [".project-card", ".tag-list", ".link-row", ".timeline"]) assert.ok(css.includes(hook));
  assert.match(css, /\.destination :is\(img, video, iframe, svg\)[^}]*max-width:\s*100%/);
  h.id("research").focus();
  for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) {
    assert.equal(h.event(h.id("research"), "keydown", { key }).defaultPrevented, false, "dossier reading keeps native arrows");
    assert.equal(h.document.activeElement, h.id("research"));
  }
  h.document.body.focus();
  h.event(h.document.body, "keydown", { key: "ArrowDown" });
  assert.equal(h.document.activeElement.classList.contains("index-link"), true, "dossier shortcut fallback never focuses a hidden star");
  const compact = harness({ compact: true });
  compact.route("#projects");
  assert.equal(compact.id("projects").focusOptions.preventScroll, false, "compact routes scroll destination into view");
  compact.route("#map");
  assert.equal(compact.select(".star-link")[0].focusOptions.preventScroll, false, "compact return restores a visible chart target");
  h.route("#projects");
  assert.equal(h.id("projects").focusOptions.preventScroll, true, "desktop dossier focus stays inside bounded shell");
});

test("pointer and keyboard tracking are independent and both chart/index expose three states", () => {
  const h = harness();
  const star = h.select(".star-link")[1];
  const nav = h.select(".index-link")[1];
  assert.equal(h.id("map-reticle").textContent.trim(), "");
  h.event(star, "pointerenter", { pointerType: "mouse" });
  h.event(star, "pointerdown", { pointerType: "mouse" });
  h.event(star, "focus");
  h.event(star, "pointerleave", { pointerType: "mouse" });
  assert.equal(star.classList.contains("is-preview"), false, "mouse-retained focus cannot stick tracking");
  assert.equal(nav.classList.contains("is-preview"), false);
  assert.equal(h.id("map-reticle").textContent.trim(), "");
  h.event(h.document, "keydown", { key: "Tab" });
  h.event(nav, "focus");
  assert.equal(star.classList.contains("is-preview"), true);
  assert.equal(nav.classList.contains("is-preview"), true);
  assert.equal(h.id("insp-status").textContent, "TRACKING TARGET");
  assert.equal(h.id("map").classList.contains("has-tracking"), true);
  h.route("#research");
  assert.equal(h.id("insp-status").textContent, "SIGNAL LOCKED");
  assert.equal(star.classList.contains("is-preview"), false, "route lock clears stale preview channels");
  assert.equal(star.getAttribute("aria-current"), "page");
  assert.equal(nav.getAttribute("aria-current"), "page");
  assert.match(css, /\.star-link\.is-preview \.star-tag\s*\{[^}]*border-color:\s*var\(--signal\);[^}]*color:\s*var\(--signal\)/);
  assert.match(css, /\.index-link\.is-preview\s*\{[^}]*border-color:\s*var\(--signal\);[^}]*color:\s*var\(--signal\)/);
  assert.match(css, /\.star-link\[aria-current=page\] \.star-tag\s*\{\s*background:\s*var\(--signal\)/);
  assert.equal(css.includes('.star-link[data-contact=projects] .star-tag'), false, "Work has no idle amber override");
  assert.match(html, /data-contact="projects"[^>]*><span class="star-core" aria-hidden="true">&#9672;/);
  assert.equal((html.match(/class="star-core" aria-hidden="true">\*/g) || []).length, 3);
});

test("wide and narrow catalog, fallback anchors, clearances, reticles and sweep echoes use one coordinate geometry", () => {
  const h = harness();
  const catalogSource = source.slice(source.indexOf('const CATALOG'), source.indexOf('const catalogById'));
  const entries = [...catalogSource.matchAll(/id: '([^']+)'[\s\S]*?wide: \{ col: (\d+), row: (\d+) \}, narrow: \{ col: (\d+), row: (\d+) \}/g)];
  assert.equal(entries.length, 4);
  for (const [, id, wx, wy, nx, ny] of entries) {
    const anchor = h.select('.star-link').find(link => link.dataset.contact === id);
    const style = anchor.getAttribute('style');
    const property = name => Number(style.match(new RegExp(`--${name}:([\\d.]+)`))[1]);
    for (const [suffix, x, y, cols, rows] of [['', +wx, +wy, 121, 41], ['-narrow', +nx, +ny, 57, 25]]) {
      assert.ok(Math.abs(property(`x${suffix}`) - (x + .5) / cols * 100) < .00001, `${id}${suffix} fallback x matches cell center`);
      assert.ok(Math.abs(property(`y${suffix}`) - (y + .5) / rows * 100) < .00001, `${id}${suffix} fallback y matches cell center`);
      for (const layer of ['map-nebula-cool', 'map-nebula-warm', 'map-stars', 'map-stars-warm', 'map-vectors']) {
        const buffer = h.id(layer + suffix).textContent.split('\n');
        for (let r = y - 1; r <= y + 1; r++) for (let c = x - 2; c <= x + 2; c++) {
          assert.equal(buffer[r][c], ' ', `${layer}${suffix} clears ${id}'s beacon cell`);
        }
      }
    }
    h.event(anchor, 'pointerenter', { pointerType: 'mouse' });
    for (const [suffix, x, y] of [['', +wx, +wy], ['-narrow', +nx, +ny]]) {
      const reticle = h.id('map-reticle' + suffix).textContent.split('\n');
      assert.equal(reticle[0][x], 'v');
      assert.equal(reticle[y][0], '>');
      assert.equal(reticle[y - 1][x - 2], '\u250c');
    }
    h.event(anchor, 'pointerleave', { pointerType: 'mouse' });
  }
  const routes = source.slice(source.indexOf('const ROUTES'), source.indexOf('const WAYPOINTS_WIDE'));
  const edges = [...routes.matchAll(/\['([^']+)', '([^']+)', false\]/g)].map(match => match.slice(1));
  assert.deepEqual(edges, [['projects', 'research'], ['research', 'about'], ['about', 'contact']], 'open four-beacon spine connects 01 -> 02 -> 03 -> 04 in order');
  const connected = new Set([edges[0][0]]);
  for (let pass = 0; pass < 4; pass++) for (const [a, b] of edges) if (connected.has(a) || connected.has(b)) { connected.add(a); connected.add(b); }
  assert.equal(connected.size, 4, 'open spine connects all four beacons without a closed loop');
  assert.match(source, /drawLine\(grid, root\.col, root\.row, wp\.col, wp\.row, spec, true\)/, 'survey branches are sparse');
  assert.equal(h.select('.crt-scanlines')[0].parentElement, h.select('.chart-viewport')[0], 'scanlines cover whole well');
});

test("desktop shell bounds, fieldset minimum resets and character-buffer fit prevent viewport spill and 4K inflation", () => {
  assert.match(css, /--console-type:\s*clamp\(12\.5px,\s*\.92vw,\s*15\.5px\)/);
  assert.match(css, /width:\s*min\(100%,\s*1480px\)/);
  assert.match(css, /height:\s*min\(860px,\s*calc\(100svh - 32px\)\)/);
  assert.match(css, /grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.station-panel\s*\{\s*min-width:\s*0;\s*min-height:\s*0/);
  assert.match(css, /\.primary-pane\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);[^}]*min-height:\s*0/);
  assert.match(css, /\.chart-viewport\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;[^}]*container-type:\s*size/s);
  assert.match(css, /font-size:\s*min\(1\.29cqi,\s*2\.02cqh,\s*13\.5px\)/);
  assert.match(css, /font-size:\s*min\(2\.74cqi,\s*3\.32cqh,\s*13px\)/);
  // Conservative monospace width envelope: every named fallback font's cell is
  // below .625em. These inequalities prove both buffers fit their query box.
  for (const [cols, rows, inlineScale, blockScale] of [[121, 41, .0129, .0202], [57, 25, .0274, .0332]]) {
    assert.ok(cols * .625 * inlineScale < 1, 'inline buffer stays inside well');
    assert.ok(rows * 1.18 * blockScale < 1, 'block buffer stays inside well');
  }
  for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080], [2560, 1440], [3840, 2160]]) {
    const density = Math.min(15.5, Math.max(12.5, width * .0092));
    const shellWidth = Math.min(width - 32, 1480);
    const shellHeight = Math.min(height - 32, 860);
    assert.ok(shellWidth + 32 <= width && shellHeight + 32 <= height);
    assert.ok(density <= 15.5);
  }
  assert.match(css, /@media \(max-width: 900px\), \(max-height: 599px\)/);
  assert.match(css, /\.console-shell\s*\{\s*height:\s*auto;/, 'short and zoomed windows regain document flow');
  assert.match(css, /animation:\s*console-enter 240ms/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.console-shell\s*\{\s*animation:\s*none/);
  assert.equal(css.includes('font-family: Pixelify'), false, 'station verse face does not leak into chart headings');
});


test("latest intentional keyboard or pointer input wins without pointerleave", () => {
  const h = harness();
  const [work, research] = h.select('.star-link');
  h.event(work, 'pointerenter', { pointerType: 'mouse' });
  assert.equal(h.id('insp-target').textContent, 'HD-01 / PROJECTS');
  h.event(h.document, 'keydown', { key: 'Tab' });
  h.event(research, 'focus');
  assert.equal(h.id('insp-target').textContent, 'HD-02 / RESEARCH');
  assert.equal(work.classList.contains('is-preview'), false);
  assert.equal(research.classList.contains('is-preview'), true);
  h.event(work, 'pointermove', { pointerType: 'mouse' });
  assert.equal(h.id('insp-target').textContent, 'HD-01 / PROJECTS');
  assert.equal(work.classList.contains('is-preview'), true);
  assert.equal(research.classList.contains('is-preview'), false);
});

// Fixtures replace hrefs by channel, so checks remain valid after the owner
// fills in real URLs in the single editable HTML block.
function contactFixture(channels) {
  return html.replace(/(<a data-contact-channel="([^"]+)" href=")[^"]*(")/g,
    (_, prefix, channel, suffix) => prefix + (channels[channel] || '') + suffix);
}

test("project and research articles are readable through the native dossier routes", () => {
  const h = harness();
  for (const route of ['projects', 'research']) {
    const cards = h.select('.project-card').filter(card => card.isDescendantOf(h.id(route)));
    assert.ok(cards.length > 0, `#${route} contains project details`);
    for (const card of cards) {
      assert.ok((card.querySelector('h3') || card.querySelector('h4')).textContent.trim());
      assert.ok(card.querySelector('p').textContent.trim());
    }
  }
  const demo = h.select('a').find(link => link.getAttribute('href') === 'https://github.com/calavera16/BioTwin-Sync');
  assert.ok(demo && demo.isDescendantOf(h.id('projects')), 'public project code/demo is a native Work link');
});

test("unset contact channels have no inspector shortcuts and stay hidden without scripting", () => {
  const markup = contactFixture({});
  const h = harness({ markup });
  const channels = h.select('[data-contact-channel]');
  assert.deepEqual(channels.map(link => link.dataset.contactChannel), ['github', 'instagram', 'email', 'youtube']);
  assert.equal(h.id('operator-links').children.length, 0);
  for (const link of channels) {
    assert.equal(link.getAttribute('href'), '');
    assert.equal(link.isDescendantOf(h.id('contact-links')), true);
    assert.equal(link.hidden, false, 'filled native links must not require JS to unhide');
  }
  assert.match(css, /\[data-contact-channel\]\[href=""\], \.operator-links:empty\s*\{\s*display:\s*none/);
  assert.doesNotMatch(markup, /class="op-link"[^>]*href="#/);
});

test("configured contact channels mirror native destinations from one HTML block", () => {
  const configured = {
    github: 'https://github.com/test-owner', instagram: 'https://www.instagram.com/test-owner/',
    email: 'mailto:hello@example.test', youtube: 'https://www.youtube.com/@test-owner',
  };
  for (const values of [configured, { email: configured.email }, { github: configured.github, youtube: configured.youtube }]) {
    const h = harness({ markup: contactFixture(values) });
    const originals = h.select('[data-contact-channel]').filter(link => link.getAttribute('href'));
    const shortcuts = h.id('operator-links').children;
    assert.equal(shortcuts.length, originals.length);
    for (const [index, original] of originals.entries()) {
      const shortcut = shortcuts[index];
      assert.equal(original.getAttribute('href'), values[original.dataset.contactChannel]);
      assert.equal(shortcut.tagName, 'A');
      assert.equal(shortcut.getAttribute('class'), 'op-link');
      assert.equal(shortcut.getAttribute('href'), original.getAttribute('href'));
      assert.equal(shortcut.textContent, original.textContent);
      assert.equal(h.click(original).defaultPrevented, false);
      assert.equal(h.click(shortcut).defaultPrevented, false);
    }
  }
});


test("Both entry points load the shared semantic reading hierarchy", () => {
  const landing = fs.readFileSync("dist/index.html", "utf8");
  for (const [page, base] of [[html, "portfolio"], [landing, "station"]]) {
    assert.match(page, /href="typography\.css\?v=site-type-1"/);
    assert.ok(page.indexOf('href="typography.css') > page.indexOf(`href="${base}.css`), "reading hierarchy loads after instrument styles");
  }
  const roles = [
    [".destination .record-head h2", "title"],
    [".destination h3", "section"],
    [".destination h4", "heading"],
    [".destination p:not(.record-meta)", "description"],
    [".standby-copy", "description"],
  ];
  const rules = [...typography.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [selector, role] of roles) {
    const rule = rules.find(([, selectors]) => selectors.split(",").map(value => value.trim()).includes(selector));
    assert.ok(rule, `shared role covers ${selector}`);
    assert.ok(rule[2].includes(`font-size: var(--type-${role})`));
  }
  assert.doesNotMatch(css, /#projects [^{]+\{[^}]*font-size: clamp/, "no independent Projects scale remains");
  for (const [, selectors, declarations] of rules) {
    if (/font-size:/.test(declarations)) assert.doesNotMatch(selectors, /(?:^|,)\s*\.(?:console-shell|destination|chart-screen|intro-screen)\s*(?:,|$)/, "reading sizes do not change instrument geometry");
  }
});

test("Projects labels, semantic project groups and native legacy fragment stay consistent", () => {
  const h = harness();
  assert.equal(h.select('.star-name')[0].textContent, 'Projects');
  assert.equal(h.select('.idx-label')[0].textContent, 'Projects');
  assert.equal(h.id('projects-title').textContent, 'Projects');
  const groups = h.select('.project-group').filter(group => group.isDescendantOf(h.id('projects')));
  const hackathons = groups.find(group => group.getAttribute('aria-labelledby') === 'hackathons-title');
  const personal = groups.find(group => group.getAttribute('aria-labelledby') === 'personal-projects-title');
  assert.equal(hackathons.tagName, 'SECTION');
  assert.equal(personal.tagName, 'SECTION');
  assert.equal(h.id('hackathons-title').textContent, 'Hackathon Participation');
  assert.equal(h.id('projects').querySelector('.record-body'), h.id('hackathons-title'), 'the heading supplies the Projects inspector preview');
  assert.equal((html.match(/Hackathon Participation/g) || []).length, 1, 'the editable label appears once');
  assert.equal(h.id('personal-projects-title').textContent, 'Personal projects');
  assert.equal(h.id('projects-title').tagName, 'H2');
  for (const id of ['hackathons-title', 'personal-projects-title']) {
    assert.equal(h.id(id).tagName, 'H3');
    assert.equal(h.id(id).getAttribute('style'), null);
  }
  // Evaluate the shipped type scale as a CSS envelope, without a browser.
  const typeScale = ['title', 'section', 'heading', 'description']
    .map(selector => {
      const size = typography.match(new RegExp(`--type-${selector}: clamp\\(([\\d.]+)rem, ([\\d.]+)rem \\+ ([\\d.]+)vw, ([\\d.]+)rem\\)`));
      assert.ok(size, `bounded fluid type: ${selector}`);
      return size.slice(1).map(Number);
    });
  for (const root of [16, 20, 32]) for (const width of [320, 768, 1440, 2560]) {
    const sizes = typeScale.map(([min, rem, vw, max]) => Math.max(min * root, Math.min(rem * root + vw * width / 100, max * root)));
    assert.ok(sizes.slice(1).every((size, i) => sizes[i] - size >= 2), `distinct heading/body sizes at ${width}px / ${root}px root`);
    assert.ok(sizes[3] >= .875 * root, 'description retains its readable rem floor');
  }
  const cards = h.select('.project-card').filter(card => card.isDescendantOf(hackathons));
  assert.equal(cards[0].querySelector('h4').textContent, 'Meta Global AI Developer Hackathon \u2014 SignalTrace');
  assert.match(cards[0].textContent, /For my solo entry, I built SignalTrace/);
  assert.equal(cards[0].querySelector('a').href, 'https://youtu.be/FOfwBFH0nXI');
  assert.equal(cards[1].querySelector('h4').textContent, 'NASA Space Apps Challenge \u2014 BioTwin Sync');
  assert.equal(cards[1].querySelector('a').href, 'https://github.com/calavera16/BioTwin-Sync');
  assert.doesNotMatch(html, /Galaxy Battery Display|small desk display/);
  const personalCards = h.select('.project-card').filter(card => card.isDescendantOf(personal));
  assert.deepEqual(personalCards.map(card => card.querySelector('h4')?.textContent), [
    'Elsewhere (WIP)', 'Second Brain Operations (WIP)', 'Allowance'
  ], 'personal projects retain their order and visible work-in-progress status');
  for (const card of personalCards) {
    assert.equal(card.tagName, 'ARTICLE');
    assert.ok(card.querySelector('p')?.textContent.trim(), 'each project has a description');
  }
  const allowanceLink = h.select('a').find(link => link.isDescendantOf(personalCards[2]) && link.href === 'https://github.com/calavera16/Allowance');
  assert.ok(allowanceLink, 'Allowance links to its verified repository');
  assert.equal(h.click(allowanceLink).defaultPrevented, false, 'Allowance keeps native link navigation');
  assert.match(html, /<noscript>[^]*open Projects, Research, About, or Contact/);
  assert.match(html, /<span id="work" class="route-alias" aria-hidden="true"><\/span>\s*<section class="destination" id="projects"/);
  assert.match(css, /\.primary-pane:has\(\.route-alias:target\) \.chart-panel \{ display: none; \}/);
  assert.match(css, /\.primary-pane:has\(\.route-alias:target\) \.dossier-panel \{ display: block; \}/);
  assert.match(css, /\.route-alias:target \+ \.destination \{ display: block; \}/);
});

test("personal project previews share native local image links and readable captions", () => {
  const h = harness({ hash: '#projects' });
  const group = h.select('.project-group').find(node => node.getAttribute('aria-labelledby') === 'personal-projects-title');
  const cards = h.select('.project-card').filter(node => node.isDescendantOf(group));
  const previews = [
    ['Elsewhere', 'elsewhere-preview.webp', '1440', '1184'],
    ['Second Brain Operations', 'second-brain-operations-preview.webp', '1440', '920'],
    ['Allowance', 'allowance-preview.webp', '1254', '903'],
  ];
  for (const [index, [name, filename, width, height]] of previews.entries()) {
    const card = cards[index];
    const row = card.querySelector('.project-with-media');
    const description = row.querySelector('.project-description');
    const figure = row.querySelector('.project-media');
    assert.equal(figure.tagName, 'FIGURE');
    assert.ok(row.children.indexOf(description) < row.children.indexOf(figure), 'preview follows its description when stacked');
    const links = h.select('a').filter(node => node.isDescendantOf(figure));
    assert.equal(links.length, 1, 'image and caption form one native link');
    const link = links[0];
    const image = link.querySelector('img');
    const path = `media/${filename}`;
    assert.equal(link.href, path);
    assert.equal(image.getAttribute('src'), path);
    assert.equal(link.getAttribute('aria-label'), `Open full-size ${name} preview`);
    assert.equal(link.getAttribute('tabindex'), null);
    assert.equal(h.click(link).defaultPrevented, false, 'controller preserves native full-size navigation');
    assert.equal(link.querySelector('.project-media-caption').textContent, 'Open full-size preview');
    assert.ok(image.getAttribute('alt').includes(name), 'preview has project-specific descriptive alternative text');
    assert.ok(image.getAttribute('alt').length > name.length + 10);
    assert.equal(image.getAttribute('width'), width);
    assert.equal(image.getAttribute('height'), height);
    assert.equal(image.getAttribute('loading'), 'lazy');
    const webp = fs.readFileSync(`dist/${path}`);
    assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
    assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  }
});

test("SignalTrace preview and caption share the native official gallery link", () => {
  const h = harness({ hash: '#projects' });
  const meta = h.select('.project-card').find(card => card.querySelector('h4')?.textContent.includes('SignalTrace'));
  const links = h.select('a').filter(link => link.isDescendantOf(meta));
  // The lightweight offline harness retains serialized HTML entities in attributes.
  assert.deepEqual(links.map(link => link.href.replace(/&amp;/g, '&')), [
    'https://youtu.be/FOfwBFH0nXI',
    'https://github.com/calavera16/SignalChase',
    'https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/gallery?q=signal+&project=2223'
  ]);
  const media = meta.querySelector('.project-media');
  const link = media.querySelector('a');
  const preview = link.querySelector('img');
  assert.equal(link.getAttribute('tabindex'), null);
  assert.equal(h.click(link).defaultPrevented, false);
  assert.equal(link.querySelector('.project-media-caption').textContent, 'Official hackathon gallery');
  assert.equal(preview.getAttribute('src'), 'media/signaltrace.webp');
  assert.match(preview.getAttribute('alt'), /SignalTrace.*waveform plots/);
  assert.equal(preview.getAttribute('width'), '1280');
  assert.equal(preview.getAttribute('height'), '720');
  assert.equal(preview.getAttribute('loading'), 'lazy');
  const webp = fs.readFileSync(`dist/${preview.getAttribute('src')}`);
  assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
});

test("NASA participation certificate has a native local PDF link and uncropped preview", () => {
  const h = harness({ hash: '#projects' });
  const cards = h.select('.project-card').filter(card => card.isDescendantOf(h.id('projects')));
  const meta = cards.find(card => card.querySelector('h4')?.textContent.includes('SignalTrace'));
  const nasa = cards.find(card => card.querySelector('h4')?.textContent.includes('BioTwin Sync'));
  const metaLinks = h.select('a').filter(link => link.isDescendantOf(meta));
  assert.ok(metaLinks.some(link => link.href === 'https://youtu.be/FOfwBFH0nXI'));
  assert.ok(metaLinks.every(link => link.href !== 'media/nasa-space-apps-certificate.pdf'), 'only NASA links this certificate');
  const media = nasa.querySelector('.project-media');
  const link = media.querySelector('a');
  const preview = media.querySelector('img');
  assert.equal(link.href, 'media/nasa-space-apps-certificate.pdf');
  assert.equal(link.getAttribute('tabindex'), null, 'native anchor remains in keyboard order');
  assert.equal(h.click(link).defaultPrevented, false, 'controller leaves PDF navigation native');
  assert.equal(link.querySelector('.project-media-caption').textContent, 'View certificate (PDF)');
  assert.equal(preview.getAttribute('src'), 'media/nasa-space-apps-certificate.webp');
  assert.match(preview.getAttribute('alt'), /NASA Space Apps Challenge certificate of participation for Yeon Jun Kim/);
  assert.equal(preview.getAttribute('width'), '1080');
  assert.equal(preview.getAttribute('height'), '835');
  assert.equal(preview.getAttribute('loading'), 'lazy');
  const pdf = fs.readFileSync(`dist/${link.href}`);
  const webp = fs.readFileSync(`dist/${preview.getAttribute('src')}`);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  assert.equal(h.select('iframe, embed, object').filter(node => node.isDescendantOf(nasa)).length, 0);
});

test("canonical and legacy Projects routes preserve native history, focus, Escape and one lock", () => {
  for (const hash of ['#projects', '#work']) {
    const h = harness({ hash });
    assert.equal(h.location.hash, hash, 'opening either bookmark keeps its native history entry');
    assert.equal(h.document.title, 'Yeon Jun Kim // Projects');
    assert.equal(h.id('insp-target').textContent, 'HD-01 / PROJECTS');
    assert.equal(h.frames.size, 0, 'either dossier route pauses chart scanning');
    assert.equal(h.select('.star-link')[0].getAttribute('aria-current'), 'page');
    assert.equal(h.select('.index-link')[0].getAttribute('aria-current'), 'page');
    assert.deepEqual(h.hashWrites, []);
    assert.deepEqual(h.historyWrites, []);
    h.route(hash);
    assert.equal(h.document.activeElement, h.id('projects'));
    assert.equal(h.id('telemetry-log').children.filter(line => line.textContent.includes('LOCK ACQUIRED')).length, 1);
    h.event(h.document, 'keydown', { key: 'Escape' });
    assert.equal(h.location.hash, '#map');
    h.event(h.window, 'hashchange');
    assert.equal(h.document.activeElement, h.select('.star-link')[0]);
    const origin = h.select('.index-link')[0];
    h.click(origin);
    h.route(hash);
    h.route('#map');
    assert.equal(h.document.activeElement, origin, 'return restores the originating index');
    h.hashWrites.length = 0;
    h.event(h.document, 'keydown', { key: '1' });
    assert.deepEqual(h.hashWrites, ['projects'], 'shortcut makes one native canonical navigation');
    assert.deepEqual(h.historyWrites, [], 'route sync never rewrites browser history');
  }
});


test("longer Projects chart label retains room on wide and narrow grids", () => {
  const h = harness();
  const labels = h.select('.star-name');
  assert.ok(labels[0].textContent.length <= labels[1].textContent.length, 'Projects is within the existing Research label width');
  // Both labels share typography. Projects extends right, Research extends left;
  // Projects has more space to its grid edge in both saved coordinate systems.
  for (const [cols, projectCol, researchCol] of [[121, 21, 83], [57, 10, 40]]) {
    assert.ok(cols - 1 - projectCol >= researchCol);
  }
  assert.match(css, /white-space:\s*nowrap; color:\s*var\(--bone\)/);
  assert.match(html, /portfolio\.css\?v=[\w.-]+/);
  assert.match(html, /portfolio\.js\?v=projects-1/);
});


test("Projects centers surplus width and uses it for copy plus links or media", t => {
  // Read the shipped CSS dimensions: this is a deterministic layout envelope,
  // not a renderer or a claim about measured browser pixels.
  const rule = selector => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `missing layout rule: ${selector}`);
    return match[1];
  };
  const ch = (body, property) => {
    const value = body.match(new RegExp(`${property}:\\s*([\\d.]+)ch`));
    assert.ok(value, `missing ${property} in ${body}`);
    return Number(value[1]);
  };
  const destination = rule('.destination');
  const projects = rule('#projects');
  const padding = ch(destination, 'padding') * 2;
  const readingCap = ch(destination, 'max-width');
  const projectCap = ch(projects, 'max-width');
  assert.match(destination, /margin-inline:\s*auto/);
  assert.match(projects, /container:\s*project-dossier \/ inline-size/);
  assert.ok(projectCap > readingCap, 'Projects has a wider canvas than text-only records');
  assert.match(rule('#projects .project-card'), /max-width:\s*none/);
  assert.doesNotMatch(rule('.project-group'), /max-width/, 'section dividers span the Projects canvas');
  assert.match(rule('.project-description > p'), /max-width:\s*70ch/);
  assert.match(rule('.project-with-media'), /grid-template-columns:\s*minmax\(0, 1fr\)/, 'fallback and narrow panes stack');
  assert.match(rule('.project-media'), /width:\s*min\(100%,\s*46ch\)/, 'stacked certificate fits narrow panes and stays readable');
  const wide = css.match(/@container project-dossier \(min-width:\s*([\d.]+)ch\)\s*\{\s*\.project-with-media\s*\{\s*grid-template-columns:\s*minmax\(0, ([\d.]+)fr\) minmax\(0, ([\d.]+)fr\)/);
  assert.ok(wide, 'columns respond to actual dossier content width');
  const [, threshold, copyRatio, mediaRatio] = wide.map(Number);
  const gap = Number(rule('.project-with-media').match(/gap:\s*[\d.]+ch ([\d.]+)ch/)[1]);
  for (const pane of [28, 56, 86, 100, 160, 240]) {
    const outer = Math.min(pane, projectCap);
    const content = outer - padding;
    const margin = (pane - outer) / 2;
    const paired = content >= threshold;
    const copy = paired ? (content - gap) * copyRatio / (copyRatio + mediaRatio) : content;
    const media = paired ? (content - gap) * mediaRatio / (copyRatio + mediaRatio) : Math.min(content, 46);
    assert.equal(margin + outer + margin, pane, 'surplus width is centered equally');
    assert.ok(content > 0 && copy > 0 && media > 0 && media <= content);
    if (paired) {
      assert.ok(copy <= 70, 'wide paired copy stays within reading measure');
      assert.ok(media > 30, 'wide certificate is larger than its previous cap');
      assert.ok(Math.abs(copy + gap + media - content) < .00001, 'columns fill the available section width');
    }
    t.diagnostic(`pane ${pane}ch: centered margins ${margin}ch; section ${content}ch; ${paired ? 'paired' : 'stacked'} copy ${copy.toFixed(1)}ch / certificate ${media.toFixed(1)}ch`);
  }
  const h = harness();
  const rows = h.select('.project-with-media').filter(row => row.isDescendantOf(h.id('projects')));
  assert.equal(rows.length, 5, 'both hackathons and all three personal projects reuse the responsive media rows');
  for (const row of rows) {
    assert.ok(row.querySelector('.project-description'));
    assert.ok(row.querySelector('.project-media').querySelector('img'), 'paired row contains its project preview');
  }
});


test("research experience is a labeled, date-first two-entry timeline", () => {
  const h = harness({ hash: '#research' });
  const research = h.id('research');
  const timelines = h.select('.research-timeline').filter(node => node.isDescendantOf(research));
  assert.equal(timelines.length, 1);
  const timeline = timelines[0];
  assert.equal(timeline.tagName, 'OL', 'research experience retains ordered-list semantics without JavaScript');
  const label = timeline.getAttribute('aria-label') || (timeline.getAttribute('aria-labelledby') || '')
    .split(/\s+/).map(id => h.id(id)?.textContent || '').join(' ');
  assert.ok(label.trim(), 'timeline has an accessible name');
  assert.ok([null, 'list'].includes(timeline.getAttribute('role')), 'ordered-list semantics are preserved, including explicit list role for marker-free lists');
  const entries = timeline.children.filter(node => typeof node !== 'string');
  assert.equal(entries.length, 2);
  assert.ok(entries.every(node => node.tagName === 'LI'), 'each experience is one direct list entry');
  const [current, former] = entries;
  const normalized = node => node.textContent.replace(/\s+/g, ' ').trim();
  const role = entry => h.select('h3, h4, h5, h6, strong').find(node => node.isDescendantOf(entry));
  assert.equal(normalized(current.firstElementChild), 'Current', 'current date appears before its role');
  assert.equal(normalized(role(current)), 'Independent Undergraduate Researcher');
  assert.ok(normalized(current.querySelector('.record-body')), 'current experience provides an editable summary');
  assert.equal(current.querySelector('time'), null, 'Current is a status, not a fabricated date');
  assert.equal(normalized(role(former)), 'Undergraduate Research Student');
  const dates = h.select('time').filter(node => node.isDescendantOf(former));
  assert.deepEqual(dates.map(node => node.getAttribute('datetime')), ['2025-07-14', '2026-08-21']);
  assert.deepEqual(dates.map(normalized), ['July 14, 2025', 'August 21, 2026']);
  assert.ok(dates.every(node => node === former.firstElementChild || node.isDescendantOf(former.firstElementChild)), 'former date range precedes its role and affiliation');
  assert.match(normalized(former), /Cerebrovascular Disease Research Center, Hallym University/);
  const summary = research.querySelector('.record-body');
  assert.ok(summary && summary.isDescendantOf(current), 'inspector retains the current experience preview');
  assert.equal(h.id('inspector-summary').textContent, summary.textContent.trim());
});

test("research topic records and coauthored awards preserve accessible native reading", () => {
  const h = harness({ hash: '#research' });
  const research = h.id('research');
  const topics = h.select('.research-topic');
  assert.deepEqual(topics.map(node => node.querySelector('h3').textContent), ['iPPG Research', 'Sleep Research', 'Stress/Emotion Research']);
  assert.match(h.id('stress-research-title').parentElement.textContent, /positive and negative emotion/);
  assert.doesNotMatch(h.id('stress-research-title').parentElement.textContent, /MESA|sleep from wakefulness/);
  assert.match(h.id('sleep-modalities').textContent, /AAUWSS/);
  const works = h.select('cite').filter(node => node.isDescendantOf(research));
  assert.equal(works.length, 4);
  for (const work of works) assert.doesNotMatch(work.textContent, /\?\?/);
  const awards = h.select('.award-list')[0];
  const awardDates = h.select('time').filter(node => node.isDescendantOf(awards));
  assert.deepEqual(awardDates.map(node => node.getAttribute('datetime')), ['2026-06-12', '2025-10-01', '2025-09-19']);
  assert.equal(h.select('[lang="ko"]').filter(node => node.isDescendantOf(awards)).length, 3);
  const links = h.select('a').filter(node => node.isDescendantOf(research) && node !== research.querySelector('.back-link'));
  for (const link of links) {
    assert.ok(link.href.startsWith('https://') || /^media\/[\w-]+\.pdf$/.test(link.href), 'official sources or local award PDFs');
    assert.equal(h.click(link).defaultPrevented, false, 'source navigation stays native');
  }
});


test("Research uses the wide Projects layout while keeping its content at the start", () => {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const declarations = selector => Object.fromEntries(rules
    .filter(([, selectors]) => selectors.split(',').map(value => value.trim()).includes(selector))
    .flatMap(([, , body]) => body.split(';').map(value => value.trim()).filter(Boolean))
    .map(value => {
      const colon = value.indexOf(':');
      return [value.slice(0, colon).trim(), value.slice(colon + 1).trim().replace(/\s+/g, ' ')];
    }));
  const research = declarations('#research');
  assert.equal(research['max-width'], '116ch');
  assert.equal(research['margin-inline'], '0');
  assert.equal(research['text-align'], 'start');
  assert.match(research.container, /^project-dossier\s*\/\s*inline-size$/);
  assert.equal(declarations('#research .project-card')['max-width'], 'none');
  assert.equal(declarations('#research .research-topic > p')['max-width'], '70ch');
  assert.equal(declarations('#research .research-works')['max-width'], 'none');
  assert.equal(declarations('#research .project-media').margin, '0');
  assert.match(declarations('#research .award-media-portrait').width, /^min\(100%,\s*30ch\)$/);
  assert.equal(declarations('.research-works .paper-link').border, '1px solid var(--signal)');
});


test("Award previews and captions share unique native PDF links", () => {
  const h = harness({ hash: '#research' });
  const rows = h.select('.project-with-media').filter(node => node.isDescendantOf(h.id('research')));
  assert.equal(rows.length, 3);
  const expected = [
    ['ksdh-2026-oral-award', '1200', '849'],
    ['kics-2025-paper-award', '849', '1200'],
    ['ksdh-2025-poster-award', '1200', '848'],
  ];
  const korean = h.select('[lang="ko"]').filter(node => node.isDescendantOf(h.select('.award-list')[0]));
  assert.deepEqual(korean.map(node => node.textContent), ['\ucd5c\uc6b0\uc218\uc0c1', '\ucd5c\uc6b0\uc218 \ub17c\ubb38\uc0c1', '\uc7a5\ub824\uc0c1']);
  const names = new Set();
  for (const [index, row] of rows.entries()) {
    const [stem, width, height] = expected[index];
    assert.ok(row.querySelector('.project-description').querySelector('h4'));
    const media = row.querySelector('.project-media');
    assert.equal(media.tagName, 'FIGURE');
    const links = h.select('a').filter(link => link.isDescendantOf(media));
    assert.equal(links.length, 1);
    const link = links[0];
    assert.equal(link.href, `media/${stem}.pdf`);
    assert.equal(link.getAttribute('tabindex'), null);
    assert.match(link.getAttribute('aria-label'), /^View .* Award certificate \(PDF\)$/);
    names.add(link.getAttribute('aria-label'));
    assert.equal(h.click(link).defaultPrevented, false);
    assert.equal(link.querySelector('.project-media-caption').textContent, 'View award certificate (PDF)');
    const preview = link.querySelector('img');
    assert.equal(preview.getAttribute('src'), `media/${stem}.webp`);
    assert.match(preview.getAttribute('alt'), /Award certificate$/);
    assert.equal(preview.getAttribute('width'), width);
    assert.equal(preview.getAttribute('height'), height);
    assert.equal(preview.getAttribute('loading'), 'lazy');
    const pdf = fs.readFileSync(`dist/${link.href}`);
    const webp = fs.readFileSync(`dist/${preview.getAttribute('src')}`);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
    assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  }
  assert.equal(names.size, 3);
  const paper = h.id('ippg-roi').querySelector('.paper-link');
  assert.equal(paper.textContent, 'Open paper (PDF)');
  assert.equal(paper.href, 'https://d2j16w31g89z0j.cloudfront.net/site/koreaai2025/abs/B-7-6.pdf');
  for (const id of ['ippg-full-frame', 'ippg-heart-rate']) assert.equal(h.id(id).querySelector('a').textContent, 'Conference page');
  assert.equal(h.id('sleep-modalities').querySelector('a').textContent, 'Conference program');
});

test("About and Contact highlight broad research curiosities and hobbies without locking to pulse sensing", () => {
  const h = harness({ hash: '#about' });
  const aboutText = h.id('about').textContent;
  const contactText = h.id('contact').textContent;
  const aboutSummary = h.id('about').querySelector('.record-body').textContent.trim();
  const contactSummary = h.id('contact').querySelector('.record-body').textContent.trim();
  assert.ok(aboutSummary.length > 30 && aboutSummary.length < 300, 'About keeps a concise inspector preview');
  assert.ok(contactSummary.length > 30 && contactSummary.length < 200, 'Contact keeps a concise inspector preview');
  assert.doesNotMatch(contactText, /camera-based pulse sensing|embedded displays/i, 'Contact is open beyond narrow pulse sensing');
  assert.equal(h.select('.about-card').filter(card => card.isDescendantOf(h.id('about'))).length, 2, 'About separates research curiosities and hobbies');
  assert.equal(h.select('.tag-list').filter(list => list.isDescendantOf(h.id('about'))).length, 2, 'About exposes dedicated interest and hobby tag lists');
  assert.doesNotMatch(aboutText, /I[’']m Yeon Jun Kim|My name is Yeon Jun Kim/i, 'About avoids stiff self-introduction repetition');
  assert.match(aboutText, /jack of all trades/i, 'About highlights a positive jack-of-all-trades perspective');
  assert.match(aboutText, /Hobbies & outside interests/);

  const jackArt = h.select('.jack-art').find(node => node.isDescendantOf(h.id('about')));
  assert.ok(jackArt, 'About includes playing-card art');
  assert.equal(jackArt.querySelector('figcaption'), null, 'art remains caption-free');
  assert.equal(jackArt.querySelector('.jack-stage').getAttribute('role'), 'img');
  assert.match(jackArt.querySelector('.jack-stage').getAttribute('aria-label'), /four.*Jack/i);
  // Enlarged interest/hobby tags + flush-start 116ch dossier layout.
  assert.match(css, /#about, #contact\s*\{\s*max-width:\s*116ch;\s*margin-inline:\s*0;\s*text-align:\s*start;/, 'About and Contact align flush-start at wide dossier width like Research');
  assert.match(css, /#about \.tag-list > \*\s*\{[\s\S]*font-size:\s*calc\(var\(--type-description\)\s*\*\s*1\.08\)/, 'About interest tags use an enlarged readable size');
  // Contact channels include large buttons with accessible brand/channel SVG logos.
  const contactLinks = h.select('[data-contact-channel]').filter(node => node.isDescendantOf(h.id('contact-links')));
  assert.equal(contactLinks.length, 4);
  for (const link of contactLinks) {
    const icon = link.querySelector('svg');
    assert.ok(icon && icon.classList.contains('channel-icon'), `${link.dataset.contactChannel} renders a channel logo`);
    assert.equal(icon.getAttribute('aria-hidden'), 'true');
  }
  assert.match(css, /#contact-links a:not\(\[href=""\]\)\s*\{[\s\S]*font-size:\s*calc\(var\(--type-description\)\s*\*\s*1\.12\)/, 'Contact channel buttons use enlarged typography');
  assert.equal(h.select('.channel-guide').filter(node => node.isDescendantOf(h.id('contact'))).length, 1, 'Contact explains each channel cleanly');
});


function advanceJack(h, elapsed, step = 16) {
  while (elapsed > 0) {
    const dt = Math.min(step, elapsed);
    h.frame(dt);
    elapsed -= dt;
  }
}

function jackRenderer() {
  const names = ['back', 'mid', 'front', 'gold', 'cool', 'warm', 'mint'];
  const elements = Object.fromEntries(names.map(name => [`jack-${name}`, { textContent: '' }]));
  const code = source.slice(source.indexOf('  const JACK_ORDERS'), source.indexOf('  function shouldAnimateFx()'));
  const context = vm.createContext({ document: { getElementById: id => elements[id] || null } });
  vm.runInContext(`const SHUFFLE_CYCLE_MS = 4800; ${code}`, context);
  const compositeFrom = layerMap => {
    const grid = Array.from({ length: 44 }, () => Array(96).fill(' '));
    for (const name of names) {
      const lines = layerMap[name].split('\n');
      for (let r = 0; r < 44; r++) {
        const chars = [...lines[r]];
        for (let c = 0; c < 96; c++) if (chars[c] && chars[c] !== ' ') grid[r][c] = chars[c];
      }
    }
    return grid.map(row => row.join('')).join('\n');
  };
  return {
    names,
    layers(time) {
      vm.runInContext(`renderJackShuffle(${time})`, context);
      return Object.fromEntries(names.map(name => [name, elements[`jack-${name}`].textContent]));
    },
    frame(time) {
      return compositeFrom(this.layers(time));
    },
    face(id, lean = 0, flex = 0) {
      const layerMap = vm.runInContext(`(() => {
        const bufs = makeJackBufs();
        drawJackFace(bufs, ${id}, {x: 32, y: 9, lean: ${lean}, flex: ${flex}}, 3, true);
        return Object.fromEntries(JACK_LAYER_NAMES.map(name => [name, bufs[name].map(row => row.join('')).join('\\n')]));
      })()`, context);
      return { layers: layerMap, text: compositeFrom(layerMap) };
    },
  };
}

test("ASCII shuffle repaints high-res 96x44 multi-color layers with four distinct single-suit Jack faces", () => {
  const h = harness({ hash: '#about' });
  const renderer = jackRenderer();
  assert.equal(h.select('.jack-layer').length, renderer.names.length, 'seven color-separated text layers');
  assert.equal(h.select('.jack-art').length, 1);
  assert.equal(h.select('.jack-stage').length, 1);
  assert.equal(h.select('.jack-card').length, 0, 'no moving DOM cards');
  const readLiveLayers = () => Object.fromEntries(renderer.names.map(name => [name, h.id(`jack-${name}`).textContent]));
  const compositeLive = () => {
    const live = readLiveLayers();
    const grid = Array.from({ length: 44 }, () => Array(96).fill(' '));
    for (const name of renderer.names) {
      const lines = live[name].split('\n');
      for (let r = 0; r < 44; r++) {
        const chars = [...lines[r]];
        for (let c = 0; c < 96; c++) if (chars[c] && chars[c] !== ' ') grid[r][c] = chars[c];
      }
    }
    return grid.map(row => row.join('')).join('\n');
  };
  const frame0Layers = renderer.layers(0);
  for (const name of renderer.names) {
    const el = h.id(`jack-${name}`);
    assert.ok(el.isDescendantOf(h.id('about')), `jack-${name} is inside the About dossier`);
    assert.equal(el.tagName, 'PRE');
    assert.equal(el.getAttribute('aria-hidden'), 'true');
    const authored = html.match(new RegExp(`id="jack-${name}"[^>]*>([\\s\\S]*?)<\\/pre>`))[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.equal(el.textContent, authored, `authored no-JS jack-${name} matches first animation frame`);
    assert.equal(frame0Layers[name], authored);
  }
  const staticText = renderer.frame(0);
  const suits = ['\u2663', '\u2666', '\u2665', '\u2660'];
  const suitColors = ['mint', 'gold', 'warm', 'cool'];
  for (let id = 0; id < 4; id++) {
    const { text: face, layers } = renderer.face(id);
    assert.equal([...face].filter(ch => ch === 'J').length, 2, 'both corners carry J');
    const emblem = face.split('\n').slice(16, 27).map(line => line.slice(41, 54)).join('');
    assert.ok(emblem.replace(/ /g, '').length >= 35, 'center has a high-res shaded 13x11 emblem');
    assert.match(emblem, /[/\\()<>^V]/, 'emblem outline uses ordinary ASCII');
    assert.equal([...face].filter(ch => ch === suits[id]).length, 3, 'two matching corners and one central pip');
    suits.filter((_, i) => i !== id).forEach(suit => assert.ok(!face.includes(suit), 'no foreign suits on face'));
    assert.ok(layers[suitColors[id]].includes(suits[id]), `suit ${suits[id]} paints on its dedicated color layer`);
    for (const border of ['back', 'mid', 'front']) {
      assert.doesNotMatch(layers[border], /[\u2660\u2663\u2665\u2666]/, `${border} border layer keeps pure ASCII`);
    }
    assert.ok(staticText.includes(`J${suits[id]}`), 'each identity is exposed in the starting fan');
  }
  assert.notEqual(renderer.face(0).text, renderer.face(0, 7, 4).text, 'contours change in cells when flexed');
  assert.match(renderer.face(0, 7, 4).text, /[\\/]/, 'sloped edges are actual slash glyphs');
  const jackCss = css.slice(css.indexOf('.jack-art {'), css.indexOf('#about .tag-list'));
  assert.doesNotMatch(jackCss, /transform|animation:/);
  assert.match(jackCss, /font-variant-emoji:\s*text/);
  assert.match(jackCss, /white-space:\s*pre/);
  for (const cls of ['jack-layer-gold', 'jack-layer-cool', 'jack-layer-warm', 'jack-layer-mint']) {
    assert.ok(jackCss.includes(`.${cls}`), `palette styles ${cls}`);
  }
  h.frame(0);
  let previous = compositeLive(), longestStill = 0, still = 0;
  const unique = new Set([previous]);
  for (let t = 50; t <= 4800; t += 50) {
    h.frame(50);
    const liveLayers = readLiveLayers();
    for (const name of renderer.names) {
      const lines = liveLayers[name].split('\n');
      assert.equal(lines.length, 44);
      assert.ok(lines.every(line => [...line].length === 96), `fixed 96-col stage on ${name}`);
    }
    const text = compositeLive();
    assert.equal(text, renderer.frame(t), 'live loop paints the requested glyph frame');
    unique.add(text);
    still = text === previous ? still + 50 : 0;
    longestStill = Math.max(still, longestStill);
    previous = text;
  }
  assert.ok(unique.size > 65, 'many distinct drawn frames, not a static card image');
  assert.ok(longestStill <= 250, `no long rest in choreography: ${longestStill}ms`);
  assert.notEqual(renderer.frame(1440), staticText, 'fan opens into separated packets');
  assert.notEqual(renderer.frame(2400), renderer.frame(2600), 'staggered riffle visibly redraws');
  const orders = [[2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2], [0, 1, 2, 3]];
  for (let cycle = 1; cycle <= 4; cycle++) {
    const text = renderer.frame(cycle * 4800);
    const lines = text.split('\n');
    const corners = lines.flatMap(line => [...line.matchAll(/J([\u2660\u2663\u2665\u2666])/g)].map(match => ({ x: match.index, id: suits.indexOf(match[1]) })));
    assert.deepEqual(corners.sort((a, b) => a.x - b.x).map(corner => corner.id), orders[cycle - 1]);
  }
  assert.equal(renderer.frame(19200), staticText, 'four permutations close exactly');
});

test("About text shuffle freezes offscreen and resumes without accumulating hidden time", () => {
  const h = harness({ hash: '#about' });
  const names = ['back', 'mid', 'front', 'gold', 'cool', 'warm', 'mint'];
  const frame = () => names.map(name => h.id(`jack-${name}`).textContent).join('\n---\n');
  h.frame(0);
  advanceJack(h, 500);
  const before = frame();
  for (const pause of ['hidden', 'route', 'pagehide']) {
    if (pause === 'hidden') h.visibility(true);
    if (pause === 'route') h.route('#contact');
    if (pause === 'pagehide') h.event(h.window, 'pagehide');
    assert.equal(h.frames.size, 0, `${pause} cancels the shared RAF`);
    h.frame(10000);
    assert.equal(frame(), before, `${pause} leaves glyphs frozen`);
    if (pause === 'hidden') h.visibility(false);
    if (pause === 'route') h.route('#about');
    if (pause === 'pagehide') h.event(h.window, 'pageshow');
    h.frame(0);
    assert.equal(frame(), before, `${pause} resumes at the same text frame`);
  }
  h.media.matches = true;
  h.event(h.media, 'change');
  assert.equal(h.frames.size, 0);
  const staticFrame = frame();
  advanceJack(h, 10000);
  assert.equal(frame(), staticFrame, 'reduced motion keeps a still fan');
  h.media.matches = false;
  h.event(h.media, 'change');
  h.frame(0);
  assert.equal(frame(), staticFrame, 'leaving reduced motion starts from the displayed fan');
  const reduced = harness({ hash: '#about', reducedMotion: true });
  assert.equal(reduced.frames.size, 0, 'reduced motion never starts the shuffle');
  const reducedFrame = names.map(name => reduced.id(`jack-${name}`).textContent).join('\n---\n');
  assert.equal(reducedFrame, staticFrame);
});


test("Papers remain grouped under their research topics with original model pipelines", () => {
  const h = harness({ hash: '#research' });
  const groups = [['ippg', ['ippg-full-frame', 'ippg-roi', 'ippg-heart-rate']], ['sleep', ['sleep-modalities']]];
  for (const [topic, ids] of groups) {
    const papers = h.id(`${topic}-papers`);
    const article = h.id(`${topic}-research-title`).parentElement;
    assert.equal(papers.tagName, 'SECTION');
    assert.ok(papers.isDescendantOf(article));
    assert.equal(papers.getAttribute('aria-labelledby'), `${topic}-papers-title ${topic}-research-title`);
    const heading = h.id(`${topic}-papers-title`);
    assert.equal(heading.tagName, 'H4');
    assert.equal(heading.textContent, 'Papers');
    assert.deepEqual(h.select('.paper-entry').filter(node => node.isDescendantOf(papers)).map(node => node.id), ids);
    assert.ok(article.children.indexOf(papers) > article.children.indexOf(article.querySelector('p')), 'Papers follows the topic description');
  }
  assert.equal(h.id('stress-research-title').parentElement.querySelector('.research-papers'), null);
  assert.equal(h.select('.research-papers').length, 2);
  const entries = h.select('.paper-entry');
  assert.deepEqual(entries.map(node => node.id), ['ippg-full-frame', 'ippg-roi', 'ippg-heart-rate', 'sleep-modalities']);
  const paths = new Set();
  const altSequences = [/full-frame video.*2D CNN.*LSTM or BiGRU.*heart rate.*blood pressure/i,
    /hand.*face.*dual ROI.*full-frame.*CNN-BiGRU.*blood pressure/i,
    /green-channel facial iPPG.*STFT.*CNN-BiGRU with attention.*heart-rate distribution/i,
    /AAUWSS.*EEG.*ECG.*PPG.*CNNs.*feature-based models.*wake.*NREM.*REM/i];
  const expectedSources = [
    ['https://www.digitalhealthkorea.or.kr/board/bbs/board.php?bo_table=schedule&wr_id=13'],
    ['https://d2j16w31g89z0j.cloudfront.net/site/koreaai2025/abs/B-7-6.pdf', 'https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE12416387'],
    ['https://www.digitalhealthkorea.or.kr/board/bbs/board.php?bo_table=schedule&wr_id=18'],
    ['https://besk.kr/Conference/ConferenceView.asp?AC=0&CODE=CC20260501&CpPage=96'],
  ];
  for (const [index, entry] of entries.entries()) {
    const description = entry.querySelector('.paper-description');
    assert.equal(description.querySelector('cite').parentElement.tagName, 'H5');
    assert.ok(description.querySelector('.work-context'));
    assert.deepEqual(h.select('a').filter(node => node.isDescendantOf(description)).map(node => node.href.replace(/&amp;/g, '&')), expectedSources[index], 'paper retains its original source links');
    const img = entry.querySelector('img');
    const path = `media/paper-${entry.id}.png`;
    assert.equal(img.getAttribute('src'), path);
    assert.equal(img.getAttribute('width'), '900');
    assert.equal(img.getAttribute('height'), '390');
    assert.equal(img.getAttribute('loading'), 'lazy');
    assert.match(img.getAttribute('alt'), altSequences[index]);
    assert.doesNotMatch(img.getAttribute('alt'), /PDF|page image|screenshot/i);
    const png = fs.readFileSync(`dist/${path}`);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 900);
    assert.equal(png.readUInt32BE(20), 390);
    paths.add(path);
  }
  assert.equal(paths.size, 4, 'each paper has a unique local pipeline diagram');
  assert.doesNotMatch(h.id('sleep-modalities').textContent, /MESA/);
  assert.match(css, /@container project-dossier \(min-width: 84ch\)\s*\{\s*\.paper-entry\s*\{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(300px, 350px\)/);
  assert.match(css, /\.paper-entry\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});

test("Dossier interactivity: smooth category jump scroll, lightbox Escape priority, interactive About, and live Contact tools", () => {
  const h = harness({ hash: '#projects' });
  const scrolls = [];
  const dossierPanel = h.select('.dossier-panel')[0];
  dossierPanel.scrollTop = 0;
  dossierPanel.scrollTo = opts => scrolls.push(opts);

  // 1. Projects category pills smoothly roll down to the matching group without hiding others.
  assert.equal(h.frames.size, 0, 'Projects interactions keep idle RAF loops off');
  assert.equal(h.id('signaltrace-scope'), null, 'SignalTrace interactive pulse scope is removed');
  const hackathonsBtn = h.select('[data-project-jump]').find(btn => btn.dataset.projectJump === 'hackathons');
  const personalBtn = h.select('[data-project-jump]').find(btn => btn.dataset.projectJump === 'personal');
  const hackathonsGroup = h.select('[data-project-group]').find(el => el.dataset.projectGroup === 'hackathons');
  const personalGroup = h.select('[data-project-group]').find(el => el.dataset.projectGroup === 'personal');
  h.id('projects-filters').getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 52 });
  h.id('research-filters').getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 52 });
  personalGroup.getBoundingClientRect = () => ({ left: 0, top: 480, width: 600, height: 400 });
  h.click(personalBtn);
  assert.equal(hackathonsGroup.hidden, false, 'all project categories stay visible when rolling down');
  assert.equal(personalGroup.hidden, false);
  assert.equal(personalBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(hackathonsBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(personalGroup.classList.contains('is-jump-target'), true);
  const projectLegs = h.select('.waypoint-leg').filter(leg => leg.isDescendantOf(h.id('projects-filters')));
  assert.equal(projectLegs.length, 1);
  assert.equal(projectLegs[0].classList.contains('is-passed'), true, 'constellation leg illuminates when jumping to Personal');
  assert.equal(scrolls.at(-1).behavior, 'smooth');
  assert.ok(scrolls.at(-1).top > 0, 'smoothly scrolls dossier panel down to Personal projects');

  // 2. Console Media Lightbox opens from project zoom buttons & Research pipeline diagrams,
  //    and Escape closes the lightbox FIRST without closing the active dossier.
  const zoomBtn = h.select('.media-zoom-btn')[0];
  h.click(zoomBtn);
  const lightbox = h.id('media-lightbox');
  assert.equal(lightbox.hidden, false, 'zoom button opens console lightbox');
  assert.equal(h.id('lightbox-img').getAttribute('src'), 'media/signaltrace.webp');
  assert.equal(h.event(h.id('lightbox-close'), 'keydown', { key: 'Escape' }).defaultPrevented, true);
  assert.equal(lightbox.hidden, true, 'Escape closes lightbox cleanly');
  assert.equal(h.location.hash, '#projects', 'closing lightbox keeps the active dossier open');

  // 3. Research category pills smoothly roll down to the chosen section & pipeline diagrams inspect cleanly.
  h.route('#research');
  const awardsJump = h.select('[data-research-jump]').find(btn => btn.dataset.researchJump === 'awards');
  const awardsSection = h.select('[data-research-section]').find(s => s.dataset.researchSection === 'awards');
  const ippgSection = h.select('[data-research-section]').find(s => s.dataset.researchSection === 'ippg');
  awardsSection.getBoundingClientRect = () => ({ left: 0, top: 920, width: 600, height: 400 });
  h.click(awardsJump);
  assert.equal(awardsSection.hidden, false);
  assert.equal(ippgSection.hidden, false, 'all research sections remain visible while jumping');
  assert.equal(awardsJump.getAttribute('aria-pressed'), 'true');
  assert.equal(awardsSection.classList.contains('is-jump-target'), true);
  const researchLegs = h.select('.waypoint-leg').filter(leg => leg.isDescendantOf(h.id('research-filters')));
  assert.equal(researchLegs.length, 4);
  assert.ok(researchLegs.every(leg => leg.classList.contains('is-passed')), 'all preceding constellation legs light up when jumping to Awards');
  assert.equal(scrolls.at(-1).behavior, 'smooth');
  assert.ok(scrolls.at(-1).top > 0, 'smoothly rolls down to Research awards');
  h.click(h.select('.paper-pipeline')[0]);
  assert.equal(lightbox.hidden, false, 'clicking a pipeline diagram opens lightbox');
  assert.match(h.id('lightbox-img').getAttribute('src'), /^media\/paper-/);
  h.click(h.id('lightbox-close'));
  assert.equal(lightbox.hidden, true);

  // 4. About: interactive interest/hobby chips update terminal readouts & clicking Jack cards cuts deck.
  h.route('#about');
  const astroChip = h.select('.tag-chip').find(btn => btn.textContent.trim() === 'Astronomy');
  const researchReadout = h.id('about-research-note');
  h.click(astroChip);
  assert.equal(astroChip.getAttribute('aria-pressed'), 'true');
  assert.match(researchReadout.textContent, /\[ ASTRONOMY \]/);
  assert.equal(researchReadout.classList.contains('has-note'), true);
  h.click(astroChip);
  assert.equal(astroChip.getAttribute('aria-pressed'), 'false');
  assert.equal(researchReadout.classList.contains('has-note'), false);
  const beforeDeck = h.id('jack-front').textContent;
  h.click(h.select('.jack-art')[0]);
  assert.notEqual(h.id('jack-front').textContent, beforeDeck, 'clicking Jack cards deals/cuts immediately');

  // 5. Contact: Seoul KST clock, Copy email feedback, and linked channel-guide hover.
  h.route('#contact');
  assert.match(h.id('seoul-clock').textContent, /^\d{2}:\d{2} KST$/);
  const copyBtn = h.id('copy-email-btn');
  h.click(copyBtn);
  assert.match(copyBtn.textContent, /Copied: yeonjunkim70@gmail\.com/);
  assert.equal(copyBtn.classList.contains('is-copied'), true);
  const githubLink = h.select('[data-contact-channel]').find(el => el.dataset.contactChannel === 'github');
  const githubGuide = h.select('[data-guide-channel]').find(el => el.dataset.guideChannel === 'github');
  h.event(githubLink, 'pointerenter');
  assert.equal(githubGuide.classList.contains('is-active'), true, 'hovering a channel button highlights its guide column');
  h.event(githubLink, 'pointerleave');
  assert.equal(githubGuide.classList.contains('is-active'), false);
});

test("Audit polish regressions: no Contact wrap, Inspector flex pin, deduped About tags, mobile legend/flow and waypoint scroll fallback", () => {
  const h = harness({ hash: '#about' });
  // 1. Contact buttons never break channel names mid-word.
  assert.match(css, /#contact-links a:not\(\[href=""\]\)\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow-wrap:\s*normal/s, 'Contact buttons stay single-line without mid-word wraps');
  // 2. Target Inspector pins quick-contact shortcuts below scrollable inspector-records.
  assert.match(css, /\.inspector-panel\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.inspector-records\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.operator-links\s*\{[^}]*flex:\s*0 0 auto/s);
  // 3. About summary is crisp (<200 chars) and its two tag lists share zero duplicate labels.
  const aboutSummary = h.id('about').querySelector('.record-body').textContent.trim();
  assert.ok(aboutSummary.length > 40 && aboutSummary.length < 200, `About summary fits Inspector cleanly (${aboutSummary.length} chars)`);
  const tagLists = h.select('.tag-list').filter(list => list.isDescendantOf(h.id('about')));
  const researchTags = h.select('.tag-chip').filter(btn => btn.isDescendantOf(tagLists[0])).map(btn => btn.textContent.trim().toLowerCase());
  const hobbyTags = h.select('.tag-chip').filter(btn => btn.isDescendantOf(tagLists[1])).map(btn => btn.textContent.trim().toLowerCase());
  assert.equal(researchTags.filter(tag => hobbyTags.includes(tag)).length, 0, 'Research interests and hobbies have no duplicate chips');
  assert.ok(!hobbyTags.some(tag => tag.includes('astronomy') || tag.includes('physics')), 'Hobbies stay distinct from Research astronomy/physics chips');
  // 4. Star chart legend pairs wide/narrow grid readouts and keeps legend items intact.
  assert.match(html, /class="chart-wide">121&times;41 GRID \/\/ 1:1200 LY<\/span>/);
  assert.match(html, /class="chart-narrow">57&times;25 GRID \/\/ 1:1200 LY<\/span>/);
  assert.match(css, /\.legend-item\s*\{\s*white-space:\s*nowrap;\s*\}/);
  // 5. Mobile (<700px) drops nested vertical scrollbars, keeps heading 1-line, and centers Jack cards.
  const mobileBlock = css.slice(css.indexOf('@media (max-width: 700px)'));
  assert.match(mobileBlock, /\.console-heading #chart-title\s*\{[^}]*text-wrap:\s*nowrap/);
  assert.match(mobileBlock, /\.dossier-panel\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible/);
  assert.match(mobileBlock, /\.side-stack \.inspector-panel\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible/);
  assert.match(mobileBlock, /\.jack-art\s*\{[^}]*justify-self:\s*center/);
  // 6. When mobile dossier-panel is non-scrollable, waypoint jumps fall back to target.scrollIntoView().
  h.route('#projects');
  const dossierPanel = h.select('.dossier-panel')[0];
  dossierPanel.scrollHeight = 800;
  dossierPanel.clientHeight = 800;
  const intoViews = [];
  const personalGroup = h.select('[data-project-group]').find(el => el.dataset.projectGroup === 'personal');
  personalGroup.scrollIntoView = opts => intoViews.push(opts);
  const personalBtn = h.select('[data-project-jump]').find(btn => btn.dataset.projectJump === 'personal');
  h.click(personalBtn);
  assert.equal(intoViews.length, 1, 'mobile document-flow waypoint jump scrolls page via scrollIntoView');
  assert.equal(intoViews[0].behavior, 'smooth');
});
