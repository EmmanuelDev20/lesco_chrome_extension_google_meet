/**
 * LESCO Translator - content.js  v6
 *
 * Novedades:
 * - Video Cache API: los videos se cachean en disco al reproducirse
 * - Prefetch: mientras se reproduce el clip actual, descarga los siguientes 3
 * - Pre-caché de instalación: la primera vez descarga ~80 palabras comunes
 * - Sesiones: cada reunión se guarda en chrome.storage.local (sin borrado)
 */
"use strict";

// ─── Config ────────────────────────────────────────────────────────────────
const CAPTION_SELECTOR  = ".ygicle";
const CAPTIONS_REGION   = '[aria-label="Captions"]';
const PANEL_ID          = "lesco-overlay-panel";
const DICT_PATH         = chrome.runtime.getURL("data/lesco_dictionary.json");
const LETTER_IMG_BASE   = "https://lesco.cenarec.go.cr/assets/thumbnail/forma/CM_";
const LETTER_MS         = 900;
const VIDEO_CACHE_NAME  = "lesco-videos-v1";
const PREFETCH_COUNT    = 3;
const MAX_SESSIONS      = 50;   // máximo de sesiones guardadas

// Palabras más comunes en conversación — se pre-cachean al instalar
const COMMON_WORDS = [
  "hola","gracias","perdon","bienvenido",
  "yo","tu","nosotros","ustedes",
  "querer","poder","hablar","escuchar","entender","saber","conocer",
  "ver","hacer","decir","pensar","trabajar","ir","venir",
  "tener","necesitar","ayudar","llamar","vivir","comer","aprender","estudiar",
  "hoy","manana","ayer","ahora","despues","antes","siempre","nunca",
  "lunes","martes","miercoles","jueves","viernes","sabado","domingo",
  "enero","febrero","marzo","abril","mayo","junio",
  "julio","agosto","septiembre","octubre","noviembre","diciembre",
  "si","no","bien","mal",
  "bueno","malo","mucho","poco","grande","nuevo","importante","diferente",
  "casa","trabajo","familia","persona","tiempo","dia","lugar",
  "dinero","problema","reunion","computadora","telefono","correo",
  "uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez",
  "como","cuando","donde","quien","cuanto",
  "rojo","azul","verde","blanco","negro","amarillo",
  "comer","beber","dormir","caminar","correr","escribir","leer",
  "abrir","cerrar","entrar","salir","esperar","comenzar","terminar",
];

// ─── State ─────────────────────────────────────────────────────────────────
let dictionary      = {};
let lastText        = "";
let lastGloss       = "";
let signQueue       = [];
let currentIdx      = 0;
let playTimer       = null;
let captionObserver = null;
let advanceLock     = false;
let currentBlobUrl  = null;   // para revocar el blob anterior y evitar memory leaks

// Sesión actual
let currentSession  = null;

// ─── Video Cache ───────────────────────────────────────────────────────────

/**
 * Devuelve la URL del video.
 * Si ya está cacheado, devuelve un blob:// URL (instantáneo).
 * Si no, lo descarga, lo cachea y devuelve la URL directa mientras tanto.
 */
async function getVideoSrc(url) {
  try {
    const cache    = await caches.open(VIDEO_CACHE_NAME);
    const cached   = await cache.match(url);
    if (cached) {
      const blob   = await cached.blob();
      return URL.createObjectURL(blob);
    }
    // No está en caché — fetch y cachear en paralelo, devolver URL directa
    fetch(url).then(async r => {
      if (r.ok) {
        const c = await caches.open(VIDEO_CACHE_NAME);
        await c.put(url, r);
      }
    }).catch(() => {});
    return url;
  } catch {
    return url;
  }
}

/**
 * Descarga en segundo plano los próximos PREFETCH_COUNT videos de la cola.
 */
async function prefetchVideos(queue, fromIdx) {
  for (let i = fromIdx; i < Math.min(fromIdx + PREFETCH_COUNT, queue.length); i++) {
    const item = queue[i];
    if (item.type !== "sign" || !item.entry?.video_url) continue;
    try {
      const cache  = await caches.open(VIDEO_CACHE_NAME);
      const exists = await cache.match(item.entry.video_url);
      if (!exists) {
        const r = await fetch(item.entry.video_url);
        if (r.ok) await cache.put(item.entry.video_url, r);
      }
    } catch {}
  }
}

/**
 * Primera vez que corre la extensión: cachea las palabras comunes.
 */
async function initPreCache() {
  const { lesco_precache_done } = await chrome.storage.local.get("lesco_precache_done");
  if (lesco_precache_done) return;

  console.log("[LESCO] Iniciando pre-caché de palabras comunes...");
  const cache = await caches.open(VIDEO_CACHE_NAME);
  let count = 0;

  for (const word of COMMON_WORDS) {
    const entry = dictionary[word];
    if (!entry?.video_url) continue;
    try {
      const exists = await cache.match(entry.video_url);
      if (!exists) {
        const r = await fetch(entry.video_url);
        if (r.ok) { await cache.put(entry.video_url, r); count++; }
      }
    } catch {}
  }

  await chrome.storage.local.set({ lesco_precache_done: true });
  console.log(`[LESCO] Pre-caché completado: ${count} videos guardados`);
}

// ─── Session management ────────────────────────────────────────────────────

function startSession() {
  const now = new Date();
  currentSession = {
    id:        now.getTime(),
    startedAt: now.getTime(),
    endedAt:   null,
    date:      now.toLocaleDateString("es-CR"),
    startTime: now.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" }),
    phrases:   [],
  };
}

async function savePhrase(spanish, glossTokens, items) {
  if (!currentSession) return;
  // Guardar solo señas con video (no letras deletreadas, esas se reconstruyen)
  const signs = items
    .filter(i => i.type === "sign" && i.entry?.video_url)
    .map(i => ({ word: i.rawWord, video_url: i.entry.video_url }));

  currentSession.phrases.push({
    t: Date.now(),
    spanish,
    gloss:  glossTokens,
    signs,
  });
  await flushSession();
}

async function flushSession(isEnd = false) {
  if (!currentSession) return;
  if (isEnd) currentSession.endedAt = Date.now();

  try {
    const { lesco_sessions = [] } = await chrome.storage.local.get("lesco_sessions");

    // Reemplazar o agregar la sesión actual
    const idx = lesco_sessions.findIndex(s => s.id === currentSession.id);
    if (idx >= 0) {
      lesco_sessions[idx] = currentSession;
    } else {
      lesco_sessions.unshift(currentSession);
    }

    // Limitar a MAX_SESSIONS
    if (lesco_sessions.length > MAX_SESSIONS) lesco_sessions.length = MAX_SESSIONS;

    await chrome.storage.local.set({ lesco_sessions });
  } catch (e) {
    console.warn("[LESCO] Error guardando sesión:", e);
  }
}

// Guardar sesión al cerrar la pestaña
window.addEventListener("beforeunload", () => flushSession(true));

// ─── Gloss conversion ──────────────────────────────────────────────────────

const DROP_WORDS = new Set([
  "el","la","los","las","un","una","unos","unas","lo",
  "de","del","en","a","al","con","por","para","sin","sobre",
  "entre","hasta","desde","hacia","ante","bajo","segun","tras",
  "mediante","durante",
  "y","e","o","u","ni","pero","sino","que","porque","como",
  "si","cuando","aunque","mientras","pues","entonces","ademas",
  "tambien","tampoco",
  "es","son","era","eran","fue","fueron","ser","estar","sido",
  "estado","esta","estan","estaba","estaban","hay","haber",
  "he","has","ha","han","hemos","habia","habian",
  "cual","cuales","quien","quienes",
  "me","te","se","le","les","nos","os",
]);

const TIME_WORDS = new Set([
  "hoy","ayer","manana","ahora","despues","antes","luego","siempre",
  "nunca","jamas","tarde","temprano","pronto","recien","ya","todavia",
  "aun","anteayer","pasado","proximo","proxima",
]);

const VERB_MAP = {
  "soy":"ser","eres":"ser","somos":"ser",
  "estoy":"estar","estas":"estar","estamos":"estar","estaba":"estar","estaban":"estar",
  "tengo":"tener","tienes":"tener","tiene":"tener","tienen":"tener","tenia":"tener",
  "voy":"ir","vas":"ir","va":"ir","vamos":"ir","van":"ir","iba":"ir","fue":"ir",
  "hago":"hacer","haces":"hacer","hace":"hacer","hacen":"hacer","hizo":"hacer",
  "quiero":"querer","quieres":"querer","quiere":"querer","quieren":"querer","queria":"querer",
  "puedo":"poder","puedes":"poder","puede":"poder","pueden":"poder","podia":"poder",
  "digo":"decir","dices":"decir","dice":"decir","dicen":"decir","dijo":"decir",
  "vengo":"venir","vienes":"venir","viene":"venir","vienen":"venir","vino":"venir",
  "se":"saber","sabes":"saber","sabe":"saber","saben":"saber","sabia":"saber",
  "veo":"ver","ves":"ver","ve":"ver","vemos":"ver","ven":"ver","veia":"ver",
  "doy":"dar","das":"dar","da":"dar","damos":"dar","dan":"dar","dio":"dar",
  "llevo":"llevar","llevas":"llevar","lleva":"llevar",
  "llamo":"llamar","llamas":"llamar","llama":"llamar","llaman":"llamar",
  "necesito":"necesitar","necesitas":"necesitar","necesita":"necesitar","necesitan":"necesitar",
  "gusta":"gustar","gustan":"gustar","gusto":"gustar",
  "pienso":"pensar","piensas":"pensar","piensa":"pensar","piensan":"pensar",
  "vivo":"vivir","vives":"vivir","vive":"vivir","viven":"vivir",
  "trabajo":"trabajar","trabajas":"trabajar","trabaja":"trabajar","trabajan":"trabajar",
  "hablo":"hablar","hablas":"hablar","habla":"hablar","hablan":"hablar","hable":"hablar",
  "como":"comer","comes":"comer","come":"comer","comen":"comer","comio":"comer",
  "entiendo":"entender","entiendes":"entender","entiende":"entender","entienden":"entender",
  "conozco":"conocer","conoces":"conocer","conoce":"conocer","conocen":"conocer",
  "aprendo":"aprender","aprendes":"aprender","aprende":"aprender","aprenden":"aprender",
};

function verbToInfinitive(word) {
  if (word.endsWith("ando"))  return word.slice(0,-4)+"ar";
  if (word.endsWith("iendo")) return word.slice(0,-5)+"er";
  if (word.endsWith("yendo")) return word.slice(0,-5)+"er";
  if (word.endsWith("ado"))   return word.slice(0,-3)+"ar";
  if (word.endsWith("ido"))   return word.slice(0,-3)+"ir";
  if (word.endsWith("aba"))   return word.slice(0,-3)+"ar";
  if (word.endsWith("aron"))  return word.slice(0,-4)+"ar";
  if (word.endsWith("ieron")) return word.slice(0,-5)+"ir";
  return null;
}

function spanishToGloss(text) {
  const raw = text.toLowerCase().trim()
    .replace(/[¿¡.,;:!?()"«»]/g,"")
    .split(/\s+/).filter(w => w.length > 0);

  const timeFront = [], main = [];

  for (const word of raw) {
    if (DROP_WORDS.has(word)) continue;
    const mapped   = VERB_MAP[word];
    const resolved = mapped || word;
    if (TIME_WORDS.has(resolved)) { timeFront.push(resolved); continue; }
    const inf = !mapped ? verbToInfinitive(word) : null;
    main.push(inf || resolved);
  }

  const combined = [...timeFront, ...main];
  return combined.filter((w,i) => i===0 || w !== combined[i-1]);
}

// ─── Normalize / dictionary lookup ────────────────────────────────────────
function normalize(word) {
  return word.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g,"")
    .replace(/[^a-z0-9]/g,"").trim();
}

function tokenize(text) {
  return text.split(/\s+/).filter(w => w.length > 0);
}

function findInDictionary(glossToken) {
  const norm = normalize(glossToken);
  if (!norm) return null;
  if (dictionary[norm]) return dictionary[norm];
  const candidates = [
    norm.endsWith("s")  ? norm.slice(0,-1) : null,
    norm.endsWith("es") ? norm.slice(0,-2) : null,
  ];
  for (const c of candidates) {
    if (c && dictionary[c]) return dictionary[c];
  }
  return null;
}

function spellWord(rawWord) {
  return rawWord.toUpperCase().replace(/[^A-Z]/g,"").split("")
    .map(l => ({ type:"letter", letter:l, rawWord }));
}

function buildItems(spanishText) {
  const glossTokens = spanishToGloss(spanishText);
  const items = [];
  for (const token of glossTokens) {
    const entry = findInDictionary(token);
    if (entry?.video_url) {
      items.push({ type:"sign", entry, rawWord:token.toUpperCase() });
    } else {
      const spelled = spellWord(token);
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
        <span id="lesco-live-badge">● EN VIVO</span>
        <button id="lesco-golive-btn" style="display:none">⏩ IR AL VIVO</button>
        <button id="lesco-close-btn" title="Cerrar">✕</button>
      </div>
    </div>
    <div id="lesco-gloss-bar"></div>
    <div id="lesco-main-view">
      <div id="lesco-active-sign">
        <div class="lesco-idle">Esperando subtítulos…<br><small>Activa CC en Meet</small></div>
      </div>
    </div>
    <div id="lesco-nav">
      <button id="lesco-prev" title="Anterior">◀</button>
      <span id="lesco-counter">—</span>
      <button id="lesco-next" title="Siguiente">▶</button>
    </div>
    <div id="lesco-timeline-wrap"><div id="lesco-timeline"></div></div>
    <div id="lesco-status"></div>
  `;
  document.body.appendChild(panel);

  document.getElementById("lesco-close-btn").addEventListener("click", () => {
    panel.style.display = "none";
  });
  document.getElementById("lesco-prev").addEventListener("click", () => goTo(currentIdx - 1));
  document.getElementById("lesco-next").addEventListener("click", () => goTo(currentIdx + 1));
  document.getElementById("lesco-golive-btn").addEventListener("click", goLive);

  makeDraggable(panel);
}

function makeDraggable(el) {
  const header = el.querySelector("#lesco-header");
  let drag = false, sx, sy, ox, oy;
  header.addEventListener("mousedown", e => {
    if (e.target.closest("button")) return;
    drag = true; sx = e.clientX; sy = e.clientY;
    const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
    e.preventDefault();
  });
  document.addEventListener("mousemove", e => {
    if (!drag) return;
    el.style.left = `${ox+e.clientX-sx}px`;
    el.style.top  = `${oy+e.clientY-sy}px`;
    el.style.right = "unset"; el.style.bottom = "unset";
  });
  document.addEventListener("mouseup", () => { drag = false; });
}

function showPanel() {
  const p = document.getElementById(PANEL_ID);
  if (p) p.style.display = "flex";
}

function setStatus(msg) {
  const el = document.getElementById("lesco-status");
  if (el) el.textContent = msg;
}

function setWordLabel(text) {
  const el = document.getElementById("lesco-word-label");
  if (el) el.textContent = text;
}

function setCounter() {
  const el = document.getElementById("lesco-counter");
  if (el) el.textContent = signQueue.length ? `${currentIdx+1} / ${signQueue.length}` : "—";
}

function setNavButtons() {
  const prev = document.getElementById("lesco-prev");
  const next = document.getElementById("lesco-next");
  if (prev) prev.disabled = currentIdx <= 0;
  if (next) next.disabled = currentIdx >= signQueue.length - 1;
}

function setLiveBadge(isLive) {
  const badge = document.getElementById("lesco-live-badge");
  const btn   = document.getElementById("lesco-golive-btn");
  if (badge) badge.style.display = isLive ? "inline" : "none";
  if (btn)   btn.style.display   = isLive ? "none"   : "inline";
}

function setGlossBar(spanishText, glossTokens) {
  const bar = document.getElementById("lesco-gloss-bar");
  if (!bar) return;
  bar.innerHTML = `
    <div class="lesco-gloss-original">${spanishText}</div>
    <div class="lesco-gloss-tokens">${glossTokens.map(t =>
      `<span class="lesco-gloss-token">${t.toUpperCase()}</span>`
    ).join(" ")}</div>
  `;
}

// ─── Active sign ───────────────────────────────────────────────────────────
async function renderActiveSign(item) {
  // Revocar blob URL anterior para evitar memory leaks
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  const container = document.getElementById("lesco-active-sign");
  if (!container) return;
  container.innerHTML = "";
  advanceLock = false;

  if (item.type === "sign") {
    const src   = await getVideoSrc(item.entry.video_url);
    if (src.startsWith("blob:")) currentBlobUrl = src;

    const video       = document.createElement("video");
    video.src         = src;
    video.muted       = true;
    video.playsInline = true;
    video.className   = "lesco-active-video";

    video.addEventListener("ended", () => {
      if (advanceLock) return;
      advanceLock = true;
      autoAdvance();
    });
    video.addEventListener("error", () => {
      if (advanceLock) return;
      advanceLock = true;
      setTimeout(() => autoAdvance(), 300);
    });

    container.appendChild(video);
    setWordLabel(item.rawWord);
    setTimeout(() => video.play().catch(() => {}), 50);

  } else {
    const img       = document.createElement("img");
    img.src         = `${LETTER_IMG_BASE}${item.letter}.jpg`;
    img.className   = "lesco-active-letter";
    img.alt         = item.letter;
    img.onerror     = () => { img.style.display = "none"; };
    container.appendChild(img);

    const badge         = document.createElement("div");
    badge.className     = "lesco-letter-badge";
    badge.textContent   = item.letter;
    container.appendChild(badge);

    setWordLabel(`✍️ ${item.rawWord}`);
    if (playTimer) clearTimeout(playTimer);
    playTimer = setTimeout(() => {
      if (!advanceLock) { advanceLock = true; autoAdvance(); }
    }, LETTER_MS);
  }
}

// ─── Timeline ──────────────────────────────────────────────────────────────
function buildChips() {
  const chips = [];
  let i = 0;
  while (i < signQueue.length) {
    const item = signQueue[i];
    if (item.type === "sign") {
      chips.push({ startIdx:i, indices:[i], label:item.rawWord, type:"sign" });
      i++;
    } else {
      const word = item.rawWord;
      const group = [];
      while (i < signQueue.length && signQueue[i].type === "letter" && signQueue[i].rawWord === word) {
        group.push(i); i++;
      }
      chips.push({ startIdx:group[0], indices:group, label:word, type:"spell" });
    }
  }
  return chips;
}

function renderTimeline() {
  const tl = document.getElementById("lesco-timeline");
  if (!tl) return;
  tl.innerHTML = "";

  let activeEl = null;
  buildChips().forEach(chip => {
    const isActive = chip.indices.includes(currentIdx);
    const isPast   = chip.indices[chip.indices.length-1] < currentIdx;

    const el = document.createElement("div");
    el.className = ["lesco-chip",
      isActive ? "lesco-chip-active" : "",
      isPast   ? "lesco-chip-past"   : "",
      chip.type === "spell" ? "lesco-chip-spell" : "",
    ].join(" ").trim();
    el.textContent = chip.label;
    el.addEventListener("click", () => goTo(chip.startIdx));
    tl.appendChild(el);
    if (isActive) activeEl = el;
  });

  if (activeEl) {
    const wrap = document.getElementById("lesco-timeline-wrap");
    if (wrap) {
      wrap.scrollTo({ left: activeEl.offsetLeft - wrap.offsetWidth/2 + activeEl.offsetWidth/2, behavior:"smooth" });
    }
  }
}

// ─── Playback ──────────────────────────────────────────────────────────────

// isLive = true cuando el usuario está en el clip más reciente de la última frase
let isLive = true;

function autoAdvance() {
  if (currentIdx < signQueue.length - 1) {
    currentIdx++;
    playCurrentItem(true);
  } else {
    renderTimeline();
    setCounter();
    setNavButtons();
    setStatus("✓ Fin");
    setLiveBadge(true);
    isLive = true;
  }
}

async function goTo(idx) {
  if (idx < 0 || idx >= signQueue.length) return;
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  currentIdx = idx;
  isLive = (idx === signQueue.length - 1);
  setLiveBadge(isLive);
  await playCurrentItem(false);
}

function goLive() {
  goTo(signQueue.length - 1);
}

async function playCurrentItem(autoPlay = true) {
  if (!signQueue.length) return;
  await renderActiveSign(signQueue[currentIdx]);
  renderTimeline();
  setCounter();
  setNavButtons();

  const signs   = signQueue.filter(x => x.type === "sign").length;
  const letters = signQueue.filter(x => x.type === "letter").length;
  setStatus(`${signs} seña${signs!==1?"s":""} · ${letters} letra${letters!==1?"s":""} deletreadas`);

  // Prefetch siguiente lote en segundo plano
  if (autoPlay) prefetchVideos(signQueue, currentIdx + 1);
}

// ─── Caption handling ──────────────────────────────────────────────────────
function handleNewCaption(text) {
  if (text === lastText) return;
  lastText = text;

  const glossTokens = spanishToGloss(text);
  const glossStr    = glossTokens.join(" ");
  if (glossStr === lastGloss) return;

  const newItems = buildItems(text);
  if (!newItems.length) return;

  const prevLen  = signQueue.length;
  const wasAtEnd = currentIdx >= prevLen - 1;

  signQueue = newItems;
  lastGloss = glossStr;

  setGlossBar(text, glossTokens);
  showPanel();
  renderTimeline();
  setCounter();
  setNavButtons();

  // Guardar frase en la sesión actual (con videos)
  savePhrase(text, glossTokens, newItems);

  if (prevLen === 0) {
    currentIdx = 0;
    isLive = true;
    setLiveBadge(true);
    playCurrentItem(true);
  } else if (wasAtEnd) {
    currentIdx = Math.min(prevLen, signQueue.length - 1);
    isLive = true;
    setLiveBadge(true);
    playCurrentItem(true);
  } else {
    // Usuario revisando — solo actualizar badge
    setLiveBadge(false);
  }
}

// ─── Observer + watchdog ──────────────────────────────────────────────────
function attachCaptionObserver() {
  const region = document.querySelector(CAPTIONS_REGION);
  if (!region) return false;

  if (captionObserver) captionObserver.disconnect();
  captionObserver = new MutationObserver(() => {
    const divs = document.querySelectorAll(CAPTION_SELECTOR);
    const text = Array.from(divs)
      .map(el => el.textContent.trim()).filter(t => t.length > 0).join(" ");
    if (text) handleNewCaption(text);
  });
  captionObserver.observe(region, { childList:true, subtree:true, characterData:true });
  console.log("[LESCO] Observer attached ✅");
  return true;
}

function startObserving() {
  if (!attachCaptionObserver()) {
    const retry = setInterval(() => {
      if (attachCaptionObserver()) clearInterval(retry);
    }, 1500);
  }
  setInterval(() => {
    const region = document.querySelector(CAPTIONS_REGION);
    if (!region && captionObserver) {
      captionObserver.disconnect(); captionObserver = null;
    } else if (region && !captionObserver) {
      attachCaptionObserver();
    }
  }, 2000);
}

// ─── Init ──────────────────────────────────────────────────────────────────
async function init() {
  try {
    const resp = await fetch(DICT_PATH);
    dictionary = await resp.json();
    console.log(`[LESCO] Dictionary: ${Object.keys(dictionary).length} entries`);
  } catch (err) {
    console.error("[LESCO] Failed to load dictionary:", err);
  }

  // Pre-caché de palabras comunes (solo la primera vez, en segundo plano)
  initPreCache().catch(() => {});

  // Iniciar sesión
  startSession();

  createPanel();
  showPanel();
  startObserving();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
