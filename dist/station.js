/* Local classic-script controller for the SEL / SEOUL RX opening console.
   Every asynchronous stage belongs to one AbortController run. */
(() => {
  "use strict";
  const space = document.getElementById("space");
  const asciiIntroShell = document.getElementById("ascii-intro-shell");
  const terminal = document.getElementById("terminal");
  const decoder = document.getElementById("decoder");
  const message = document.getElementById("message");
  const skipButton = document.querySelector('[data-action="skip"]');
  const decodeButton = document.querySelector('[data-action="decode"]');
  const replayButton = document.querySelector('[data-action="replay"]');
  const portfolioLink = document.querySelector('[data-action="portfolio"]');
  const progress = document.getElementById("decode-progress");
  const percent = document.getElementById("decode-percent");
  const segments = document.getElementById("decode-segments");
  const decodeStep = document.getElementById("decode-step");
  const decodeSettled = document.getElementById("decode-settled");
  const decodeScrambled = document.getElementById("decode-scrambled");
  const decodePanel = document.getElementById("decode-panel");
  const spectrumScroll = document.getElementById("spectrum-scroll");
  const spectrumProbe = document.getElementById("spectrum-probe");
  const spectrumPlotWide = document.getElementById("spectrum-plot-wide");
  const spectrumPlotNarrow = document.getElementById("spectrum-plot-narrow");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const stages = [space, terminal, decoder, message];
  const DEFAULT_SPECTRUM_LABEL = "CARRIER / 0 kHz";
  let decodeBoost = false;
  const decodeRate = () => (decodeBoost ? 2.5 : 1);

  const quote = message.querySelector("blockquote").textContent.trim().replace(/\s+/g, " ");
  const payloadBytes = new TextEncoder().encode(quote).length;
  const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const characters = Array.from(quote);
  let bufferTick = -1;
  let settledCount = -1;

  function renderBuffer(value, elapsed) {
    const count = Math.floor((characters.length * value) / 100);
    const tick = motion.matches ? 0 : Math.floor(elapsed / 100);
    if (count === settledCount && tick === bufferTick) return;
    if (count !== settledCount) decodeSettled.textContent = characters.slice(0, count).join("");
    settledCount = count;
    bufferTick = tick;
    let suffix = "";
    for (let index = count; index < characters.length; index++) {
      if (characters[index] === " ") { suffix += " "; continue; }
      // Deterministic noise gives each cell its own sequence at a restrained 10 Hz.
      const noise = Math.imul(index + 1, 374761393) ^ Math.imul(tick + 1, 668265263);
      suffix += motion.matches ? "X" : glyphs[(noise >>> 0) % glyphs.length];
    }
    if (decodeScrambled.textContent !== suffix) decodeScrambled.textContent = suffix;
  }

  let sessionUTC = "";
  let receiveUTC = "";

  function writeAll(selector, value) {
    for (const node of document.querySelectorAll(selector)) {
      node.textContent = value;
      if (selector === "[data-session-utc]" || selector === "[data-receive-utc]") {
        if (value.endsWith(" UTC")) node.setAttribute("datetime", value.replace(" ", "T").replace(" UTC", "Z"));
        else node.removeAttribute("datetime");
      }
    }
  }

  function utcNow() {
    return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  }

  function receiveLog(state, eventUTC = receiveUTC) {
    const log = document.getElementById("receive-log");
    log.replaceChildren();
    for (const line of [
      `${sessionUTC.slice(11)}  Receive session opened.`,
      `${receiveUTC.slice(11)}  Signal captured / ${payloadBytes} bytes buffered.`,
      `${eventUTC.slice(11)}  ${state}`,
    ]) {
      const entry = document.createElement("li");
      entry.textContent = line;
      log.append(entry);
    }
  }

  function capture() {
    if (receiveUTC) return;
    receiveUTC = utcNow();
    writeAll("[data-receive-utc]", receiveUTC);
    receiveLog("Capture held. Decode ready.");
  }

  function configureReceiver() {
    writeAll("[data-station-name]", "SEL / SEOUL RX");
    writeAll("[data-receiver-name]", "Seoul, South Korea");
    writeAll("[data-receiver-coordinates]", "37.5665 N / 126.9780 E");
    writeAll("[data-payload-bytes]", String(payloadBytes));
  }

  // One fixed captured spectrum. Both layouts and the live probe sample the same 65-bin capture.
  const capturedPower = Array.from({ length: 65 }, (_, bin) => {
    const hash = Math.sin((bin + 17) * 127.1) * 43758.5453;
    const noise = 1 + Math.floor((hash - Math.floor(hash)) * 3);
    const offset = Math.abs(bin - 32);
    const carrier = [12, 10, 7, 5, 3][offset] || 0;
    return Math.max(noise, carrier);
  });

  function drawSpectrum(width = 65, suffix = "") {
    const height = 13;
    const grid = [], trace = [];
    for (let row = 0; row < height; row++) {
      let background = "", signal = "";
      for (let column = 0; column < width; column++) {
        const position = Math.round((column * 64) / (width - 1));
        const axis = column % ((width - 1) / 4) === 0;
        const horizontal = row === 0 || row === 6 || row === 12;
        background += axis ? (horizontal ? "+" : "\u2502") : (horizontal ? "\u2500" : " ");
        const power = capturedPower[position];
        const level = height - 1 - power;
        signal += row === level ? "\u2584" : (row > level ? "\u2591" : " ");
      }
      grid.push(background);
      trace.push(signal);
    }
    document.getElementById(`spectrum-grid${suffix}`).textContent = grid.join("\n");
    document.getElementById(`spectrum-trace${suffix}`).textContent = trace.join("\n");
    const labels = Array(width).fill(" ");
    for (const [index, label] of ["-4", "-2", "0", "+2", "+4"].entries()) {
      const tick = (index * (width - 1)) / 4;
      const start = Math.max(0, Math.min(width - label.length, tick - Math.floor(label.length / 2)));
      for (let character = 0; character < label.length; character++) labels[start + character] = label[character];
    }
    const caption = "RELATIVE OFFSET / kHz";
    document.getElementById(`spectrum-axis${suffix}`).textContent =
      labels.join("") + "\n" + " ".repeat(Math.floor((width - caption.length) / 2)) + caption;
  }

  function spectrumProbeRect() {
    for (const candidate of [spectrumPlotWide, spectrumPlotNarrow, spectrumScroll]) {
      if (candidate && typeof candidate.getBoundingClientRect === "function") {
        const rect = candidate.getBoundingClientRect();
        if (rect && rect.width > 0) return rect;
      }
    }
    return null;
  }

  function resetSpectrumProbe() {
    if (spectrumProbe) {
      spectrumProbe.textContent = DEFAULT_SPECTRUM_LABEL;
      spectrumProbe.classList?.remove("is-probing");
    }
    spectrumScroll?.classList?.remove("is-probing");
  }

  function updateSpectrumProbe(event) {
    if (!spectrumScroll || !spectrumProbe || document.body.dataset.stage !== "terminal") return;
    if (event.pointerType === "touch" || typeof event.clientX !== "number") return;
    const rect = spectrumProbeRect();
    if (!rect || rect.width <= 0) return;
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const rawKhz = fraction * 8 - 4;
    const magKhz = Math.round(Math.abs(rawKhz) * 10) / 10;
    const sign = rawKhz < 0 && magKhz > 0 ? "-" : "+";
    const pos = fraction * 64;
    const low = Math.floor(pos);
    const high = Math.min(64, Math.ceil(pos));
    const power = capturedPower[low] * (1 - (pos - low)) + capturedPower[high] * (pos - low);
    const db = -1.2 - (12 - power) * 1.65;
    spectrumProbe.textContent = `PROBE ${sign}${magKhz.toFixed(1)} kHz // ${db.toFixed(1)} dB`;
    spectrumProbe.classList?.add("is-probing");
    spectrumScroll.classList?.add("is-probing");
    if (spectrumScroll.style && typeof spectrumScroll.style.setProperty === "function") {
      spectrumScroll.style.setProperty("--probe-x", `${(fraction * 100).toFixed(2)}%`);
    }
  }

  configureReceiver();
  drawSpectrum();
  drawSpectrum(37, "-narrow");

  let run = null;
  let intro = null;

  function rememberMessage() {
    try {
      history.replaceState(
        { ...history.state, transmissionRead: true, transmissionTiming: { sessionUTC, receiveUTC } },
        "",
      );
    } catch (_) {
      /* Reading remains usable on hosts with restricted history. */
    }
  }

  function setStage(name) {
    document.body.dataset.stage = name;
  }

  function resetProgress(value, elapsed = 0) {
    renderBuffer(value, elapsed);
    progress.value = value;
    progress.textContent = `${value}%`;
    progress.setAttribute("aria-valuetext", `${value}% decoded`);
    percent.textContent = `${value}%`;
    const filled = Math.floor((value * 32) / 100);
    segments.textContent = `[${"\u2588".repeat(filled)}${"\u2591".repeat(32 - filled)}]`;
    const step =
      value === 100
        ? "Decode complete. Opening message."
        : value < 35
          ? "Reading receive buffer."
          : value < 75
            ? "Decoding UTF-8 payload."
            : "Preparing message.";
    if (decodeStep.textContent !== step) decodeStep.textContent = step;
    const state = document.getElementById("decoder-state");
    const complete = value === 100;
    state.textContent = complete ? "COMPLETE" : decodeBoost ? "DECODING // FAST" : "DECODING";
    state.classList?.toggle("is-boosted", decodeBoost && !complete);
    decodePanel?.classList?.toggle("is-boosted", decodeBoost && !complete);
    decodePanel?.classList?.toggle("is-complete", complete);
  }

  function boostDecode() {
    if (!run || document.body.dataset.stage !== "decoding" || decoder.hidden || decodeBoost || progress.value >= 100) return;
    decodeBoost = true;
    const state = document.getElementById("decoder-state");
    if (state) {
      state.textContent = "DECODING // FAST";
      state.classList?.add("is-boosted");
    }
    decodePanel?.classList?.add("is-boosted");
  }

  function isInteractiveFocus(node) {
    const tag = node?.tagName?.toUpperCase();
    return tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function only(stage) {
    for (const item of stages) {
      item.hidden = item !== stage;
      item.inert = item !== stage;
    }
  }

  function disposeIntro() {
    if (!intro) return;
    const old = intro;
    intro = null;
    try {
      old.dispose();
    } catch (_) {
      /* A failed intro renderer must not trap navigation. */
    }
  }

  // Count visible time so crossfades and decoding pause while the tab is hidden.
  function visibleTime(duration, signal, update, rate = null) {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      let frame = 0;
      let previous = null;
      let elapsed = 0;
      function finish(result) {
        cancelAnimationFrame(frame);
        signal.removeEventListener("abort", abort);
        resolve(result);
      }
      function abort() {
        finish(false);
      }
      function tick(now) {
        if (signal.aborted) return finish(false);
        if (!document.hidden) {
          if (previous !== null) elapsed += Math.min(now - previous, 100) * (rate ? rate() : 1);
          if (update) update(Math.min(elapsed / duration, 1), elapsed);
        }
        previous = document.hidden ? null : now;
        if (elapsed >= duration) return finish(true);
        frame = requestAnimationFrame(tick);
      }
      signal.addEventListener("abort", abort, { once: true });
      frame = requestAnimationFrame(tick);
    });
  }

  function restoreMessage() {
    const saved = history.state?.transmissionTiming;
    sessionUTC = saved?.sessionUTC || sessionUTC || utcNow();
    receiveUTC = saved?.receiveUTC || receiveUTC || sessionUTC;
    writeAll("[data-session-utc]", sessionUTC);
    writeAll("[data-receive-utc]", receiveUTC);
    if (run) run.abort();
    run = new AbortController();
    disposeIntro();
    only(message);
    message.style.opacity = "1";
    setStage("message");
    replayButton.disabled = false;
    message.querySelector("blockquote").focus({ preventScroll: true });
  }

  function openTerminal() {
    capture();
    resetSpectrumProbe();
    only(terminal);
    terminal.scrollTop = 0;
    terminal.style.opacity = "1";
    disposeIntro();
    setStage("terminal");
    decodeButton.disabled = false;
    decodeButton.focus({ preventScroll: true });
  }

  function skipIntro() {
    const stage = document.body.dataset.stage;
    if (!run || (stage !== "space" && stage !== "arrival")) return;
    run.abort();
    run = new AbortController();
    openTerminal();
  }

  async function arrive(signal) {
    if (signal.aborted || document.body.dataset.stage !== "space") return;
    capture();
    setStage("arrival");
    terminal.hidden = false;
    terminal.scrollTop = 0;
    terminal.inert = true;
    decodeButton.disabled = true;
    if (
      !(await visibleTime(motion.matches ? 200 : 700, signal, (fraction) => {
        terminal.style.opacity = String(fraction * fraction * (3 - 2 * fraction));
      }))
    )
      return;
    openTerminal();
  }

  async function decode() {
    if (!run || document.body.dataset.stage !== "terminal" || decodeButton.disabled) return;
    const signal = run.signal;
    decodeBoost = false;
    resetSpectrumProbe();
    receiveLog("Decoder started by operator.", utcNow());
    decodeButton.disabled = true;
    setStage("decoding");
    resetProgress(0);
    terminal.inert = true;
    if (
      !(await visibleTime(motion.matches ? 80 : 380, signal, (fraction) => {
        terminal.style.opacity = String(1 - fraction);
      }))
    )
      return;
    only(decoder);
    decoder.style.opacity = "1";
    decoder.querySelector(".decoder-content").focus({ preventScroll: true });
    if (
      !(await visibleTime(
        motion.matches ? 950 : 3100,
        signal,
        (fraction, elapsed) => {
          resetProgress(Math.min(99, Math.floor(fraction * 100)), elapsed);
        },
        decodeRate,
      ))
    )
      return;
    resetProgress(100);
    // Give 100% its own visible hold before opening the decoded message.
    if (!(await visibleTime(1000, signal, null, decodeRate))) return;
    decodeBoost = false;
    if (
      !(await visibleTime(motion.matches ? 80 : 350, signal, (fraction) => {
        decoder.style.opacity = String(1 - fraction);
      }))
    )
      return;
    message.style.opacity = "0";
    replayButton.disabled = true;
    only(message);
    setStage("message");
    if (
      !(await visibleTime(motion.matches ? 80 : 650, signal, (fraction) => {
        message.style.opacity = String(fraction);
      }))
    )
      return;
    replayButton.disabled = false;
    message.querySelector("blockquote").focus({ preventScroll: true });
  }

  function showLoadFailure() {
    setStage("unavailable");
    if (asciiIntroShell) asciiIntroShell.hidden = true;
    const shell = document.createElement("div");
    shell.className = "console-shell load-failure";
    const title = document.createElement("h1");
    title.textContent = "Transmission unavailable";
    const actions = document.createElement("div");
    actions.className = "load-failure-actions";
    const open = document.createElement("a");
    open.className = "command portfolio-link";
    open.setAttribute("href", "portfolio.html");
    open.textContent = "Open portfolio";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "intro-btn";
    retry.textContent = "Reload transmission";
    retry.addEventListener("click", () => location.reload());
    actions.append(open, retry);
    shell.append(title, actions);
    space.append(shell);
    open.focus({ preventScroll: true });
  }

  function start() {
    try {
      const { transmissionTiming, ...state } = history.state || {};
      history.replaceState({ ...state, transmissionRead: false }, "");
    } catch (_) {}
    if (run) run.abort();
    disposeIntro();
    run = new AbortController();
    sessionUTC = utcNow();
    receiveUTC = "";
    writeAll("[data-session-utc]", sessionUTC);
    writeAll("[data-receive-utc]", "Awaiting capture");
    const signal = run.signal;
    decodeBoost = false;
    resetSpectrumProbe();
    document.getElementById("receive-log").replaceChildren();
    decodeButton.disabled = true;
    terminal.style.opacity = "0";
    resetProgress(0);
    only(space);
    setStage("space");
    if (asciiIntroShell) asciiIntroShell.hidden = false;
    space.querySelector(".load-failure")?.remove();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const onArrival = () => {
      void arrive(signal);
    };
    try {
      if (!window.SignalAsciiIntro || typeof window.SignalAsciiIntro.start !== "function") {
        showLoadFailure();
      } else {
        intro = window.SignalAsciiIntro.start(asciiIntroShell, {
          reducedMotion: motion.matches,
          onArrival,
        });
      }
    } catch (_) {
      if (!signal.aborted) showLoadFailure();
    }
  }

  portfolioLink.addEventListener("click", rememberMessage);
  skipButton.addEventListener("click", skipIntro);
  if (spectrumScroll) {
    spectrumScroll.addEventListener("pointermove", updateSpectrumProbe);
    spectrumScroll.addEventListener("pointerleave", resetSpectrumProbe);
    spectrumScroll.addEventListener("pointercancel", resetSpectrumProbe);
  }
  if (decodePanel) {
    decodePanel.addEventListener("click", boostDecode);
  }
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const stage = document.body.dataset.stage;
    if (event.key === "Escape" && (stage === "space" || stage === "arrival") && run) {
      event.preventDefault();
      skipIntro();
    } else if (
      (event.key === " " || event.code === "Space") &&
      stage === "decoding" &&
      run &&
      !decoder.hidden &&
      progress.value < 100 &&
      !isInteractiveFocus(document.activeElement)
    ) {
      event.preventDefault();
      boostDecode();
    } else if (
      event.key === "Enter" &&
      stage === "message" &&
      document.activeElement === message.querySelector("blockquote")
    ) {
      event.preventDefault();
      rememberMessage();
      location.assign(portfolioLink.getAttribute("href"));
    }
  });
  decodeButton.addEventListener("click", () => {
    void decode();
  });
  replayButton.addEventListener("click", () => {
    if (document.body.dataset.stage === "message" && !replayButton.disabled) start();
  });

  // Legacy portfolio fragments never bypass the opening or create blank stages.
  function clearHash() {
    if (!location.hash) return;
    try {
      history.replaceState(null, "", location.href.split("#")[0]);
    } catch (_) {
      /* file:// host */
    }
  }
  window.addEventListener("hashchange", clearHash);
  window.addEventListener("pagehide", () => {
    if (run) run.abort();
    disposeIntro();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      if (document.body.dataset.stage === "message") restoreMessage();
      else start();
    }
  });

  clearHash();
  if (history.state?.transmissionRead) restoreMessage();
  else start();
})();
