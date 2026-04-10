/**
 * LESCO Translator - content.js  v3
 * ===================================
 * Fixes:
 * - Panel stays visible always (never auto-hides)
 * - MutationObserver re-attaches when Meet recreates the captions container
 * - Timeline auto-scrolls to keep active chip in view
 * - Sequential video playback with hover-to-replay
 * - Unknown words are finger-spelled letter by letter
 */

"use strict";

// ─── Config ────────────────────────────────────────────────────────────────

const CAPTION_SELECTOR = ".ygicle";
const CAPTIONS_REGION  = '[aria-label="Captions"]';
const PANEL_ID         = "lesco-overlay-panel";
const DICT_PATH        = chrome.runtime.getURL("data/lesco_dictionary.json");
const LETTER_IMG_BASE  = "https://lesco.cenarec.go.cr/assets/thumbnail/forma/CM_";
const LETTER_MS        = 900;   // ms per finger-spell letter

// ─── State ─────────────────────────────────────────────────────────────────

let dictionary   = {};
let lastText     = "";
let signQueue    = [];
let currentIdx   = 0;
let playTimer    = null;
let captionObserver = null;
let watchdogTimer   = null;

// ─── Normalize / lookup ────────────────────────────────────────────────────

function normalize(word) {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function tokenize(text) {
  return text.split(/\s+/).filter(w => w.length > 0);
}

function findInDictionary(word) {
  const norm = normalize(word);
  if (!norm) return null;
  if (dictionary[norm]) return dictionary[norm];
  const candidates = [
    norm.endsWith("s")     ? norm.slice(0, -1)        : null,
    norm.endsWith("es")    ? norm.slice(0, -2)        : null,
    norm.endsWith("ando")  ? norm.slice(0, -4) + "ar" : null,
    norm.endsWith("iendo") ? norm.slice(0, -5) + "er" : null,
    norm.endsWith("mente") ? norm.slice(0, -5)        : null,
  ];
  for (const c of candidates) {
    if (c && dictionary[c]) return dictionary[c];
  }
  return null;
}

function spellWord(rawWord) {
  return rawWord.toUpperCase().replace(/[^A-Z]/g, "").split("")
    .map(l => ({ type: "letter", letter: l, rawWord }));
}

function buildQueue(text) {
  const items = [];
  for (const rawWord of tokenize(text)) {
    const entry = findInDictionary(rawWord);
    if (entry && entry.video_url) {
      items.push({ type: "sign", entry, rawWord });
    } else {
      const spelled = spellWord(rawWord);
      if (spelled.length > 0) items.push(...spelled);
    }
  }
  return items;
}

// ─── Panel ─────────────────────────────────────────────────────────────────

function createPanel() {
  if (document.getElementById(PANEL_ID)) return;
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div id="lesco-header">
      <span>🤟 LESCO</span>
      <div id="lesco-header-controls">
        <span id="lesco-word-label"></span>
        <button id="lesco-close-btn" title="Cerrar">✕</button>
      </div>
    </div>
    <div id="lesco-main-view">
      <div id="lesco-active-sign">
        <div class="lesco-idle">Esperando subtítulos...</div>
      </div>
    </div>
    <div id="lesco-timeline"></div>
    <div id="lesco-status"></div>
  `;
  document.body.appendChild(panel);

  // Close button hides panel — it reappears on next caption
  document.getElementById("lesco-close-btn").addEventListener("click", () => {
    panel.dataset.closedByUser = "1";
    panel.style.display = "none";
  });

  makeDraggable(panel);
}

function makeDraggable(el) {
  const header = el.querySelector("#lesco-header");
  let dragging = false, sx, sy, ox, oy;
  header.addEventListener("mousedown", e => {
    if (e.target.closest("button")) return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
    e.preventDefault();
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    el.style.left = `${ox + e.clientX - sx}px`;
    el.style.top  = `${oy + e.clientY - sy}px`;
    el.style.right = "unset"; el.style.bottom = "unset";
  });
  document.addEventListener("mouseup", () => { dragging = false; });
}

// Show panel — always, unless user explicitly closed it this session
function ensurePanelVisible() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  // Always show when new content arrives, even if user closed it
  panel.style.display = "flex";
  delete panel.dataset.closedByUser;
}

function setStatus(msg) {
  const el = document.getElementById("lesco-status");
  if (el) el.textContent = msg;
}

function setWordLabel(text) {
  const el = document.getElementById("lesco-word-label");
  if (el) el.textContent = text;
}

// ─── Active sign view ──────────────────────────────────────────────────────

function renderActiveSign(item) {
  const container = document.getElementById("lesco-active-sign");
  if (!container) return;
  container.innerHTML = "";

  if (item.type === "sign") {
    const video = document.createElement("video");
    video.src = item.entry.video_url;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.className = "lesco-active-video";
    video.addEventListener("ended", () => advanceQueue());
    video.addEventListener("error", () => setTimeout(() => advanceQueue(), 300));
    container.appendChild(video);
    setWordLabel(item.rawWord);

  } else {
    // Finger-spell letter
    const img = document.createElement("img");
    img.src = `${LETTER_IMG_BASE}${item.letter}.jpg`;
    img.className = "lesco-active-letter";
    img.alt = item.letter;
    img.onerror = () => { img.style.display = "none"; };
    container.appendChild(img);

    const badge = document.createElement("div");
    badge.className = "lesco-letter-badge";
    badge.textContent = item.letter;
    container.appendChild(badge);

    setWordLabel(`✍️ ${item.rawWord}`);
    if (playTimer) clearTimeout(playTimer);
    playTimer = setTimeout(() => advanceQueue(), LETTER_MS);
  }
}

// ─── Timeline ──────────────────────────────────────────────────────────────

function renderTimeline() {
  const tl = document.getElementById("lesco-timeline");
  if (!tl) return;
  tl.innerHTML = "";

  // Group consecutive letters of same word into one chip
  const chips = [];
  let i = 0;
  while (i < signQueue.length) {
    const item = signQueue[i];
    if (item.type === "sign") {
      chips.push({ indices: [i], label: item.rawWord, type: "sign" });
      i++;
    } else {
      const word = item.rawWord;
      const group = [];
      while (i < signQueue.length && signQueue[i].type === "letter" && signQueue[i].rawWord === word) {
        group.push(i); i++;
      }
      chips.push({ indices: group, label: word, type: "spell" });
    }
  }

  let activeEl = null;

  chips.forEach(chip => {
    const isActive = chip.indices.includes(currentIdx);
    const isPast   = chip.indices[chip.indices.length - 1] < currentIdx;

    const el = document.createElement("div");
    el.className = "lesco-chip" +
      (isActive ? " lesco-chip-active" : "") +
      (isPast   ? " lesco-chip-past"   : "") +
      (chip.type === "spell" ? " lesco-chip-spell" : "");
    el.textContent = chip.label;
    el.title = chip.type === "spell" ? `✍️ deletreando "${chip.label}"` : chip.label;

    if (isPast || isActive) {
      el.addEventListener("mouseenter", () => jumpTo(chip.indices[0]));
    }

    tl.appendChild(el);
    if (isActive) activeEl = el;
  });

  // Scroll active chip into view within the timeline
  if (activeEl) {
    activeEl.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }
}

// ─── Playback control ──────────────────────────────────────────────────────

function startQueue() {
  currentIdx = 0;
  playCurrentItem();
}

function advanceQueue() {
  if (currentIdx < signQueue.length - 1) {
    currentIdx++;
    playCurrentItem();
  } else {
    // End of queue — stay on last item
    renderTimeline();
    setStatus("✓ Fin de frase");
  }
}

function jumpTo(idx) {
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  currentIdx = idx;
  playCurrentItem();
}

function playCurrentItem() {
  if (!signQueue.length) return;
  renderActiveSign(signQueue[currentIdx]);
  renderTimeline();

  const signs   = signQueue.filter(x => x.type === "sign").length;
  const letters = signQueue.filter(x => x.type === "letter").length;
  setStatus(`${currentIdx + 1} / ${signQueue.length}  ·  ${signs} seña${signs !== 1 ? "s" : ""}  ·  ${letters} letra${letters !== 1 ? "s" : ""} deletreadas`);
}

// ─── Caption handling ──────────────────────────────────────────────────────

function handleNewCaption(text) {
  if (text === lastText) return;
  lastText = text;

  const newQueue = buildQueue(text);
  if (!newQueue.length) return;

  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  signQueue = newQueue;

  ensurePanelVisible();
  startQueue();
}

// ─── Caption observer — with watchdog to re-attach if Meet recreates DOM ──

function attachCaptionObserver() {
  const region = document.querySelector(CAPTIONS_REGION);
  if (!region) return false;

  if (captionObserver) captionObserver.disconnect();

  captionObserver = new MutationObserver(() => {
    const divs = document.querySelectorAll(CAPTION_SELECTOR);
    const text = Array.from(divs)
      .map(el => el.textContent.trim())
      .filter(t => t.length > 0)
      .join(" ");
    if (text) handleNewCaption(text);
  });

  captionObserver.observe(region, {
    childList: true, subtree: true, characterData: true,
  });

  console.log("[LESCO] Observer attached ✅");
  return true;
}

function startWatchdog() {
  // Every 2 seconds check if the captions region still exists and observer is live.
  // Meet often recreates the captions container between utterances.
  watchdogTimer = setInterval(() => {
    const region = document.querySelector(CAPTIONS_REGION);
    if (!region) {
      // Captions turned off — disconnect and wait
      if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
      return;
    }
    // Region exists — make sure we're still observing it
    if (!captionObserver) {
      attachCaptionObserver();
    }
  }, 2000);
}

function startObserving() {
  // Try immediately, then keep a watchdog running
  if (!attachCaptionObserver()) {
    // Not ready yet — retry until found
    const retry = setInterval(() => {
      if (attachCaptionObserver()) {
        clearInterval(retry);
        startWatchdog();
      }
    }, 1500);
  } else {
    startWatchdog();
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────

async function init() {
  try {
    const resp = await fetch(DICT_PATH);
    dictionary = await resp.json();
    console.log(`[LESCO] Dictionary loaded: ${Object.keys(dictionary).length} entries`);
  } catch (err) {
    console.error("[LESCO] Failed to load dictionary:", err);
  }

  createPanel();
  ensurePanelVisible();   // show immediately on load
  startObserving();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
