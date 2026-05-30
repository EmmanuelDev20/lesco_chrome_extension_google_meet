/* LESCO Popup – session browser + mini player */

// ─── Mini player state ─────────────────────────────────────────────────────
let mpSigns  = [];   // array de { word, video_url }
let mpIdx    = 0;
let mpActive = false;

const mpPlayer  = document.getElementById("mini-player");
const mpVideo   = document.getElementById("mp-video");
const mpWord    = document.getElementById("mp-word");
const mpCounter = document.getElementById("mp-counter");
const mpPrev    = document.getElementById("mp-prev");
const mpNext    = document.getElementById("mp-next");
const mpClose   = document.getElementById("mp-close");

function openPlayer(signs) {
  if (!signs || signs.length === 0) return;
  mpSigns  = signs;
  mpIdx    = 0;
  mpActive = true;
  mpPlayer.classList.add("active");
  playMpSign(0);
}

function playMpSign(idx) {
  if (idx < 0 || idx >= mpSigns.length) return;
  mpIdx = idx;
  const sign = mpSigns[idx];

  mpWord.textContent    = sign.word;
  mpCounter.textContent = `${idx + 1} / ${mpSigns.length}`;
  mpPrev.disabled = idx === 0;
  mpNext.disabled = idx === mpSigns.length - 1;

  mpVideo.src = sign.video_url;
  mpVideo.load();
  mpVideo.play().catch(() => {});
}

mpVideo.addEventListener("ended", () => {
  if (mpIdx < mpSigns.length - 1) playMpSign(mpIdx + 1);
});

mpPrev.addEventListener("click", () => playMpSign(mpIdx - 1));
mpNext.addEventListener("click", () => playMpSign(mpIdx + 1));
mpClose.addEventListener("click", () => {
  mpPlayer.classList.remove("active");
  mpVideo.pause();
  mpVideo.src = "";
  mpActive = false;
});

// ─── Helpers ───────────────────────────────────────────────────────────────
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("es-CR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatDuration(start, end) {
  if (!end) return "En curso";
  const secs = Math.round((end - start) / 1000);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

// ─── Render ────────────────────────────────────────────────────────────────
function renderSessions(sessions) {
  const list = document.getElementById("sessions-list");

  if (!sessions || sessions.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        Aún no hay sesiones guardadas.<br>
        Abre Google Meet y activa los subtítulos (CC).
      </div>`;
    return;
  }

  list.innerHTML = "";

  sessions.forEach(session => {
    const card     = document.createElement("div");
    card.className = "session-card";
    const count    = session.phrases?.length || 0;

    card.innerHTML = `
      <div class="session-header">
        <div>
          <div class="session-date">${session.date || "—"} · ${session.startTime || "—"}</div>
          <div class="session-time">${formatDuration(session.startedAt, session.endedAt)} · ${count} frase${count !== 1 ? "s" : ""}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="session-count">${count}</span>
          <span class="session-chevron">▼</span>
        </div>
      </div>
      <div class="phrases-list">
        ${renderPhrases(session.phrases || [])}
      </div>
    `;

    // Toggle expand
    card.querySelector(".session-header").addEventListener("click", () => {
      card.classList.toggle("expanded");
    });

    // Play buttons inside phrases
    card.querySelectorAll(".btn-play-phrase:not(.no-video)").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const signs = JSON.parse(btn.dataset.signs || "[]");
        openPlayer(signs);
      });
    });

    list.appendChild(card);
  });
}

function renderPhrases(phrases) {
  if (!phrases.length) {
    return `<div style="font-size:11px;color:rgba(255,255,255,0.3);padding:8px;">Sin frases registradas.</div>`;
  }

  return phrases.map(p => {
    const signs    = p.signs || [];
    const hasVideo = signs.length > 0;
    const signsJSON = JSON.stringify(signs).replace(/"/g, "&quot;");

    const glossChips = (p.gloss || []).map(t => {
      const hasSign = signs.some(s => s.word === t.toUpperCase());
      return `<span class="gloss-chip${hasSign ? "" : " no-video"}">${t.toUpperCase()}</span>`;
    }).join("");

    return `
      <div class="phrase-row">
        <div class="phrase-top">
          <div class="phrase-texts">
            <div class="phrase-time">${formatTime(p.t)}</div>
            <div class="phrase-spanish">${p.spanish || ""}</div>
          </div>
          <button class="btn-play-phrase${hasVideo ? "" : " no-video"}"
                  title="${hasVideo ? "Ver señas" : "Sin videos"}"
                  data-signs="${signsJSON}">▶</button>
        </div>
        <div class="phrase-gloss">${glossChips}</div>
      </div>`;
  }).join("");
}

// ─── Load & clear ──────────────────────────────────────────────────────────
async function load() {
  const { lesco_sessions = [] } = await chrome.storage.local.get("lesco_sessions");
  renderSessions(lesco_sessions);
}

document.getElementById("btn-clear").addEventListener("click", async () => {
  if (!confirm("¿Borrar todo el historial de sesiones?")) return;
  await chrome.storage.local.remove("lesco_sessions");
  renderSessions([]);
});

load();
