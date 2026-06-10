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
let fixturesLeagueId = null;
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
      status: "active",
      teams: {
        "team-1": { name: "Kampala Kings", short: "KKG", color: "#6c63ff", logo: null, played: 10, won: 8, drawn: 1, lost: 1, gf: 24, ga: 8, points: 25, form: ["W","W","W","D","W"] },
        "team-2": { name: "Entebbe Eagles", short: "EEG", color: "#26de81", logo: null, played: 10, won: 6, drawn: 2, lost: 2, gf: 18, ga: 10, points: 20, form: ["W","L","W","W","D"] },
        "team-3": { name: "Jinja Jets", short: "JJT", color: "#f0b429", logo: null, played: 10, won: 5, drawn: 2, lost: 3, gf: 15, ga: 12, points: 17, form: ["D","W","L","W","W"] },
        "team-4": { name: "Gulu Giants", short: "GGT", color: "#fd9644", logo: null, played: 10, won: 4, drawn: 3, lost: 3, gf: 13, ga: 14, points: 15, form: ["L","D","W","D","W"] },
        "team-5": { name: "Mbale Strikers", short: "MBS", color: "#ff5e5e", logo: null, played: 10, won: 3, drawn: 1, lost: 6, gf: 10, ga: 20, points: 10, form: ["L","L","W","L","D"] },
        "team-6": { name: "Masaka FC", short: "MFC", color: "#45aaf2", logo: null, played: 10, won: 1, drawn: 2, lost: 7, gf: 6, ga: 22, points: 5, form: ["L","L","L","D","L"] },
      },
      fixtures: []
    }
  };
  renderAll();
}

// ══════════════════════════════════════════════
//  FIXTURE GENERATION — Round Robin
//  Uses Berger algorithm: every team plays every
//  other team home & away across two legs.
// ══════════════════════════════════════════════
function generateFixtures(leagueId) {
  const league = leagues[leagueId];
  const teamIds = Object.keys(league.teams || {});
  const n = teamIds.length;
  if (n < 2) return [];

  // Shuffle teams randomly
  const shuffled = [...teamIds].sort(() => Math.random() - 0.5);

  // If odd number, add a "bye" placeholder
  const list = n % 2 === 0 ? [...shuffled] : [...shuffled, null];
  const numTeams = list.length;
  const rounds = numTeams - 1;
  const matchesPerRound = numTeams / 2;

  const firstLeg = [];

  for (let r = 0; r < rounds; r++) {
    const round = [];
    for (let m = 0; m < matchesPerRound; m++) {
      const home = list[m];
      const away = list[numTeams - 1 - m];
      if (home !== null && away !== null) {
        round.push({ id: `fx-${Date.now()}-${r}-${m}`, home, away, homeScore: null, awayScore: null });
      }
    }
    firstLeg.push({ matchday: r + 1, matches: round });
    // Rotate: keep list[0] fixed, rotate rest
    list.splice(1, 0, list.pop());
  }

  // Second leg — reverse home/away
  const secondLeg = firstLeg.map((rd, i) => ({
    matchday: rounds + i + 1,
    matches: rd.matches.map(m => ({
      id: m.id + "-r",
      home: m.away,
      away: m.home,
      homeScore: null,
      awayScore: null
    }))
  }));

  return [...firstLeg, ...secondLeg];
}

// ══════════════════════════════════════════════
//  START LEAGUE
// ══════════════════════════════════════════════
function startLeague(id) {
  const league = leagues[id];
  const teamCount = Object.keys(league.teams || {}).length;
  if (teamCount < 2) {
    toast("Add at least 2 teams before starting", "error");
    return;
  }
  if (!confirm(`Start "${league.name}"? Fixtures will be generated and you won't be able to add or remove teams.`)) return;

  league.status = "active";
  league.fixtures = generateFixtures(id);

  renderAll();
  toast(`${league.name} started! ${league.fixtures.length} matchdays generated.`, "success");
  fsSyncLeague(id);
}

// ══════════════════════════════════════════════
//  RESET LEAGUE
// ══════════════════════════════════════════════
function resetLeague(id) {
  const league = leagues[id];
  if (!confirm(`Reset "${league.name}"? This will clear ALL results, fixtures, and standings. Teams are kept.`)) return;

  // Reset all team stats
  Object.values(league.teams || {}).forEach(t => {
    t.played = 0; t.won = 0; t.drawn = 0; t.lost = 0;
    t.gf = 0; t.ga = 0; t.points = 0; t.form = [];
  });

  // Clear fixtures & reset status
  league.fixtures = [];
  league.status = "setup";

  renderAll();
  toast(`"${league.name}" has been reset. Add teams and start a new season.`, "success");
  fsSyncLeague(id);
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
  renderFixturesView();
  if (activeLeagueId && leagues[activeLeagueId]) {
    renderStandings(activeLeagueId);
  } else {
    const ids = Object.keys(leagues);
    if (ids.length > 0) { activeLeagueId = ids[0]; renderStandings(activeLeagueId); }
    else renderEmptyStandings();
  }
}

// ── CREST HTML ──
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
    const badge = l.status === "active"
      ? `<span class="league-tab-badge active-badge">LIVE</span>`
      : `<span class="league-tab-badge setup-badge">SETUP</span>`;
    return `<button class="league-tab ${id === activeLeagueId ? 'active' : ''}" data-league="${id}">${l.name}${badge}</button>`;
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

// ── Fixtures view ──
function renderFixturesView() {
  const ids = Object.keys(leagues);
  const tabsEl = document.getElementById("fixturesLeagueTabs");
  const bodyEl = document.getElementById("fixturesBody");
  const titleEl = document.getElementById("fixturesLeagueName");

  if (ids.length === 0) {
    tabsEl.innerHTML = "";
    bodyEl.innerHTML = `<div class="fixtures-empty">No leagues yet.</div>`;
    titleEl.textContent = "Fixtures";
    return;
  }

  // Default fixturesLeagueId
  if (!fixturesLeagueId || !leagues[fixturesLeagueId]) {
    fixturesLeagueId = ids[0];
  }

  // Render league tabs
  tabsEl.innerHTML = ids.map(id =>
    `<button class="fx-league-tab ${id === fixturesLeagueId ? 'active' : ''}" data-lid="${id}">${leagues[id].name}</button>`
  ).join("");
  tabsEl.querySelectorAll(".fx-league-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      fixturesLeagueId = btn.dataset.lid;
      renderFixturesView();
    });
  });

  const league = leagues[fixturesLeagueId];
  titleEl.textContent = league.name + " — Fixtures";

  const fixtures = league.fixtures || [];
  if (fixtures.length === 0) {
    bodyEl.innerHTML = league.status === "active"
      ? `<div class="fixtures-empty">No fixtures generated yet.</div>`
      : `<div class="fixtures-empty">League hasn't started yet. Start it from Admin → Leagues to generate fixtures.</div>`;
    return;
  }

  bodyEl.innerHTML = fixtures.map(round => {
    const matchesHtml = round.matches.map(m => {
      const homeT = league.teams[m.home];
      const awayT = league.teams[m.away];
      if (!homeT || !awayT) return "";

      const played = m.homeScore !== null && m.awayScore !== null;
      const scoreHtml = played
        ? `<div class="fx-score played">
            <span class="fx-score-num">${m.homeScore}</span>
            <span class="fx-score-sep">–</span>
            <span class="fx-score-num">${m.awayScore}</span>
           </div>`
        : `<div class="fx-score unplayed">
            <span class="fx-score-vs">vs</span>
           </div>`;

      const winClass = played
        ? m.homeScore > m.awayScore ? "home-win"
          : m.homeScore < m.awayScore ? "away-win"
          : "draw"
        : "";

      return `
      <div class="fx-match ${winClass} ${played ? 'fx-played' : ''}" data-league="${fixturesLeagueId}" data-matchday="${round.matchday}" data-match="${m.id}">
        <div class="fx-team fx-home">
          ${crestHtml(homeT, 28, 10)}
          <span class="fx-team-name">${homeT.name}</span>
        </div>
        ${scoreHtml}
        <div class="fx-team fx-away">
          <span class="fx-team-name">${awayT.name}</span>
          ${crestHtml(awayT, 28, 10)}
        </div>
        ${!played && adminUnlocked ? `<button class="fx-enter-btn" data-lid="${fixturesLeagueId}" data-mid="${m.id}">Enter Score</button>` : ''}
        ${played && adminUnlocked ? `<button class="fx-edit-btn" data-lid="${fixturesLeagueId}" data-mid="${m.id}">Edit</button>` : ''}
      </div>`;
    }).join("");

    const allPlayed = round.matches.every(m => m.homeScore !== null && m.awayScore !== null);

    return `
    <div class="fx-round ${allPlayed ? 'fx-round-done' : ''}">
      <div class="fx-round-header">
        <span class="fx-round-title">Matchday ${round.matchday}</span>
        ${allPlayed ? '<span class="fx-round-badge">✓ Complete</span>' : ''}
      </div>
      <div class="fx-matches">${matchesHtml}</div>
    </div>`;
  }).join("");

  // Attach score entry buttons
  bodyEl.querySelectorAll(".fx-enter-btn, .fx-edit-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openFixtureScoreModal(btn.dataset.lid, btn.dataset.mid);
    });
  });
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
    const statusLabel = l.status === "active" ? `<span class="lc-status active">● LIVE</span>` : `<span class="lc-status setup">○ Setup</span>`;
    return `
    <div class="league-card" data-league="${id}">
      <div class="lc-top">${statusLabel}</div>
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
    const isActive = l.status === "active";
    const teamCount = Object.keys(l.teams || {}).length;
    return `
    <div class="admin-list-item ali-league-item">
      <div style="flex:1;min-width:0;">
        <div class="ali-name">${l.name}</div>
        <div class="ali-sub">${l.season || "No season"} · ${teamCount} teams · <span style="color:${isActive ? 'var(--green)' : 'var(--text3)'}">${isActive ? '● Live' : '○ Setup'}</span></div>
      </div>
      <div class="ali-actions" style="flex-direction:column;gap:4px;align-items:flex-end;">
        ${!isActive
          ? `<button class="btn-start-sm" data-start-league="${id}">▶ Start</button>`
          : `<button class="btn-reset-sm" data-reset-league="${id}">↺ Reset</button>`
        }
        <button class="btn-danger-sm" data-delete-league="${id}">Delete</button>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-delete-league]").forEach(btn => {
    btn.addEventListener("click", () => deleteLeague(btn.dataset.deleteLeague));
  });
  list.querySelectorAll("[data-start-league]").forEach(btn => {
    btn.addEventListener("click", () => startLeague(btn.dataset.startLeague));
  });
  list.querySelectorAll("[data-reset-league]").forEach(btn => {
    btn.addEventListener("click", () => resetLeague(btn.dataset.resetLeague));
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

  const league = leagues[leagueId];
  const isActive = league.status === "active";

  // Show lock notice if league is active
  const lockNotice = isActive
    ? `<div class="league-locked-notice">🔒 League is live — team changes are locked. Reset the league to modify teams.</div>`
    : "";

  // Hide add-team form if active
  const addForm = document.getElementById("addTeamFormArea");
  if (addForm) addForm.style.display = isActive ? "none" : "";

  const teams = Object.entries(league.teams || {});
  if (teams.length === 0) {
    list.innerHTML = lockNotice + `<div style="color:var(--text3);font-size:13px;padding:8px 0;">No teams yet.</div>`;
    return;
  }
  list.innerHTML = lockNotice + teams.map(([id, t]) => `
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
        ${!isActive ? `<button class="btn-danger-sm" data-delete-team="${id}" data-league="${leagueId}">✕</button>` : ""}
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
//  FIXTURE SCORE MODAL
// ══════════════════════════════════════════════
function openFixtureScoreModal(leagueId, matchId) {
  const league = leagues[leagueId];
  const match = findMatch(league, matchId);
  if (!match) return;

  const homeT = league.teams[match.home];
  const awayT = league.teams[match.away];
  const existingHome = match.homeScore !== null ? match.homeScore : "";
  const existingAway = match.awayScore !== null ? match.awayScore : "";

  // Remove any existing modal
  document.getElementById("fxModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "fxModal";
  modal.className = "fx-modal-overlay";
  modal.innerHTML = `
    <div class="fx-modal">
      <div class="fx-modal-header">
        <span>Enter Score</span>
        <button class="fx-modal-close" id="fxModalClose">✕</button>
      </div>
      <div class="fx-modal-body">
        <div class="fx-modal-teams">
          <div class="fx-modal-team">
            ${crestHtml(homeT, 44, 14)}
            <div class="fx-modal-team-name">${homeT.name}</div>
          </div>
          <div class="fx-modal-scores">
            <input type="number" id="fxHomeScore" class="fx-score-input" value="${existingHome}" min="0" placeholder="0" />
            <span class="fx-modal-dash">–</span>
            <input type="number" id="fxAwayScore" class="fx-score-input" value="${existingAway}" min="0" placeholder="0" />
          </div>
          <div class="fx-modal-team">
            ${crestHtml(awayT, 44, 14)}
            <div class="fx-modal-team-name">${awayT.name}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button class="btn-primary full" id="fxSaveBtn">Save Result</button>
          ${match.homeScore !== null ? `<button class="btn-ghost-sm" id="fxClearBtn" style="flex-shrink:0;padding:0 12px;">Clear</button>` : ""}
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById("fxModalClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

  document.getElementById("fxSaveBtn").addEventListener("click", () => {
    const hs = parseInt(document.getElementById("fxHomeScore").value);
    const as = parseInt(document.getElementById("fxAwayScore").value);
    if (isNaN(hs) || isNaN(as) || hs < 0 || as < 0) { toast("Enter valid scores", "error"); return; }
    saveFixtureResult(leagueId, matchId, hs, as, match.homeScore, match.awayScore);
    modal.remove();
  });

  document.getElementById("fxClearBtn")?.addEventListener("click", () => {
    clearFixtureResult(leagueId, matchId, match.homeScore, match.awayScore, match.home, match.away);
    modal.remove();
  });

  // Focus first input
  setTimeout(() => document.getElementById("fxHomeScore")?.focus(), 50);
}

function findMatch(league, matchId) {
  for (const round of league.fixtures || []) {
    for (const m of round.matches) {
      if (m.id === matchId) return m;
    }
  }
  return null;
}

// Save result to fixture AND update standings
function saveFixtureResult(leagueId, matchId, homeScore, awayScore, prevHome, prevAway) {
  const league = leagues[leagueId];
  const match = findMatch(league, matchId);
  if (!match) return;

  const homeT = league.teams[match.home];
  const awayT = league.teams[match.away];

  // If editing an existing result, reverse the old stats first
  if (prevHome !== null && prevAway !== null) {
    reverseResult(homeT, awayT, prevHome, prevAway);
  }

  // Apply new result
  applyResult(homeT, awayT, homeScore, awayScore);

  // Store score on fixture
  match.homeScore = homeScore;
  match.awayScore = awayScore;

  renderAll();
  toast(`${homeT.name} ${homeScore}–${awayScore} ${awayT.name} saved!`, "success");
  fsSyncLeague(leagueId);
}

function clearFixtureResult(leagueId, matchId, prevHome, prevAway, homeId, awayId) {
  const league = leagues[leagueId];
  const match = findMatch(league, matchId);
  if (!match) return;

  const homeT = league.teams[match.home];
  const awayT = league.teams[match.away];

  if (prevHome !== null && prevAway !== null) {
    reverseResult(homeT, awayT, prevHome, prevAway);
  }

  match.homeScore = null;
  match.awayScore = null;

  renderAll();
  toast("Result cleared.", "success");
  fsSyncLeague(leagueId);
}

function applyResult(home, away, hs, as) {
  home.played = (home.played||0) + 1; home.gf = (home.gf||0) + hs; home.ga = (home.ga||0) + as;
  away.played = (away.played||0) + 1; away.gf = (away.gf||0) + as; away.ga = (away.ga||0) + hs;
  if (hs > as) {
    home.won = (home.won||0)+1; home.points = (home.points||0)+3; away.lost = (away.lost||0)+1;
    home.form = [...(home.form||[]),"W"].slice(-10); away.form = [...(away.form||[]),"L"].slice(-10);
  } else if (hs < as) {
    away.won = (away.won||0)+1; away.points = (away.points||0)+3; home.lost = (home.lost||0)+1;
    home.form = [...(home.form||[]),"L"].slice(-10); away.form = [...(away.form||[]),"W"].slice(-10);
  } else {
    home.drawn = (home.drawn||0)+1; home.points = (home.points||0)+1;
    away.drawn = (away.drawn||0)+1; away.points = (away.points||0)+1;
    home.form = [...(home.form||[]),"D"].slice(-10); away.form = [...(away.form||[]),"D"].slice(-10);
  }
}

function reverseResult(home, away, hs, as) {
  home.played = Math.max(0, (home.played||0) - 1); home.gf = Math.max(0, (home.gf||0) - hs); home.ga = Math.max(0, (home.ga||0) - as);
  away.played = Math.max(0, (away.played||0) - 1); away.gf = Math.max(0, (away.gf||0) - as); away.ga = Math.max(0, (away.ga||0) - hs);
  if (hs > as) {
    home.won = Math.max(0, (home.won||0)-1); home.points = Math.max(0, (home.points||0)-3); away.lost = Math.max(0, (away.lost||0)-1);
  } else if (hs < as) {
    away.won = Math.max(0, (away.won||0)-1); away.points = Math.max(0, (away.points||0)-3); home.lost = Math.max(0, (home.lost||0)-1);
  } else {
    home.drawn = Math.max(0, (home.drawn||0)-1); home.points = Math.max(0, (home.points||0)-1);
    away.drawn = Math.max(0, (away.drawn||0)-1); away.points = Math.max(0, (away.points||0)-1);
  }
  // Remove last form entry (approximate — form is best-effort)
  home.form = (home.form||[]).slice(0, -1);
  away.form = (away.form||[]).slice(0, -1);
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
//  ADMIN ACTIONS
// ══════════════════════════════════════════════

// ── Create league ──
function createLeague() {
  const name = document.getElementById("newLeagueName").value.trim();
  const season = document.getElementById("newLeagueSeason").value.trim();
  if (!name) { toast("Enter a league name", "error"); return; }

  const id = "league-" + Date.now();
  leagues[id] = { name, season, status: "setup", teams: {}, fixtures: [] };
  activeLeagueId = id;

  document.getElementById("newLeagueName").value = "";
  document.getElementById("newLeagueSeason").value = "";

  renderAll();
  toast(`"${name}" created!`, "success");
  fsSyncLeague(id);
}

// ── Delete league ──
function deleteLeague(id) {
  if (!confirm(`Delete "${leagues[id]?.name}"? This removes all teams and fixtures too.`)) return;
  const name = leagues[id].name;
  delete leagues[id];
  if (activeLeagueId === id) activeLeagueId = Object.keys(leagues)[0] || null;
  if (fixturesLeagueId === id) fixturesLeagueId = Object.keys(leagues)[0] || null;
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

  // Block if league is already active
  if (leagues[leagueId]?.status === "active") {
    toast("League is live — reset it first to add teams", "error");
    return;
  }

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
  if (leagues[leagueId]?.status === "active") {
    toast("League is live — reset it first to remove teams", "error");
    return;
  }
  const teamName = leagues[leagueId]?.teams?.[teamId]?.name;
  if (!confirm(`Remove "${teamName}"?`)) return;
  delete leagues[leagueId].teams[teamId];
  renderAll();
  toast(`${teamName} removed.`, "success");
  fsSyncLeague(leagueId);
}

// ── Record match result (legacy tab — still works) ──
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

  applyResult(home, away, homeScore, awayScore);

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
  // Re-render fixtures view to show/hide edit buttons based on admin state
  if (name === "fixtures") renderFixturesView();
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
    renderFixturesView(); // refresh to show edit buttons
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
  renderFixturesView(); // hide edit buttons
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

  // League create
  document.getElementById("createLeagueBtn").addEventListener("click", createLeague);
  document.getElementById("newLeagueName").addEventListener("keydown", e => { if (e.key === "Enter") createLeague(); });
  document.getElementById("newLeagueSeason").addEventListener("keydown", e => { if (e.key === "Enter") createLeague(); });

  // Team add
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
