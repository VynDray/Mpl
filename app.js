/* ░░░░ MPL — app.js ░░░░ */

// ══════════════════════════════════════════════
//  🔥 FIREBASE CONFIG
// ══════════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyACxEhnLg3xP_QlFnEczXDJAptz3jfmIBY",
  authDomain: "vyndray-d2542.firebaseapp.com",
  projectId: "vyndray-d2542",
  storageBucket: "vyndray-d2542.firebasestorage.app",
  messagingSenderId: "123135816938",
  appId: "1:123135816938:web:5554a5f2f6368076995393"
};

// ── ADMIN PASSWORD ──
const ADMIN_PASSWORD = "Coolhands.co";

// ══════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════
let db = null;
let firebaseReady = false;
let leagues = {};
let activeLeagueId = null;
let adminUnlocked = false;

// ══════════════════════════════════════════════
//  FIREBASE INIT
// ══════════════════════════════════════════════
function initFirebase() {
  try {
    if (FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") {
      showSetupNotice();
      loadDemoData();
      return;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    firebaseReady = true;
    loadLeagues();
  } catch (e) {
    console.error("Firebase init failed:", e);
    showSetupNotice();
    loadDemoData();
  }
}

// ══════════════════════════════════════════════
//  FIRESTORE — fire-and-forget helpers
//  UI updates immediately; these sync in background
// ══════════════════════════════════════════════
function fsSyncLeague(id) {
  if (!firebaseReady) return;
  db.collection("leagues").doc(id).set(leagues[id])
    .catch(e => console.warn("Sync error:", e.message));
}

function fsDeleteLeague(id) {
  if (!firebaseReady) return;
  db.collection("leagues").doc(id).delete()
    .catch(e => console.warn("Delete error:", e.message));
}

// ══════════════════════════════════════════════
//  LOAD DATA FROM FIRESTORE
// ══════════════════════════════════════════════
async function loadLeagues() {
  if (!firebaseReady) return;
  try {
    const snap = await db.collection("leagues").get();
    leagues = {};
    snap.forEach(doc => { leagues[doc.id] = doc.data(); });
    renderAll();
  } catch (e) {
    console.error(e);
    toast("Failed to load — check Firestore rules", "error");
  }
}

// ══════════════════════════════════════════════
//  DEMO DATA
// ══════════════════════════════════════════════
function loadDemoData() {
  leagues = {
    "mpl-s1": {
      name: "MPL Season 1", season: "2024",
      teams: {
        "team-1": { name: "Kampala Kings", short: "KKG", color: "#6c63ff", logo: null, played: 10, won: 8, drawn: 1, lost: 1, gf: 24, ga: 8, points: 25, form: ["W","W","W","D","W"] },
        "team-2": { name: "Entebbe Eagles", short: "EEG", color: "#26de81", logo: null, played: 10, won: 6, drawn: 2, lost: 2, gf: 18, ga: 10, points: 20, form: ["W","L","W","W","D"] },
        "team-3": { name: "Jinja Jets", short: "JJT", color: "#f0b429", logo: null, played: 10, won: 5, drawn: 2, lost: 3, gf: 15, ga: 12, points: 17, form: ["D","W","L","W","W"] },
        "team-4": { name: "Gulu Giants", short: "GGT", color: "#fd9644", logo: null, played: 10, won: 4, drawn: 3, lost: 3, gf: 13, ga: 14, points: 15, form: ["L","D","W","D","W"] },
        "team-5": { name: "Mbale Strikers", short: "MBS", color: "#ff5e5e", logo: null, played: 10, won: 3, drawn: 1, lost: 6, gf: 10, ga: 20, points: 10, form: ["L","L","W","L","D"] },
        "team-6": { name: "Masaka FC", short: "MFC", color: "#45aaf2", logo: null, played: 10, won: 1, drawn: 2, lost: 7, gf: 6, ga: 22, points: 5, form: ["L","L","L","D","L"] },
      }
    }
  };
  renderAll();
}

// ══════════════════════════════════════════════
//  LOGO HELPER — compress image to base64
// ══════════════════════════════════════════════
function imageFileToBase64(file, maxSize = 80) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ══════════════════════════════════════════════
//  RENDER ENGINE
// ══════════════════════════════════════════════
function renderAll() {
  renderLeagueTabs();
  renderLeaguesGrid();
  renderAdminLeagueList();
  renderAdminDropdowns();
  if (activeLeagueId && leagues[activeLeagueId]) {
    renderStandings(activeLeagueId);
  } else {
    const ids = Object.keys(leagues);
    if (ids.length > 0) { activeLeagueId = ids[0]; renderStandings(activeLeagueId); }
    else renderEmptyStandings();
  }
}

// ── CREST HTML ── used in table + admin list
function crestHtml(t, size = 30, fontSize = 11) {
  if (t.logo) {
    return `<img src="${t.logo}" style="width:${size}px;height:${size}px;border-radius:6px;object-fit:cover;flex-shrink:0;" alt="${t.short}" />`;
  }
  return `<div class="team-crest" style="width:${size}px;height:${size}px;font-size:${fontSize}px;background:${t.color||'#6c63ff'}">${t.short||'?'}</div>`;
}

// ── League tabs ──
function renderLeagueTabs() {
  const container = document.getElementById("leagueTabs");
  const ids = Object.keys(leagues);
  if (ids.length === 0) {
    container.innerHTML = `<span style="padding:8px 16px;color:var(--text3);font-size:13px;">No leagues yet</span>`;
    return;
  }
  container.innerHTML = ids.map(id => {
    const l = leagues[id];
    return `<button class="league-tab ${id === activeLeagueId ? 'active' : ''}" data-league="${id}">${l.name}</button>`;
  }).join("");
  container.querySelectorAll(".league-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeLeagueId = btn.dataset.league;
      renderLeagueTabs();
      renderStandings(activeLeagueId);
      switchView("standings");
    });
  });
}

// ── Standings table ──
function renderStandings(leagueId) {
  const league = leagues[leagueId];
  if (!league) { renderEmptyStandings(); return; }

  document.getElementById("activeLeagueName").textContent =
    league.name + (league.season ? ` — ${league.season}` : "");

  const teams = Object.entries(league.teams || {});
  if (teams.length === 0) {
    document.getElementById("standingsBody").innerHTML =
      `<tr class="empty-row"><td colspan="11">No teams yet — add some in Admin.</td></tr>`;
    return;
  }

  teams.sort((a, b) => {
    const ta = a[1], tb = b[1];
    if (tb.points !== ta.points) return tb.points - ta.points;
    const gdA = ta.gf - ta.ga, gdB = tb.gf - tb.ga;
    if (gdB !== gdA) return gdB - gdA;
    return tb.gf - ta.gf;
  });

  const total = teams.length;
  document.getElementById("standingsBody").innerHTML = teams.map(([id, t], i) => {
    const pos = i + 1;
    const zone = getZone(pos, total);
    const gd = t.gf - t.ga;
    const gdStr = gd > 0 ? `<span class="gd-pos">+${gd}</span>` : gd < 0 ? `<span class="gd-neg">${gd}</span>` : `${gd}`;
    const form = [...(t.form || [])].slice(-5);
    while (form.length < 5) form.unshift("_");
    const formHtml = form.map(f => `<span class="form-badge ${f}">${f === "_" ? "" : f}</span>`).join("");

    return `
    <tr class="${zone ? 'zone-' + zone : ''}">
      <td><div class="pos-cell">
        <div class="pos-bar ${zone || 'none'}"></div>
        <span class="pos-num">${pos}</span>
      </div></td>
      <td class="col-team"><div class="team-cell">
        ${crestHtml(t)}
        <div><div class="team-name">${t.name}</div></div>
      </div></td>
      <td>${t.played||0}</td><td>${t.won||0}</td><td>${t.drawn||0}</td><td>${t.lost||0}</td>
      <td>${t.gf||0}</td><td>${t.ga||0}</td><td>${gdStr}</td>
      <td class="col-pts">${t.points||0}</td>
      <td><div class="form-wrap">${formHtml}</div></td>
    </tr>`;
  }).join("");
}

function getZone(pos, total) {
  if (total < 4) return null;
  if (pos <= Math.max(1, Math.floor(total * 0.2))) return "cl";
  if (pos <= Math.max(2, Math.floor(total * 0.4))) return "el";
  if (pos > total - Math.max(1, Math.floor(total * 0.2))) return "rel";
  return null;
}

function renderEmptyStandings() {
  document.getElementById("activeLeagueName").textContent = "No League Selected";
  document.getElementById("standingsBody").innerHTML =
    `<tr class="empty-row"><td colspan="11">Create a league in Admin to get started.</td></tr>`;
}

// ── Leagues grid ──
function renderLeaguesGrid() {
  const grid = document.getElementById("leaguesGrid");
  const ids = Object.keys(leagues);
  if (ids.length === 0) {
    grid.innerHTML = `<div style="padding:40px;color:var(--text3);font-size:14px;">No leagues yet.</div>`;
    return;
  }
  grid.innerHTML = ids.map(id => {
    const l = leagues[id];
    const teamCount = Object.keys(l.teams || {}).length;
    const matchCount = Math.floor(Object.values(l.teams || {}).reduce((s, t) => s + (t.played || 0), 0) / 2);
    return `
    <div class="league-card" data-league="${id}">
      <div class="lc-name">${l.name}</div>
      <div class="lc-season">${l.season || "—"}</div>
      <div class="lc-meta">
        <div class="lc-stat"><div class="lc-stat-num">${teamCount}</div><div class="lc-stat-label">Teams</div></div>
        <div class="lc-stat"><div class="lc-stat-num">${matchCount}</div><div class="lc-stat-label">Matches</div></div>
      </div>
    </div>`;
  }).join("");
  grid.querySelectorAll(".league-card").forEach(card => {
    card.addEventListener("click", () => {
      activeLeagueId = card.dataset.league;
      renderLeagueTabs();
      renderStandings(activeLeagueId);
      switchView("standings");
    });
  });
}

// ── Admin league list ──
function renderAdminLeagueList() {
  const list = document.getElementById("adminLeagueList");
  const ids = Object.keys(leagues);
  if (ids.length === 0) {
    list.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:8px 0;">No leagues yet.</div>`;
    return;
  }
  list.innerHTML = ids.map(id => {
    const l = leagues[id];
    return `
    <div class="admin-list-item">
      <div>
        <div class="ali-name">${l.name}</div>
        <div class="ali-sub">${l.season || "No season"} · ${Object.keys(l.teams||{}).length} teams</div>
      </div>
      <div class="ali-actions">
        <button class="btn-danger-sm" data-delete-league="${id}">Delete</button>
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-delete-league]").forEach(btn => {
    btn.addEventListener("click", () => deleteLeague(btn.dataset.deleteLeague));
  });
}

// ── Admin dropdowns ──
function renderAdminDropdowns() {
  const ids = Object.keys(leagues);
  const opts = ids.map(id => `<option value="${id}">${leagues[id].name}</option>`).join("");
  ["teamLeaguePicker", "resultLeaguePicker"].forEach(selId => {
    const sel = document.getElementById(selId);
    const prev = sel.value;
    sel.innerHTML = ids.length ? opts : `<option value="">— No leagues —</option>`;
    if (prev && leagues[prev]) sel.value = prev;
  });
  renderAdminTeamList();
  renderResultTeamPickers();
}

// ── Admin team list ──
function renderAdminTeamList() {
  const leagueId = document.getElementById("teamLeaguePicker").value;
  const list = document.getElementById("adminTeamList");
  if (!leagueId || !leagues[leagueId]) {
    list.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:8px 0;">Select a league above.</div>`;
    return;
  }
  const teams = Object.entries(leagues[leagueId].teams || {});
  if (teams.length === 0) {
    list.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:8px 0;">No teams yet.</div>`;
    return;
  }
  list.innerHTML = teams.map(([id, t]) => `
    <div class="admin-list-item">
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
        ${crestHtml(t, 28, 10)}
        <div style="min-width:0;">
          <div class="ali-name">${t.name} <span style="color:var(--text3);font-size:11px;">(${t.short})</span></div>
          <div class="ali-sub">${t.points||0} pts · ${t.played||0} played</div>
        </div>
      </div>
      <div class="ali-actions">
        <button class="btn-ghost-sm" data-edit-team="${id}" data-league="${leagueId}" title="Change logo">🖼</button>
        <button class="btn-danger-sm" data-delete-team="${id}" data-league="${leagueId}">✕</button>
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-delete-team]").forEach(btn => {
    btn.addEventListener("click", () => deleteTeam(btn.dataset.league, btn.dataset.deleteTeam));
  });
  list.querySelectorAll("[data-edit-team]").forEach(btn => {
    btn.addEventListener("click", () => triggerLogoUpload(btn.dataset.league, btn.dataset.editTeam));
  });
}

// ── Result team pickers ──
function renderResultTeamPickers() {
  const leagueId = document.getElementById("resultLeaguePicker").value;
  const home = document.getElementById("homeTeamPicker");
  const away = document.getElementById("awayTeamPicker");
  if (!leagueId || !leagues[leagueId]) {
    home.innerHTML = away.innerHTML = `<option value="">— Select league first —</option>`;
    return;
  }
  const teams = Object.entries(leagues[leagueId].teams || {});
  const opts = teams.map(([id, t]) => `<option value="${id}">${t.name}</option>`).join("");
  home.innerHTML = opts || `<option value="">No teams</option>`;
  away.innerHTML = opts || `<option value="">No teams</option>`;
  if (teams.length >= 2) away.selectedIndex = 1;
}

// ══════════════════════════════════════════════
//  LOGO UPLOAD
// ══════════════════════════════════════════════
function triggerLogoUpload(leagueId, teamId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const base64 = await imageFileToBase64(file, 80);
      leagues[leagueId].teams[teamId].logo = base64;
      renderAll();
      fsSyncLeague(leagueId);
      toast("Logo updated!", "success");
    } catch (e) {
      toast("Failed to load image", "error");
    }
  };
  input.click();
}

// ══════════════════════════════════════════════
//  ADMIN ACTIONS — all optimistic (UI first, sync after)
// ══════════════════════════════════════════════

// ── Create league ──
function createLeague() {
  const name = document.getElementById("newLeagueName").value.trim();
  const season = document.getElementById("newLeagueSeason").value.trim();
  if (!name) { toast("Enter a league name", "error"); return; }

  const id = "league-" + Date.now();
  leagues[id] = { name, season, teams: {} };
  activeLeagueId = id;

  document.getElementById("newLeagueName").value = "";
  document.getElementById("newLeagueSeason").value = "";

  renderAll();
  toast(`"${name}" created!`, "success");
  fsSyncLeague(id); // background sync
}

// ── Delete league ──
function deleteLeague(id) {
  if (!confirm(`Delete "${leagues[id]?.name}"? This removes all teams too.`)) return;
  const name = leagues[id].name;
  delete leagues[id];
  if (activeLeagueId === id) activeLeagueId = Object.keys(leagues)[0] || null;
  renderAll();
  toast(`"${name}" deleted.`, "success");
  fsDeleteLeague(id);
}

// ── Add team ──
async function addTeam() {
  const leagueId = document.getElementById("teamLeaguePicker").value;
  const name = document.getElementById("newTeamName").value.trim();
  const short = document.getElementById("newTeamShort").value.trim().toUpperCase();
  const color = document.getElementById("newTeamColor").value;
  const logoFile = document.getElementById("newTeamLogo").files[0];

  if (!leagueId) { toast("Select a league", "error"); return; }
  if (!name) { toast("Enter a team name", "error"); return; }
  if (!short || short.length < 2) { toast("Enter a 2–3 letter code", "error"); return; }

  let logo = null;
  if (logoFile) {
    try { logo = await imageFileToBase64(logoFile, 80); }
    catch (e) { toast("Image failed to load", "error"); return; }
  }

  const id = "team-" + Date.now();
  const teamData = { name, short, color, logo, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, form: [] };

  leagues[leagueId].teams = leagues[leagueId].teams || {};
  leagues[leagueId].teams[id] = teamData;

  document.getElementById("newTeamName").value = "";
  document.getElementById("newTeamShort").value = "";
  document.getElementById("newTeamLogo").value = "";
  document.getElementById("logoPreview").style.display = "none";

  renderAll();
  toast(`${name} added!`, "success");
  fsSyncLeague(leagueId);
}

// ── Delete team ──
function deleteTeam(leagueId, teamId) {
  const teamName = leagues[leagueId]?.teams?.[teamId]?.name;
  if (!confirm(`Remove "${teamName}"?`)) return;
  delete leagues[leagueId].teams[teamId];
  renderAll();
  toast(`${teamName} removed.`, "success");
  fsSyncLeague(leagueId);
}

// ── Record match result ──
function recordResult() {
  const leagueId = document.getElementById("resultLeaguePicker").value;
  const homeId = document.getElementById("homeTeamPicker").value;
  const awayId = document.getElementById("awayTeamPicker").value;
  const homeScore = parseInt(document.getElementById("homeScore").value);
  const awayScore = parseInt(document.getElementById("awayScore").value);

  if (!leagueId || !homeId || !awayId) { toast("Select league and teams", "error"); return; }
  if (homeId === awayId) { toast("Pick two different teams", "error"); return; }
  if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
    toast("Enter valid scores", "error"); return;
  }

  const home = leagues[leagueId].teams[homeId];
  const away = leagues[leagueId].teams[awayId];

  home.played = (home.played||0) + 1; home.gf = (home.gf||0) + homeScore; home.ga = (home.ga||0) + awayScore;
  away.played = (away.played||0) + 1; away.gf = (away.gf||0) + awayScore; away.ga = (away.ga||0) + homeScore;

  if (homeScore > awayScore) {
    home.won = (home.won||0)+1; home.points = (home.points||0)+3; away.lost = (away.lost||0)+1;
    home.form = [...(home.form||[]),"W"].slice(-10); away.form = [...(away.form||[]),"L"].slice(-10);
  } else if (homeScore < awayScore) {
    away.won = (away.won||0)+1; away.points = (away.points||0)+3; home.lost = (home.lost||0)+1;
    home.form = [...(home.form||[]),"L"].slice(-10); away.form = [...(away.form||[]),"W"].slice(-10);
  } else {
    home.drawn = (home.drawn||0)+1; home.points = (home.points||0)+1;
    away.drawn = (away.drawn||0)+1; away.points = (away.points||0)+1;
    home.form = [...(home.form||[]),"D"].slice(-10); away.form = [...(away.form||[]),"D"].slice(-10);
  }

  document.getElementById("homeScore").value = "";
  document.getElementById("awayScore").value = "";

  const fb = document.getElementById("resultFeedback");
  fb.textContent = `✓ ${home.name} ${homeScore}–${awayScore} ${away.name}`;
  fb.className = "result-feedback";
  setTimeout(() => fb.classList.add("hidden"), 4000);

  activeLeagueId = leagueId;
  renderAll();
  toast("Result recorded!", "success");
  fsSyncLeague(leagueId);
}

// ══════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════
function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view" + name[0].toUpperCase() + name.slice(1))?.classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
}

function openAdmin() {
  document.getElementById("adminPanel").classList.add("open");
  document.getElementById("overlay").classList.add("open");
}

function closeAdmin() {
  document.getElementById("adminPanel").classList.remove("open");
  document.getElementById("overlay").classList.remove("open");
}

function unlockAdmin() {
  const pw = document.getElementById("adminPwInput").value;
  if (pw === ADMIN_PASSWORD) {
    adminUnlocked = true;
    document.getElementById("adminGate").classList.add("hidden");
    document.getElementById("adminWorkspace").classList.remove("hidden");
    document.getElementById("adminPwInput").value = "";
    document.getElementById("gateError").classList.add("hidden");
  } else {
    document.getElementById("gateError").classList.remove("hidden");
    document.getElementById("adminPwInput").value = "";
    document.getElementById("adminPwInput").focus();
  }
}

function lockAdmin() {
  adminUnlocked = false;
  document.getElementById("adminGate").classList.remove("hidden");
  document.getElementById("adminWorkspace").classList.add("hidden");
}

function toast(msg, type = "") {
  let el = document.getElementById("toastEl");
  if (!el) { el = document.createElement("div"); el.id = "toastEl"; el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = "toast show " + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3000);
}

function showSetupNotice() {
  const main = document.querySelector(".main-wrap");
  const notice = document.createElement("div");
  notice.className = "setup-notice";
  notice.innerHTML = `
    <p><strong>⚡ Firebase Not Connected — Demo Mode</strong></p><br>
    <p>Open <code>app.js</code>, replace <code>FIREBASE_CONFIG</code> with your project's config, and enable Firestore in test mode.</p>
    <br><p style="color:var(--text3);">Changes below are not saved.</p>`;
  main.insertBefore(notice, main.firstChild);
}

// ══════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {

  // Nav
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // Admin panel open/close
  document.getElementById("adminTrigger").addEventListener("click", openAdmin);
  document.getElementById("panelClose").addEventListener("click", closeAdmin);
  document.getElementById("overlay").addEventListener("click", closeAdmin);

  // Admin login
  document.getElementById("adminLoginBtn").addEventListener("click", unlockAdmin);
  document.getElementById("adminLogout").addEventListener("click", lockAdmin);
  document.getElementById("adminPwInput").addEventListener("keydown", e => { if (e.key === "Enter") unlockAdmin(); });

  // Admin tabs
  document.querySelectorAll(".atab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".atab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".atab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("atab-" + tab.dataset.atab)?.classList.add("active");
    });
  });

  // League create — Enter key support
  document.getElementById("createLeagueBtn").addEventListener("click", createLeague);
  document.getElementById("newLeagueName").addEventListener("keydown", e => { if (e.key === "Enter") createLeague(); });
  document.getElementById("newLeagueSeason").addEventListener("keydown", e => { if (e.key === "Enter") createLeague(); });

  // Team add — Enter key support
  document.getElementById("addTeamBtn").addEventListener("click", addTeam);
  document.getElementById("newTeamShort").addEventListener("keydown", e => { if (e.key === "Enter") addTeam(); });
  document.getElementById("teamLeaguePicker").addEventListener("change", renderAdminTeamList);

  // Logo preview
  document.getElementById("newTeamLogo").addEventListener("change", async function() {
    const file = this.files[0];
    const preview = document.getElementById("logoPreview");
    if (file) {
      const base64 = await imageFileToBase64(file, 80);
      preview.src = base64;
      preview.style.display = "block";
    } else {
      preview.style.display = "none";
    }
  });

  // Results
  document.getElementById("recordResultBtn").addEventListener("click", recordResult);
  document.getElementById("resultLeaguePicker").addEventListener("change", renderResultTeamPickers);

  initFirebase();
});
