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

// ── ADMIN PASSWORD SYSTEM ──
// Master override (never changes, never stored in Firestore)
// SHA-256 of "Coolhands.co22077"
const MASTER_PW_HASH = "1d7f02b9f2376d664bed156257d3e1ea9a9ba5c58f68928b7347705b8a7b93a6";

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

let activePwHash = null; // loaded from Firestore

// ══════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════
let db = null;
let firebaseReady = false;
let leagues = {};
let activeLeagueId = null;
let fixturesLeagueId = null;
let adminUnlocked = false;
let pyramidGroups = JSON.parse(localStorage.getItem("mpl_pyramid") || "{}");

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
    loadHofFromFirestore();
    loadPyramidFromFirestore();
    loadAdminPwFromFirestore();
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

// ── Admin password — load from / save to Firestore ──
async function loadAdminPwFromFirestore() {
  if (!firebaseReady) return;
  try {
    const doc = await db.collection("meta").doc("adminPw").get();
    if (doc.exists && doc.data().hash) {
      activePwHash = doc.data().hash;
    } else {
      // First time: seed with hash of "Coolhands.co" (original password)
      const seedHash = await sha256("Coolhands.co");
      activePwHash = seedHash;
      db.collection("meta").doc("adminPw").set({ hash: seedHash })
        .catch(e => console.warn("PW seed error:", e.message));
    }
  } catch (e) { console.warn("PW load error:", e.message); }
}

async function saveAdminPwToFirestore(hash) {
  if (!firebaseReady) return;
  await db.collection("meta").doc("adminPw").set({ hash })
    .catch(e => console.warn("PW save error:", e.message));
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
//  STANDINGS / SEASON HELPERS (shared by table + pyramid logic)
// ══════════════════════════════════════════════

// Returns [ [teamId, teamObj], ... ] sorted by Pts → GD → GF (best first)
function getStandingsSorted(league) {
  const teams = Object.entries(league?.teams || {});
  teams.sort((a, b) => {
    const ta = a[1], tb = b[1];
    if ((tb.points||0) !== (ta.points||0)) return (tb.points||0) - (ta.points||0);
    const gdA = (ta.gf||0) - (ta.ga||0), gdB = (tb.gf||0) - (tb.ga||0);
    if (gdB !== gdA) return gdB - gdA;
    return (tb.gf||0) - (ta.gf||0);
  });
  return teams;
}

// True if the league has fixtures and every match has a recorded score
function isLeagueComplete(league) {
  const fixtures = league?.fixtures || [];
  if (fixtures.length === 0) return false;
  return fixtures.every(round => round.matches.every(m => m.homeScore !== null && m.awayScore !== null));
}

// Resets a team's season stats in place (keeps name/short/color/logo). Returns the team.
function resetTeamSeason(team) {
  team.played = 0; team.won = 0; team.drawn = 0; team.lost = 0;
  team.gf = 0; team.ga = 0; team.points = 0; team.form = [];
  return team;
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
  renderPyramidAdmin();
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
function crestHtml(t, size = 22, fontSize = 9) {
  if (t.logo) {
    return `<img src="${t.logo}" style="width:${size}px;height:${size}px;border-radius:4px;object-fit:cover;flex-shrink:0;" alt="${t.short}" />`;
  }
  return `<div class="team-crest" style="width:${size}px;height:${size}px;font-size:${fontSize}px;background:${t.color||'#6c63ff'}">${t.short||'?'}</div>`;
}

// ── Pyramid role badge (TIER 1 / TIER 2) ──
function pyramidBadgeHtml(league) {
  if (!league?.pyramidGroupId || !pyramidGroups[league.pyramidGroupId]) return "";
  if (league.pyramidRole === "tier1") return `<span class="league-tab-badge tier-badge tier-1">TIER 1</span>`;
  if (league.pyramidRole === "tier2") return `<span class="league-tab-badge tier-badge tier-2">TIER 2</span>`;
  return "";
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
    return `<button class="league-tab ${id === activeLeagueId ? 'active' : ''}" data-league="${id}">${l.name}${badge}${pyramidBadgeHtml(l)}</button>`;
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

  renderStandingsLegend(league);

  const teams = getStandingsSorted(league);
  if (teams.length === 0) {
    document.getElementById("standingsBody").innerHTML =
      `<tr class="empty-row"><td colspan="11">No teams yet — add some in Admin.</td></tr>`;
    return;
  }

  const total = teams.length;
  document.getElementById("standingsBody").innerHTML = teams.map(([id, t], i) => {
    const pos = i + 1;
    const zone = getZone(pos, total, league);
    const gd = t.gf - t.ga;
    const gdStr = gd > 0 ? `<span class="gd-pos">+${gd}</span>` : gd < 0 ? `<span class="gd-neg">${gd}</span>` : `${gd}`;
    const form = [...(t.form || [])].slice(-5);
    while (form.length < 5) form.unshift("_");
    const formHtml = form.map(f => `<span class="form-badge ${f}">${f === "_" ? "" : f}</span>`).join("");

    return `
    <tr class="${zone ? 'zone-' + zone : ''}">
      <td class="col-pos"><div class="pos-cell">
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

// ── Standings legend — shows promotion/relegation zones relevant to this league ──
function renderStandingsLegend(league) {
  const el = document.getElementById("standingsLegend");
  if (!el) return;

  const groupId = league?.pyramidGroupId;
  const group = groupId ? pyramidGroups[groupId] : null;

  if (group && league.pyramidRole === "tier1") {
    const tier2Name = leagues[group.tier2Id]?.name || "the lower division";
    let html = "";
    if ((group.relegateCount || 0) > 0) {
      html += `<span class="leg-item"><span class="dot rel"></span>Relegation to ${tier2Name}</span>`;
    }
    el.innerHTML = html;
    return;
  }

  if (group && league.pyramidRole === "tier2") {
    const tier1Name = leagues[group.tier1Id]?.name || "the top division";
    let html = "";
    if ((group.promoteCount || 0) > 0) {
      html += `<span class="leg-item"><span class="dot promo"></span>Promotion to ${tier1Name}</span>`;
    }
    el.innerHTML = html;
    return;
  }

  // Fallback — generic legend for leagues not in a pyramid
  el.innerHTML = `
    <span class="leg-item"><span class="dot cl"></span>Champions League</span>
    <span class="leg-item"><span class="dot el"></span>Europa League</span>
    <span class="leg-item"><span class="dot rel"></span>Relegation</span>`;
}

// ── Zone for a given table position (relegation / promotion bands) ──
function getZone(pos, total, league) {
  const groupId = league?.pyramidGroupId;
  const group = groupId ? pyramidGroups[groupId] : null;

  if (group && league.pyramidRole === "tier1") {
    const relegateCount = Math.min(group.relegateCount || 0, total);
    if (relegateCount > 0 && pos > total - relegateCount) return "rel";
    return null;
  }

  if (group && league.pyramidRole === "tier2") {
    const promoteCount = Math.min(group.promoteCount || 0, total);
    if (promoteCount > 0 && pos <= promoteCount) return "promo";
    return null;
  }

  // Fallback — generic percentage-based zones for leagues not in a pyramid
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
  const legend = document.getElementById("standingsLegend");
  if (legend) legend.innerHTML = "";
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
      <div class="lc-top">${statusLabel}${pyramidBadgeHtml(l)}</div>
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
        <div class="ali-name">${l.name}${pyramidBadgeHtml(l)}</div>
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
  ["teamLeaguePicker", "resultLeaguePicker", "pgTier1", "pgTier2", "adjLeaguePicker"].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = ids.length ? opts : `<option value="">— No leagues —</option>`;
    if (prev && leagues[prev]) sel.value = prev;
  });

  renderAdminTeamList();
  renderResultTeamPickers();
  renderAdjTeamPicker();
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
    ? `<div class="league-locked-notice">🔒 League is live — adding new teams is locked. You can still delete a team (e.g. forfeits) below.</div>`
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
        <button class="btn-danger-sm" data-delete-team="${id}" data-league="${leagueId}" title="${isActive ? 'Delete team (allowed even while league is live)' : 'Delete team'}">✕</button>
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
  const team = leagues[leagueId]?.teams?.[teamId];
  const teamName = team?.name;
  const played = team?.played || 0;

  const warning = played > 0
    ? `"${teamName}" has already played ${played} match${played === 1 ? "" : "es"}. Deleting them will also erase their fixtures and any recorded results involving them.\n\nThis cannot be undone. Continue?`
    : `Remove "${teamName}" from the league?\n\nThis will also remove all their fixtures. Cannot be undone.`;

  if (!confirm(warning)) return;

  // Remove all fixtures involving this team
  if (leagues[leagueId].fixtures) {
    leagues[leagueId].fixtures = leagues[leagueId].fixtures.filter(
      f => f.homeId !== teamId && f.awayId !== teamId
    );
  }
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

// ── Points adjustment (award / deduct without a match) ──
function adjustPoints() {
  const leagueId = document.getElementById("adjLeaguePicker").value;
  const teamId   = document.getElementById("adjTeamPicker").value;
  const amount   = parseInt(document.getElementById("adjAmount").value);
  const type     = document.getElementById("adjType").value; // "award" | "deduct"
  const reason   = document.getElementById("adjReason").value.trim();

  if (!leagueId || !teamId) { toast("Select league and team", "error"); return; }
  if (isNaN(amount) || amount <= 0) { toast("Enter a valid point amount", "error"); return; }

  const team = leagues[leagueId]?.teams?.[teamId];
  if (!team) { toast("Team not found", "error"); return; }

  const delta = type === "award" ? amount : -amount;
  team.points = Math.max(0, (team.points || 0) + delta);

  // Log the adjustment on the team for transparency
  team.pointAdjustments = team.pointAdjustments || [];
  team.pointAdjustments.push({ type, amount, reason: reason || "", ts: Date.now() });

  document.getElementById("adjAmount").value = "";
  document.getElementById("adjReason").value = "";

  renderAll();
  fsSyncLeague(leagueId);
  toast(`${type === "award" ? "+" : "-"}${amount} pts for ${team.name}${reason ? ` (${reason})` : ""}`, "success");
}

function renderAdjTeamPicker() {
  const leagueId = document.getElementById("adjLeaguePicker").value;
  const picker = document.getElementById("adjTeamPicker");
  picker.innerHTML = "<option value=\"\">— Select team —</option>";
  if (!leagueId || !leagues[leagueId]) return;
  Object.entries(leagues[leagueId].teams || {}).forEach(([id, t]) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = t.name;
    picker.appendChild(opt);
  });
}

function switchView(name) {
  if (!name) return;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view" + name[0].toUpperCase() + name.slice(1))?.classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  if (name === "fixtures") renderFixturesView();
  if (name === "hof") renderHof();
  if (name === "mcl") { mclLoadState(); mclRenderAdminVisibility(); }
}

function openAdmin() {
  document.getElementById("adminPanel").classList.add("open");
  document.getElementById("overlay").classList.add("open");
}

function closeAdmin() {
  document.getElementById("adminPanel").classList.remove("open");
  document.getElementById("overlay").classList.remove("open");
}

async function unlockAdmin() {
  const pw = document.getElementById("adminPwInput").value;
  if (!pw) return;
  const inputHash = await sha256(pw);
  const isMaster = (inputHash === MASTER_PW_HASH);
  const isActive = activePwHash && (inputHash === activePwHash);
  if (isMaster || isActive) {
    adminUnlocked = true;
    document.getElementById("adminGate").classList.add("hidden");
    document.getElementById("adminWorkspace").classList.remove("hidden");
    document.getElementById("adminPwInput").value = "";
    document.getElementById("gateError").classList.add("hidden");
    renderFixturesView();
    mclRenderAdminVisibility();
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
  mclRenderAdminVisibility();
}

async function changeAdminPassword() {
  const current = document.getElementById("changePwCurrent").value;
  const newPw   = document.getElementById("changePwNew").value;
  const confirm = document.getElementById("changePwConfirm").value;
  const errEl   = document.getElementById("changePwError");

  if (!current || !newPw || !confirm) { errEl.textContent = "Fill in all fields."; errEl.classList.remove("hidden"); return; }
  if (newPw !== confirm) { errEl.textContent = "New passwords don't match."; errEl.classList.remove("hidden"); return; }
  if (newPw.length < 6) { errEl.textContent = "New password must be at least 6 characters."; errEl.classList.remove("hidden"); return; }

  const currentHash = await sha256(current);
  const isMaster = (currentHash === MASTER_PW_HASH);
  const isActive  = activePwHash && (currentHash === activePwHash);
  if (!isMaster && !isActive) { errEl.textContent = "Current password is wrong."; errEl.classList.remove("hidden"); return; }

  // Cannot overwrite the master password — but you can set whatever you want as active
  const newHash = await sha256(newPw);
  activePwHash = newHash;
  await saveAdminPwToFirestore(newHash);

  ["changePwCurrent","changePwNew","changePwConfirm"].forEach(id => document.getElementById(id).value = "");
  errEl.classList.add("hidden");
  toast("Password changed!", "success");
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
//  HALL OF FAME
// ══════════════════════════════════════════════
let hofEntries = JSON.parse(localStorage.getItem("mpl_hof") || "[]");

function saveHof() {
  localStorage.setItem("mpl_hof", JSON.stringify(hofEntries));
  // If firebase ready, sync to Firestore too
  if (firebaseReady) {
    db.collection("meta").doc("hof").set({ entries: hofEntries })
      .catch(e => console.warn("HOF sync error:", e.message));
  }
}

async function loadHofFromFirestore() {
  if (!firebaseReady) return;
  try {
    const doc = await db.collection("meta").doc("hof").get();
    if (doc.exists && doc.data().entries) {
      hofEntries = doc.data().entries;
      localStorage.setItem("mpl_hof", JSON.stringify(hofEntries));
    }
  } catch (e) { console.warn("HOF load error:", e.message); }
}

function renderHof() {
  const body = document.getElementById("hofBody");
  if (!hofEntries.length) {
    body.innerHTML = `<div class="hof-empty">No champions yet. Season winners are pinned here by Admin.</div>`;
    return;
  }

  // Build win-count map (champion name -> count)
  const winCount = {};
  hofEntries.forEach(e => {
    const key = e.champion.trim().toLowerCase();
    winCount[key] = (winCount[key] || 0) + 1;
  });

  // Sorted unique champions by total wins (for the leaderboard)
  const champBoard = Object.entries(
    hofEntries.reduce((acc, e) => {
      const key = e.champion.trim();
      if (!acc[key]) acc[key] = { champion: key, wins: 0, seasons: [] };
      acc[key].wins++;
      acc[key].seasons.push(`${e.league} – ${e.season}${e.points ? ` (${e.points} pts)` : ""}`);
      return acc;
    }, {})
  ).sort((a, b) => b[1].wins - a[1].wins);

  // Champion board at the top
  let html = `<div class="hof-board">
    <div class="hof-board-title">Champions Board</div>
    <div class="hof-board-list">` +
    champBoard.map(([, c], i) => `
      <div class="hof-board-row">
        <span class="hof-board-rank">${i + 1}</span>
        <span class="hof-board-name">${c.champion}</span>
        <span class="hof-board-wins">${c.wins} 🏆</span>
      </div>`).join("") +
    `</div>
  </div>`;

  // All pinned seasons below (every entry = gold trophy)
  html += `<div class="hof-wrap">` +
    hofEntries.map((e, i) => `
    <div class="hof-card" data-hof-view="${i}" role="button" tabindex="0">
      ${e.photo
        ? `<img class="hof-photo" src="${e.photo}" alt="${e.champion}" />`
        : `<div class="hof-trophy">🏆</div>`}
      <div class="hof-info">
        <div class="hof-champion-name">${e.champion}</div>
        <div class="hof-meta">
          <span>${e.league}</span>
          <span>${e.season}</span>
          ${e.points ? `<span class="hof-pts">${e.points} pts</span>` : ""}
        </div>
      </div>
      <span class="hof-card-arrow">›</span>
    </div>`).join("") +
    `</div>`;

  body.innerHTML = html;

  body.querySelectorAll("[data-hof-view]").forEach(card => {
    card.addEventListener("click", () => openHofProfileModal(parseInt(card.dataset.hofView)));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openHofProfileModal(parseInt(card.dataset.hofView)); }
    });
  });
}

// ── Champion profile card modal ──
function openHofProfileModal(index) {
  const e = hofEntries[index];
  if (!e) return;

  document.getElementById("hofProfileModal")?.remove();

  const key = e.champion.trim().toLowerCase();
  const wins = hofEntries.filter(x => x.champion.trim().toLowerCase() === key).length;
  const otherSeasons = hofEntries.filter((x, i) => i !== index && x.champion.trim().toLowerCase() === key);

  const modal = document.createElement("div");
  modal.id = "hofProfileModal";
  modal.className = "fx-modal-overlay";
  modal.innerHTML = `
    <div class="fx-modal hof-profile-modal">
      <div class="fx-modal-header">
        <span>Champion Profile</span>
        <button class="fx-modal-close" id="hofProfileClose">✕</button>
      </div>
      <div class="fx-modal-body hof-profile-body">
        ${e.photo
          ? `<img class="hof-profile-photo" src="${e.photo}" alt="${e.champion}" />`
          : `<div class="hof-profile-trophy">🏆</div>`}
        <div class="hof-profile-name">${e.champion}</div>
        <div class="hof-profile-wins">${wins} ${wins === 1 ? "title" : "titles"} 🏆</div>

        <div class="hof-profile-stats">
          <div class="hof-profile-stat">
            <div class="hof-profile-stat-label">League</div>
            <div class="hof-profile-stat-value">${e.league}</div>
          </div>
          <div class="hof-profile-stat">
            <div class="hof-profile-stat-label">Season</div>
            <div class="hof-profile-stat-value">${e.season}</div>
          </div>
          ${e.points ? `<div class="hof-profile-stat">
            <div class="hof-profile-stat-label">Points</div>
            <div class="hof-profile-stat-value">${e.points}</div>
          </div>` : ""}
        </div>

        ${otherSeasons.length ? `
          <div class="hof-profile-history">
            <div class="hof-profile-history-title">Other titles</div>
            ${otherSeasons.map(s => `<div class="hof-profile-history-row">🏆 ${s.league} – ${s.season}${s.points ? ` (${s.points} pts)` : ""}</div>`).join("")}
          </div>` : ""}
      </div>
    </div>`;

  document.body.appendChild(modal);
  document.getElementById("hofProfileClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", ev => { if (ev.target === modal) modal.remove(); });
}

function renderAdminHofList() {
  const list = document.getElementById("adminHofList");
  if (!list) return;
  if (!hofEntries.length) {
    list.innerHTML = `<p style="color:var(--text3);font-size:13px;">No entries yet.</p>`;
    return;
  }
  list.innerHTML = hofEntries.map((e, i) => `
    <div class="hof-admin-item">
      <div style="display:flex;align-items:center;gap:10px;">
        ${e.photo ? `<img src="${e.photo}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1.5px solid var(--gold,#f0b429);flex-shrink:0;" />` : `<span style="font-size:20px;">🏆</span>`}
        <div>
          <div class="hof-admin-champion">${e.champion}</div>
          <div class="hof-admin-meta">${e.league} · ${e.season}${e.points ? ` · ${e.points} pts` : ""}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn-ghost-sm" data-hof-photo-idx="${i}" title="Change photo">🖼</button>
        <button class="btn-danger-sm" data-hof-idx="${i}">Remove</button>
      </div>
    </div>`).join("");
  list.querySelectorAll("[data-hof-photo-idx]").forEach(btn => {
    btn.addEventListener("click", () => triggerHofPhotoUpload(parseInt(btn.dataset.hofPhotoIdx)));
  });
  list.querySelectorAll("[data-hof-idx]").forEach(btn => {
    btn.addEventListener("click", () => {
      hofEntries.splice(parseInt(btn.dataset.hofIdx), 1);
      saveHof();
      renderAdminHofList();
      renderHof();
      toast("Entry removed", "success");
    });
  });
}

async function pinHofEntry() {
  const champion = document.getElementById("hofChampion").value.trim();
  const league   = document.getElementById("hofLeagueName").value.trim();
  const season   = document.getElementById("hofSeason").value.trim();
  const pts      = document.getElementById("hofPoints").value.trim();
  const photoFile = document.getElementById("hofPhoto")?.files?.[0];
  if (!champion || !league || !season) { toast("Fill in champion, league and season", "error"); return; }

  let photo = null;
  if (photoFile) {
    try { photo = await imageFileToBase64(photoFile, 120); }
    catch (e) { toast("Image failed to load", "error"); return; }
  }

  hofEntries.unshift({ champion, league, season, points: pts ? parseInt(pts) : null, photo, pinnedAt: Date.now() });
  saveHof();
  ["hofChampion","hofLeagueName","hofSeason","hofPoints"].forEach(id => document.getElementById(id).value = "");
  if (document.getElementById("hofPhoto")) document.getElementById("hofPhoto").value = "";
  if (document.getElementById("hofPhotoPreview")) { document.getElementById("hofPhotoPreview").style.display = "none"; }
  renderAdminHofList();
  renderHof();
  toast("🏆 Pinned to Hall of Fame!", "success");
}

// ── Add/change a photo on an existing HOF entry (e.g. one pinned automatically
//    by End Season, or to swap a photo later) — same pattern as team logo upload ──
function triggerHofPhotoUpload(index) {
  const entry = hofEntries[index];
  if (!entry) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const base64 = await imageFileToBase64(file, 120);
      entry.photo = base64;
      saveHof();
      renderAdminHofList();
      renderHof();
      toast(`Photo updated for ${entry.champion}`, "success");
    } catch (e) {
      toast("Failed to load image", "error");
    }
  };
  input.click();
}

// ══════════════════════════════════════════════
//  PROMOTION / RELEGATION PYRAMID
// ══════════════════════════════════════════════

function savePyramidGroups() {
  localStorage.setItem("mpl_pyramid", JSON.stringify(pyramidGroups));
  if (firebaseReady) {
    db.collection("meta").doc("pyramid").set({ groups: pyramidGroups })
      .catch(e => console.warn("Pyramid sync error:", e.message));
  }
}

async function loadPyramidFromFirestore() {
  if (!firebaseReady) return;
  try {
    const doc = await db.collection("meta").doc("pyramid").get();
    if (doc.exists && doc.data().groups) {
      pyramidGroups = doc.data().groups;
      localStorage.setItem("mpl_pyramid", JSON.stringify(pyramidGroups));
      renderAll();
    }
  } catch (e) { console.warn("Pyramid load error:", e.message); }
}

// A season can be ended once Tier 1 and Tier 2 are both live
// with every fixture played — so we never wipe out an in-progress season.
function canEndSeason(group) {
  const tier1 = leagues[group.tier1Id];
  const tier2 = leagues[group.tier2Id];
  if (!tier1 || tier1.status !== "active" || !isLeagueComplete(tier1)) return false;
  if (!tier2 || tier2.status !== "active" || !isLeagueComplete(tier2)) return false;
  return true;
}

// ── Render the Pyramid admin tab ──
function renderPyramidAdmin() {
  const list = document.getElementById("pyramidGroupList");
  if (!list) return;

  const groupIds = Object.keys(pyramidGroups);
  if (groupIds.length === 0) {
    list.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:8px 0;">No promotion/relegation groups yet — create one below.</div>`;
  } else {
    list.innerHTML = groupIds.map(gid => {
      const g = pyramidGroups[gid];
      const t1 = leagues[g.tier1Id];
      const t2 = leagues[g.tier2Id];

      const t1Name = t1 ? t1.name : "(deleted league)";
      const t2Name = t2 ? t2.name : "(deleted league)";

      let endBtn;
      if (!t1 || !t2) {
        endBtn = "";
      } else if (canEndSeason(g)) {
        endBtn = `<button class="btn-start-sm" data-end-season="${gid}">🏁 End Season</button>`;
      } else {
        endBtn = `<button class="btn-ghost-sm" disabled title="Both leagues must be Live with every fixture played">🏁 End Season</button>`;
      }

      return `
      <div class="admin-list-item ali-league-item">
        <div style="flex:1;min-width:0;">
          <div class="ali-name">${g.name}</div>
          <div class="ali-sub">Tier 1: ${t1Name} ⇄ Tier 2: ${t2Name}</div>
          <div class="ali-sub">Relegate ${g.relegateCount||0} ↓ · Promote ${g.promoteCount||0} ↑</div>
        </div>
        <div class="ali-actions" style="flex-direction:column;gap:4px;align-items:flex-end;">
          ${endBtn}
          <button class="btn-danger-sm" data-delete-group="${gid}">Delete</button>
        </div>
      </div>`;
    }).join("");
  }

  list.querySelectorAll("[data-end-season]").forEach(btn => {
    btn.addEventListener("click", () => openEndSeasonModal(btn.dataset.endSeason));
  });
  list.querySelectorAll("[data-delete-group]").forEach(btn => {
    btn.addEventListener("click", () => deletePyramidGroup(btn.dataset.deleteGroup));
  });
}

// ── Create a new pyramid group ──
function createPyramidGroup() {
  const name = document.getElementById("pgName").value.trim();
  const tier1Id = document.getElementById("pgTier1").value;
  const tier2Id = document.getElementById("pgTier2").value;
  const relegateCount = parseInt(document.getElementById("pgRelegate").value) || 0;
  const promoteCount = parseInt(document.getElementById("pgPromote").value) || 0;

  if (!name) { toast("Enter a group name", "error"); return; }
  if (!tier1Id || !tier2Id) { toast("Select both Tier 1 and Tier 2 leagues", "error"); return; }
  if (tier1Id === tier2Id) { toast("Tier 1 and Tier 2 must be different leagues", "error"); return; }

  const id = "pgroup-" + Date.now();
  pyramidGroups[id] = { id, name, tier1Id, tier2Id, relegateCount, promoteCount };

  // Tag the linked leagues so standings/legend know their pyramid role
  if (leagues[tier1Id]) { leagues[tier1Id].pyramidGroupId = id; leagues[tier1Id].pyramidRole = "tier1"; fsSyncLeague(tier1Id); }
  if (leagues[tier2Id]) { leagues[tier2Id].pyramidGroupId = id; leagues[tier2Id].pyramidRole = "tier2"; fsSyncLeague(tier2Id); }

  document.getElementById("pgName").value = "";

  savePyramidGroups();
  renderAll();
  toast(`"${name}" pyramid group created!`, "success");
}

// ── Delete a pyramid group (leagues & data are untouched, just unlinked) ──
function deletePyramidGroup(id) {
  const g = pyramidGroups[id];
  if (!g) return;
  if (!confirm(`Delete pyramid group "${g.name}"? Leagues stay as they are — only the promotion/relegation link is removed.`)) return;

  [g.tier1Id, g.tier2Id].forEach(lid => {
    if (lid && leagues[lid] && leagues[lid].pyramidGroupId === id) {
      delete leagues[lid].pyramidGroupId;
      delete leagues[lid].pyramidRole;
      fsSyncLeague(lid);
    }
  });

  delete pyramidGroups[id];
  savePyramidGroups();
  renderAll();
  toast(`"${g.name}" group deleted.`, "success");
}

// ── End-of-season preview modal ──
function openEndSeasonModal(groupId) {
  const group = pyramidGroups[groupId];
  if (!group) return;
  if (!canEndSeason(group)) {
    toast("Both leagues must be Live with every fixture played first", "error");
    return;
  }

  const tier1 = leagues[group.tier1Id];
  const tier2 = leagues[group.tier2Id];

  const standings1 = getStandingsSorted(tier1);
  const standings2 = getStandingsSorted(tier2);
  const total1 = standings1.length;
  const total2 = standings2.length;

  const relegateCount = Math.min(group.relegateCount || 0, total1);
  const promoteCount = Math.min(group.promoteCount || 0, total2);

  const champion = standings1[0]?.[1];
  const relegated = standings1.slice(total1 - relegateCount);
  const promoted = standings2.slice(0, promoteCount);

  document.getElementById("esModal")?.remove();

  const listHtml = (entries, emptyText) => entries.length
    ? `<ul class="es-list">${entries.map(([, t]) => `<li>${crestHtml(t, 20, 9)}<span>${t.name}</span></li>`).join("")}</ul>`
    : `<p class="es-empty">${emptyText}</p>`;

  const modal = document.createElement("div");
  modal.id = "esModal";
  modal.className = "fx-modal-overlay";
  modal.innerHTML = `
    <div class="fx-modal es-modal">
      <div class="fx-modal-header">
        <span>End Season — ${group.name}</span>
        <button class="fx-modal-close" id="esModalClose">✕</button>
      </div>
      <div class="fx-modal-body">
        ${champion ? `<div class="es-section">
          <div class="es-section-title">🏆 Champion</div>
          <div class="es-champion">${crestHtml(champion, 28, 11)}<span>${champion.name}</span></div>
        </div>` : ""}

        <div class="es-section">
          <div class="es-section-title">⬆️ Promoted to ${tier1.name}</div>
          ${listHtml(promoted, "No teams promoted.")}
        </div>

        <div class="es-section">
          <div class="es-section-title">⬇️ Relegated to ${tier2.name}</div>
          ${listHtml(relegated, "No teams relegated.")}
        </div>

        <p class="es-note">Both leagues reset to Setup for the new season — fixtures cleared, all stats zeroed.${champion ? ` ${champion.name} will be pinned to the Hall of Fame.` : ""}</p>

        <div style="display:flex;gap:8px;margin-top:6px;">
          <button class="btn-primary full" id="esConfirmBtn">Confirm & Apply</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  document.getElementById("esModalClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("esConfirmBtn").addEventListener("click", () => {
    applyEndSeason(groupId);
    modal.remove();
  });
}

// ── Apply promotion & relegation ──
function applyEndSeason(groupId) {
  const group = pyramidGroups[groupId];
  if (!group) return;
  if (!canEndSeason(group)) {
    toast("Both leagues must be Live with every fixture played first", "error");
    return;
  }

  const tier1 = leagues[group.tier1Id];
  const tier2 = leagues[group.tier2Id];

  const standings1 = getStandingsSorted(tier1);
  const standings2 = getStandingsSorted(tier2);
  const total1 = standings1.length;
  const total2 = standings2.length;

  const relegateCount = Math.min(group.relegateCount || 0, total1);
  const promoteCount = Math.min(group.promoteCount || 0, total2);

  // Pin the champion to the Hall of Fame (read stats BEFORE anything is reset)
  const champEntry = standings1[0];
  if (champEntry) {
    const champ = champEntry[1];
    hofEntries.unshift({
      champion: champ.name,
      league: tier1.name,
      season: tier1.season || "",
      points: champ.points || null,
      photo: null,
      pinnedAt: Date.now()
    });
    saveHof();
    renderAdminHofList();
  }

  // Relegate bottom Tier 1 teams → Tier 2
  const relegated = standings1.slice(total1 - relegateCount);
  relegated.forEach(([id, team]) => {
    delete tier1.teams[id];
    tier2.teams[id] = resetTeamSeason(team);
  });

  // Promote top Tier 2 teams → Tier 1
  const promoted = standings2.slice(0, promoteCount);
  promoted.forEach(([id, team]) => {
    delete tier2.teams[id];
    tier1.teams[id] = resetTeamSeason(team);
  });

  // Reset everyone else's stats for the new season
  Object.values(tier1.teams).forEach(resetTeamSeason);
  Object.values(tier2.teams).forEach(resetTeamSeason);

  tier1.fixtures = [];
  tier1.status = "setup";
  tier2.fixtures = [];
  tier2.status = "setup";

  renderAll();
  fsSyncLeague(group.tier1Id);
  fsSyncLeague(group.tier2Id);
  toast(`Season ended! Promotion & relegation applied — both leagues are back in Setup.`, "success");
}

// ══════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════
// ════════════════════════════════════════════════
//  MCL — Mobile Champions League
//  Shares the same Firebase project/db as MPL.
//  Uses the SAME admin session as MPL (adminUnlocked).
// ════════════════════════════════════════════════

let mclState = {
  groups: {},      // { A: [{name,P,W,D,L,GF,GA,pts}], ... }
  qualified: [],   // [teamName,...]
  r16: [],         // [{id, home, away, leg1H, leg1A, leg2H, leg2A, winner, eliminated}]
  qf: [],
  sf: [],
  final: {}
};
let mclUnsub = null;

function mclLoadState() {
  if (!firebaseReady) return;
  // Render instantly from cache
  const cached = localStorage.getItem("mcl_state");
  if (cached) {
    try { mclState = { ...mclState, ...JSON.parse(cached) }; mclRender(); } catch (e) {}
  }
  // Stay in sync with Firestore in real time (only subscribe once)
  if (mclUnsub) return;
  mclUnsub = db.collection("mcl").doc("season").onSnapshot(snap => {
    if (snap.exists) {
      mclState = { ...mclState, ...snap.data() };
      localStorage.setItem("mcl_state", JSON.stringify(mclState));
      mclRender();
    }
  }, e => console.warn("MCL sync error:", e.message));
}

async function mclSaveState() {
  if (!firebaseReady) return;
  await db.collection("mcl").doc("season").set(mclState)
    .catch(e => console.warn("MCL save error:", e.message));
}

function mclRenderAdminVisibility() {
  ["mclAdminGroup", "mclAdminR16"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = adminUnlocked ? "block" : "none";
  });
  const controls = document.getElementById("mclSeasonControls");
  if (controls) controls.style.display = adminUnlocked ? "flex" : "none";
}

// ── Group stage ──
function mclAddTeamToGroup() {
  if (!adminUnlocked) return;
  const g = document.getElementById("mclGroupSelect").value;
  const name = document.getElementById("mclTeamNameInput").value.trim();
  if (!name) { toast("Enter a team name", "error"); return; }
  const P = +document.getElementById("mclStatP").value || 0;
  const W = +document.getElementById("mclStatW").value || 0;
  const D = +document.getElementById("mclStatD").value || 0;
  const L = +document.getElementById("mclStatL").value || 0;
  const GF = +document.getElementById("mclStatGF").value || 0;
  const GA = +document.getElementById("mclStatGA").value || 0;
  const pts = W * 3 + D;
  if (!mclState.groups[g]) mclState.groups[g] = [];
  const idx = mclState.groups[g].findIndex(t => t.name === name);
  const teamData = { name, P, W, D, L, GF, GA, pts };
  if (idx >= 0) mclState.groups[g][idx] = teamData;
  else mclState.groups[g].push(teamData);
  mclState.groups[g].sort((a, b) => (b.pts - a.pts) || ((b.GF - b.GA) - (a.GF - a.GA)));
  mclSaveState().then(() => toast(`${name} added to Group ${g}`, "success"));
  document.getElementById("mclTeamNameInput").value = "";
  ["mclStatP","mclStatW","mclStatD","mclStatL","mclStatGF","mclStatGA"].forEach(id => document.getElementById(id).value = 0);
}

function mclRemoveTeamFromGroup(g, name) {
  if (!adminUnlocked) return;
  if (!confirm(`Remove "${name}" from Group ${g}? This also removes them from R16 if qualified.`)) return;
  mclState.groups[g] = mclState.groups[g].filter(t => t.name !== name);
  mclState.qualified = mclState.qualified.filter(q => q !== name);
  mclSaveState().then(() => toast(`${name} removed`, "success"));
}

function mclMarkQualified() {
  if (!adminUnlocked) return;
  const sel = document.getElementById("mclQualifySelect");
  const name = sel.value;
  if (!name) { toast("Pick a team", "error"); return; }
  if (mclState.qualified.includes(name)) { toast("Already qualified", "error"); return; }
  if (mclState.qualified.length >= 16) { toast("Already 16 teams qualified", "error"); return; }
  mclState.qualified.push(name);
  mclSaveState().then(() => toast(`${name} qualified!`, "success"));
}

function mclUnqualify(name) {
  if (!adminUnlocked) return;
  mclState.qualified = mclState.qualified.filter(q => q !== name);
  mclSaveState().then(() => toast(`${name} removed from R16`, "success"));
}

// ── R16 ──
function mclAddR16Matchup() {
  if (!adminUnlocked) return;
  const home = document.getElementById("mclR16Home").value;
  const away = document.getElementById("mclR16Away").value;
  if (!home || !away) { toast("Select both teams", "error"); return; }
  if (home === away) { toast("Same team selected", "error"); return; }
  if (mclState.r16.length >= 8) { toast("R16 is full (8 matchups)", "error"); return; }
  const id = Date.now().toString();
  mclState.r16.push({ id, home, away, leg1H: null, leg1A: null, leg2H: null, leg2A: null, winner: null, eliminated: null });
  mclSaveState().then(() => toast("Matchup added", "success"));
}

function mclSaveR16Score(id) {
  if (!adminUnlocked) return;
  const m = mclState.r16.find(x => x.id === id);
  if (!m) return;
  m.leg1H = parseFloat(document.getElementById(`mcl_l1h_${id}`).value);
  m.leg1A = parseFloat(document.getElementById(`mcl_l1a_${id}`).value);
  m.leg2H = parseFloat(document.getElementById(`mcl_l2h_${id}`).value);
  m.leg2A = parseFloat(document.getElementById(`mcl_l2a_${id}`).value);
  if (isNaN(m.leg1H)) m.leg1H = null;
  if (isNaN(m.leg1A)) m.leg1A = null;
  if (isNaN(m.leg2H)) m.leg2H = null;
  if (isNaN(m.leg2A)) m.leg2A = null;
  mclSaveState().then(() => toast("Scores saved", "success"));
}

function mclAdvanceTeam(id, winner, eliminated) {
  if (!adminUnlocked) return;
  const m = mclState.r16.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`Advance ${winner} and eliminate ${eliminated}?`)) return;
  m.winner = winner; m.eliminated = eliminated;
  const slot = mclState.r16.indexOf(m);
  const qfIdx = Math.floor(slot / 2);
  if (!mclState.qf[qfIdx]) mclState.qf[qfIdx] = { home: null, away: null, leg1H: null, leg1A: null, leg2H: null, leg2A: null, winner: null, eliminated: null };
  if (slot % 2 === 0) mclState.qf[qfIdx].home = winner;
  else mclState.qf[qfIdx].away = winner;
  mclSaveState().then(() => toast(`${winner} advances to QF`, "success"));
}

function mclSaveQFScore(idx) {
  if (!adminUnlocked) return;
  const m = mclState.qf[idx];
  if (!m) return;
  m.leg1H = parseFloat(document.getElementById(`mcl_qfl1h_${idx}`).value);
  m.leg1A = parseFloat(document.getElementById(`mcl_qfl1a_${idx}`).value);
  m.leg2H = parseFloat(document.getElementById(`mcl_qfl2h_${idx}`).value);
  m.leg2A = parseFloat(document.getElementById(`mcl_qfl2a_${idx}`).value);
  if (isNaN(m.leg1H)) m.leg1H = null;
  if (isNaN(m.leg1A)) m.leg1A = null;
  if (isNaN(m.leg2H)) m.leg2H = null;
  if (isNaN(m.leg2A)) m.leg2A = null;
  mclSaveState().then(() => toast("QF scores saved", "success"));
}

function mclAdvanceQF(idx, winner, eliminated) {
  if (!adminUnlocked) return;
  const m = mclState.qf[idx];
  if (!m) return;
  if (!confirm(`Advance ${winner} and eliminate ${eliminated}?`)) return;
  m.winner = winner; m.eliminated = eliminated;
  const sfIdx = Math.floor(idx / 2);
  if (!mclState.sf[sfIdx]) mclState.sf[sfIdx] = { home: null, away: null, leg1H: null, leg1A: null, leg2H: null, leg2A: null, winner: null, eliminated: null };
  if (idx % 2 === 0) mclState.sf[sfIdx].home = winner;
  else mclState.sf[sfIdx].away = winner;
  mclSaveState().then(() => toast(`${winner} advances to SF`, "success"));
}

function mclSaveSFScore(idx) {
  if (!adminUnlocked) return;
  const m = mclState.sf[idx];
  if (!m) return;
  m.leg1H = parseFloat(document.getElementById(`mcl_sfl1h_${idx}`).value);
  m.leg1A = parseFloat(document.getElementById(`mcl_sfl1a_${idx}`).value);
  m.leg2H = parseFloat(document.getElementById(`mcl_sfl2h_${idx}`).value);
  m.leg2A = parseFloat(document.getElementById(`mcl_sfl2a_${idx}`).value);
  if (isNaN(m.leg1H)) m.leg1H = null;
  if (isNaN(m.leg1A)) m.leg1A = null;
  if (isNaN(m.leg2H)) m.leg2H = null;
  if (isNaN(m.leg2A)) m.leg2A = null;
  mclSaveState().then(() => toast("SF scores saved", "success"));
}

function mclAdvanceSF(idx, winner, eliminated) {
  if (!adminUnlocked) return;
  const m = mclState.sf[idx];
  if (!m) return;
  if (!confirm(`Advance ${winner} to the Final?`)) return;
  m.winner = winner; m.eliminated = eliminated;
  if (!mclState.final) mclState.final = {};
  if (idx === 0) mclState.final.teamA = winner;
  else mclState.final.teamB = winner;
  mclSaveState().then(() => toast(`${winner} is in the FINAL!`, "success"));
}

function mclSaveFinalScore() {
  if (!adminUnlocked) return;
  if (!mclState.final) mclState.final = {};
  const h = parseFloat(document.getElementById("mcl_finl1h").value);
  const a = parseFloat(document.getElementById("mcl_finl1a").value);
  mclState.final.leg1H = isNaN(h) ? null : h;
  mclState.final.leg1A = isNaN(a) ? null : a;
  mclSaveState().then(() => toast("Final score saved", "success"));
}

function mclCrownChampion(winner, other) {
  if (!adminUnlocked) return;
  if (!confirm(`Crown ${winner} as MCL Champion?`)) return;
  mclState.final.winner = winner;
  mclState.final.eliminated = other;
  mclSaveState().then(() => toast(`🏆 ${winner} is the MCL Champion!`, "success"));
}

// ── Reset MCL (hard wipe — start a brand new season) ──
function mclResetSeason() {
  if (!adminUnlocked) return;
  if (!confirm(`Reset the entire MCL?\n\nThis clears all groups, qualified teams, R16/QF/SF/Final results and the bracket. Cannot be undone.`)) return;
  mclState = { groups: {}, qualified: [], r16: [], qf: [], sf: [], final: {} };
  localStorage.removeItem("mcl_state");
  mclSaveState().then(() => {
    mclRender();
    mclRenderBracket();
    toast("MCL has been reset. Ready for a new season.", "success");
  });
}

// ── End Season — optionally pin champion to Hall of Fame, then reset ──
async function mclEndSeason() {
  if (!adminUnlocked) return;
  const champion = mclState.final?.winner;
  if (!champion) { toast("No champion crowned yet — finish the Final first.", "error"); return; }

  const pinIt = confirm(`🏆 ${champion} won the MCL!\n\nPin them to the Hall of Fame before resetting?\n\nOK = Pin to Hall of Fame, then reset\nCancel = Just reset without pinning`);
  if (pinIt) {
    const seasonLabel = prompt("Season label for the Hall of Fame (e.g. \"MCL 2026\"):", "MCL " + new Date().getFullYear());
    if (seasonLabel === null) return; // user cancelled the prompt entirely
    hofEntries.unshift({
      champion,
      league: "Mobile Champions League",
      season: seasonLabel || ("MCL " + new Date().getFullYear()),
      points: null,
      photo: null,
      pinnedAt: Date.now()
    });
    saveHof();
    renderAdminHofList();
    renderHof();
  }

  mclState = { groups: {}, qualified: [], r16: [], qf: [], sf: [], final: {} };
  localStorage.removeItem("mcl_state");
  await mclSaveState();
  mclRender();
  mclRenderBracket();
  toast(pinIt ? `🏆 ${champion} pinned to Hall of Fame. MCL reset for next season.` : "MCL reset for next season.", "success");
}

// ── RENDER ──
function mclRender() {
  mclRenderGroups();
  mclRenderQualified();
  mclRenderR16();
  mclPopulateSelects();
  const endBtn = document.getElementById("mclEndSeasonBtn");
  if (endBtn) {
    const hasChampion = !!mclState.final?.winner;
    endBtn.disabled = !hasChampion;
    endBtn.title = hasChampion ? "" : "Crown a champion in the Final first";
    endBtn.style.opacity = hasChampion ? "1" : "0.5";
  }
}

function mclRenderGroups() {
  const grid = document.getElementById("mclGroupsGrid");
  if (!grid) return;
  const keys = Object.keys(mclState.groups).sort();
  if (!keys.length) {
    grid.innerHTML = `<p style="color:var(--text3);font-size:13px">No groups yet</p>`;
    return;
  }
  grid.innerHTML = keys.map(g => {
    const teams = mclState.groups[g];
    const rows = teams.map((t, i) => {
      const posClass = i === 0 ? "mcl-pos-1" : i === 1 ? "mcl-pos-2" : "mcl-pos-other";
      const gd = t.GF - t.GA;
      const gdStr = gd > 0 ? `+${gd}` : gd;
      const adminDelete = adminUnlocked
        ? `<button class="btn-danger-sm" style="padding:1px 6px;font-size:10px;margin-left:6px" onclick="mclRemoveTeamFromGroup('${g}','${t.name.replace(/'/g, "\\'")}')">✕</button>`
        : "";
      return `<tr>
        <td><span class="mcl-pos-badge ${posClass}">${i + 1}</span>${t.name}${adminDelete}</td>
        <td>${t.P}</td><td>${t.W}</td><td>${t.D}</td><td>${t.L}</td>
        <td>${t.GF}</td><td>${t.GA}</td><td>${gdStr}</td>
        <td><strong style="color:var(--text)">${t.pts}</strong></td>
      </tr>`;
    }).join("");
    return `<div class="mcl-group-card">
      <div class="mcl-group-header"><span class="mcl-group-label">Group ${g}</span></div>
      <table class="mcl-group-table">
        <thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join("");
}

function mclRenderQualified() {
  const el = document.getElementById("mclQualifiedTeams");
  if (!el) return;
  if (!mclState.qualified.length) {
    el.innerHTML = `<span style="color:var(--text3);font-size:13px">No teams qualified yet.</span>`;
    return;
  }
  el.innerHTML = mclState.qualified.map(name => `
    <span class="mcl-q-chip">${name}
      ${adminUnlocked ? `<span class="mcl-unq" onclick="mclUnqualify('${name.replace(/'/g, "\\'")}')">×</span>` : ""}
    </span>`).join("");
}

function mclRenderR16() {
  const list = document.getElementById("mclR16List");
  if (!list) return;
  if (!mclState.r16.length) {
    list.innerHTML = `<p style="color:var(--text3);font-size:13px">No matchups yet.</p>`;
    return;
  }

  list.innerHTML = mclState.r16.map(m => {
    const l1H = m.leg1H ?? ""; const l1A = m.leg1A ?? "";
    const l2H = m.leg2H ?? ""; const l2A = m.leg2A ?? "";
    const totalHome = (m.leg1H ?? 0) + (m.leg2H ?? 0);
    const totalAway = (m.leg1A ?? 0) + (m.leg2A ?? 0);
    const statusBadge = m.winner
      ? `<span class="mcl-badge-adv">${m.winner} advances</span> <span class="mcl-badge-elim">${m.eliminated} out</span>`
      : "";
    const adminControls = adminUnlocked && !m.winner ? `
      <div class="mcl-score-row">
        <span style="font-size:11px;color:var(--text3)">LEG 1</span>
        <input id="mcl_l1h_${m.id}" type="number" value="${l1H}" placeholder="0" min="0">
        <span style="font-size:11px;color:var(--text3)">–</span>
        <input id="mcl_l1a_${m.id}" type="number" value="${l1A}" placeholder="0" min="0">
        <span style="font-size:11px;color:var(--text3);margin-left:6px">LEG 2</span>
        <input id="mcl_l2h_${m.id}" type="number" value="${l2H}" placeholder="0" min="0">
        <span style="font-size:11px;color:var(--text3)">–</span>
        <input id="mcl_l2a_${m.id}" type="number" value="${l2A}" placeholder="0" min="0">
        <button class="btn-primary" style="padding:5px 10px;font-size:11px" onclick="mclSaveR16Score('${m.id}')">Save</button>
        <button class="btn-primary" style="padding:5px 10px;font-size:11px;background:#f0b429;color:#111" onclick="mclAdvanceTeam('${m.id}','${m.home.replace(/'/g,"\\'")}','${m.away.replace(/'/g,"\\'")}')">▶ ${m.home}</button>
        <button class="btn-primary" style="padding:5px 10px;font-size:11px;background:#f0b429;color:#111" onclick="mclAdvanceTeam('${m.id}','${m.away.replace(/'/g,"\\'")}','${m.home.replace(/'/g,"\\'")}')">▶ ${m.away}</button>
      </div>` : "";
    const aggStr = (m.leg1H !== null) ? `<span style="font-size:11px;color:var(--text3)">&nbsp;(agg ${totalHome}–${totalAway})</span>` : "";
    return `<div class="mcl-match-item">
      <div class="mcl-match-teams">${m.home} <span style="color:var(--text3)">vs</span> ${m.away}${aggStr}</div>
      ${statusBadge}${adminControls}
    </div>`;
  }).join("");

  // QF
  if (mclState.qf.length) {
    list.innerHTML += `<div class="mcl-round-heading">Quarter Finals</div>`;
    list.innerHTML += mclState.qf.map((m, idx) => {
      if (!m || (!m.home && !m.away)) return "";
      const home = m.home || "TBD"; const away = m.away || "TBD";
      const statusBadge = m.winner
        ? `<span class="mcl-badge-adv">${m.winner} advances</span> <span class="mcl-badge-elim">${m.eliminated} out</span>` : "";
      const adminControls = adminUnlocked && !m.winner && m.home && m.away ? `
        <div class="mcl-score-row">
          <span style="font-size:11px;color:var(--text3)">LEG 1</span>
          <input id="mcl_qfl1h_${idx}" type="number" value="${m.leg1H ?? ""}" placeholder="0" min="0">
          <span style="font-size:11px;color:var(--text3)">–</span>
          <input id="mcl_qfl1a_${idx}" type="number" value="${m.leg1A ?? ""}" placeholder="0" min="0">
          <span style="font-size:11px;color:var(--text3);margin-left:6px">LEG 2</span>
          <input id="mcl_qfl2h_${idx}" type="number" value="${m.leg2H ?? ""}" placeholder="0" min="0">
          <span style="font-size:11px;color:var(--text3)">–</span>
          <input id="mcl_qfl2a_${idx}" type="number" value="${m.leg2A ?? ""}" placeholder="0" min="0">
          <button class="btn-primary" style="padding:5px 10px;font-size:11px" onclick="mclSaveQFScore(${idx})">Save</button>
          <button class="btn-primary" style="padding:5px 10px;font-size:11px;background:#f0b429;color:#111" onclick="mclAdvanceQF(${idx},'${home.replace(/'/g,"\\'")}','${away.replace(/'/g,"\\'")}')">▶ ${home}</button>
          <button class="btn-primary" style="padding:5px 10px;font-size:11px;background:#f0b429;color:#111" onclick="mclAdvanceQF(${idx},'${away.replace(/'/g,"\\'")}','${home.replace(/'/g,"\\'")}')">▶ ${away}</button>
        </div>` : "";
      return `<div class="mcl-match-item">
        <div class="mcl-match-teams">${home} <span style="color:var(--text3)">vs</span> ${away}</div>
        ${statusBadge}${adminControls}
      </div>`;
    }).join("");
  }

  // SF
  if (mclState.sf.length) {
    list.innerHTML += `<div class="mcl-round-heading">Semi Finals</div>`;
    list.innerHTML += mclState.sf.map((m, idx) => {
      if (!m || (!m.home && !m.away)) return "";
      const home = m.home || "TBD"; const away = m.away || "TBD";
      const statusBadge = m.winner
        ? `<span class="mcl-badge-adv">${m.winner} to Final</span> <span class="mcl-badge-elim">${m.eliminated} out</span>` : "";
      const adminControls = adminUnlocked && !m.winner && m.home && m.away ? `
        <div class="mcl-score-row">
          <span style="font-size:11px;color:var(--text3)">LEG 1</span>
          <input id="mcl_sfl1h_${idx}" type="number" value="${m.leg1H ?? ""}" placeholder="0" min="0">
          <span style="font-size:11px;color:var(--text3)">–</span>
          <input id="mcl_sfl1a_${idx}" type="number" value="${m.leg1A ?? ""}" placeholder="0" min="0">
          <span style="font-size:11px;color:var(--text3);margin-left:6px">LEG 2</span>
          <input id="mcl_sfl2h_${idx}" type="number" value="${m.leg2H ?? ""}" placeholder="0" min="0">
          <span style="font-size:11px;color:var(--text3)">–</span>
          <input id="mcl_sfl2a_${idx}" type="number" value="${m.leg2A ?? ""}" placeholder="0" min="0">
          <button class="btn-primary" style="padding:5px 10px;font-size:11px" onclick="mclSaveSFScore(${idx})">Save</button>
          <button class="btn-primary" style="padding:5px 10px;font-size:11px;background:#f0b429;color:#111" onclick="mclAdvanceSF(${idx},'${home.replace(/'/g,"\\'")}','${away.replace(/'/g,"\\'")}')">▶ ${home}</button>
          <button class="btn-primary" style="padding:5px 10px;font-size:11px;background:#f0b429;color:#111" onclick="mclAdvanceSF(${idx},'${away.replace(/'/g,"\\'")}','${home.replace(/'/g,"\\'")}')">▶ ${away}</button>
        </div>` : "";
      return `<div class="mcl-match-item">
        <div class="mcl-match-teams">${home} <span style="color:var(--text3)">vs</span> ${away}</div>
        ${statusBadge}${adminControls}
      </div>`;
    }).join("");
  }

  // Final
  if (mclState.final && (mclState.final.teamA || mclState.final.teamB)) {
    const tA = mclState.final.teamA || "TBD"; const tB = mclState.final.teamB || "TBD";
    const statusBadge = mclState.final.winner
      ? `<span class="mcl-badge-adv">🏆 ${mclState.final.winner} Champion</span>` : "";
    const adminControls = adminUnlocked && !mclState.final.winner && mclState.final.teamA && mclState.final.teamB ? `
      <div class="mcl-score-row">
        <span style="font-size:11px;color:var(--text3)">SCORE</span>
        <input id="mcl_finl1h" type="number" value="${mclState.final.leg1H ?? ""}" placeholder="0" min="0">
        <span style="font-size:11px;color:var(--text3)">–</span>
        <input id="mcl_finl1a" type="number" value="${mclState.final.leg1A ?? ""}" placeholder="0" min="0">
        <button class="btn-primary" style="padding:5px 10px;font-size:11px" onclick="mclSaveFinalScore()">Save</button>
        <button class="btn-primary" style="padding:5px 10px;font-size:11px;background:#f0b429;color:#111" onclick="mclCrownChampion('${tA.replace(/'/g,"\\'")}','${tB.replace(/'/g,"\\'")}')">🏆 ${tA}</button>
        <button class="btn-primary" style="padding:5px 10px;font-size:11px;background:#f0b429;color:#111" onclick="mclCrownChampion('${tB.replace(/'/g,"\\'")}','${tA.replace(/'/g,"\\'")}')">🏆 ${tB}</button>
      </div>` : "";
    list.innerHTML += `
      <div class="mcl-round-heading">⭐ Final</div>
      <div class="mcl-match-item mcl-final-item">
        <div class="mcl-match-teams">${tA} <span style="color:var(--text3)">vs</span> ${tB}</div>
        ${statusBadge}${adminControls}
      </div>`;
  }
}

function mclRenderBracket() {
  const el = document.getElementById("mclBracketView");
  if (!el) return;

  const teamEl = (name, type = "normal") => {
    if (!name) return `<div class="mcl-bteam tbd">TBD</div>`;
    const cls = type === "winner" ? "winner" : type === "elim" ? "eliminated" : "";
    return `<div class="mcl-bteam ${cls}">${name}</div>`;
  };
  const matchupEl = (m) => {
    if (!m) return `<div class="mcl-matchup">${teamEl(null)}${teamEl(null)}</div>`;
    const hType = m.winner === m.home ? "winner" : m.eliminated === m.home ? "elim" : "normal";
    const aType = m.winner === m.away ? "winner" : m.eliminated === m.away ? "elim" : "normal";
    return `<div class="mcl-matchup">${teamEl(m.home, hType)}<div class="mcl-bsep"></div>${teamEl(m.away, aType)}</div>`;
  };

  const r16 = [...mclState.r16, ...Array(8)].slice(0, 8).map(m => m || null);
  const qf  = [...mclState.qf,  ...Array(4)].slice(0, 4).map(m => m || null);
  const sf  = [...mclState.sf,  ...Array(2)].slice(0, 2).map(m => m || null);
  const fin = mclState.final || {};

  const leftR16  = [r16[0], r16[1], r16[2], r16[3]];
  const rightR16 = [r16[4], r16[5], r16[6], r16[7]];
  const leftQF   = [qf[0], qf[1]];
  const rightQF  = [qf[2], qf[3]];
  const leftSF   = sf[0] || null;
  const rightSF  = sf[1] || null;

  const gap = (h) => `<div style="height:${h}px"></div>`;

  const colR16L = `<div class="mcl-bcol">
    <div class="mcl-round-lbl">Round of 16</div>
    ${leftR16.map((m, i) => `<div class="mcl-mwrap">${matchupEl(m)}</div>`).join("")}
  </div>`;
  const colQFL = `<div class="mcl-bcol">
    <div class="mcl-round-lbl">Quarter Final</div>
    <div style="height:24px"></div>
    ${leftQF.map((m, i) => `<div class="mcl-mwrap">${matchupEl(m)}${i < 1 ? gap(58) : ""}</div>`).join("")}
  </div>`;
  const colSFL = `<div class="mcl-bcol">
    <div class="mcl-round-lbl">Semi Final</div>
    <div style="height:54px"></div>
    <div class="mcl-mwrap">${matchupEl(leftSF)}</div>
  </div>`;

  const tA = fin.teamA || null; const tB = fin.teamB || null;
  const tAtype = fin.winner === tA ? "winner" : "normal";
  const tBtype = fin.winner === tB ? "winner" : "normal";
  const colFinal = `<div class="mcl-final-col">
    <div class="mcl-trophy-icon">🏆</div>
    <div class="mcl-final-lbl">Final</div>
    <div class="mcl-fteam ${tA ? tAtype : "tbd"}">${tA || "TBD"}</div>
    <div style="height:6px"></div>
    <div class="mcl-fteam ${tB ? tBtype : "tbd"}">${tB || "TBD"}</div>
    ${fin.winner ? `<div class="mcl-champion-banner">🏆 ${fin.winner}</div>` : ""}
  </div>`;

  const colSFR = `<div class="mcl-bcol">
    <div class="mcl-round-lbl">Semi Final</div>
    <div style="height:54px"></div>
    <div class="mcl-mwrap">${matchupEl(rightSF)}</div>
  </div>`;
  const colQFR = `<div class="mcl-bcol">
    <div class="mcl-round-lbl">Quarter Final</div>
    <div style="height:24px"></div>
    ${rightQF.map((m, i) => `<div class="mcl-mwrap">${matchupEl(m)}${i < 1 ? gap(58) : ""}</div>`).join("")}
  </div>`;
  const colR16R = `<div class="mcl-bcol">
    <div class="mcl-round-lbl">Round of 16</div>
    ${rightR16.map((m, i) => `<div class="mcl-mwrap">${matchupEl(m)}</div>`).join("")}
  </div>`;

  el.innerHTML = [colR16L, colQFL, colSFL, colFinal, colSFR, colQFR, colR16R]
    .map(c => `<div style="padding:0 4px">${c}</div>`).join("");
}

function mclPopulateSelects() {
  const qs = document.getElementById("mclQualifySelect");
  if (qs) {
    const allTeams = Object.values(mclState.groups).flat().map(t => t.name);
    const notYetQ = allTeams.filter(n => !mclState.qualified.includes(n));
    qs.innerHTML = `<option value="">— pick team —</option>` +
      notYetQ.map(n => `<option value="${n}">${n}</option>`).join("");
  }
  const used = mclState.r16.flatMap(m => [m.home, m.away]);
  const avail = mclState.qualified.filter(n => !used.includes(n));
  ["mclR16Home", "mclR16Away"].forEach(id => {
    const s = document.getElementById(id);
    if (!s) return;
    s.innerHTML = `<option value="">— select —</option>` +
      avail.map(n => `<option value="${n}">${n}</option>`).join("");
  });
}

// ── MCL tab switching ──
function mclSwitchTab(tab) {
  document.querySelectorAll(".mcl-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.mcltab === tab);
  });
  document.querySelectorAll(".mcl-page").forEach(p => p.classList.remove("active"));
  document.getElementById("mcl-page-" + tab)?.classList.add("active");
  if (tab === "bracket") mclRenderBracket();
}

document.addEventListener("DOMContentLoaded", () => {

  // Nav
  document.querySelectorAll(".nav-btn").forEach(btn => {
    if (!btn.dataset.view) return; // skip non-view buttons like the admin trigger
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
      if (tab.dataset.atab === "hof") renderAdminHofList();
      if (tab.dataset.atab === "pyramid") renderPyramidAdmin();
      if (tab.dataset.atab === "points") renderAdjTeamPicker();
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

  // Pyramid (promotion/relegation)
  document.getElementById("createPyramidGroupBtn").addEventListener("click", createPyramidGroup);
  document.getElementById("pgName").addEventListener("keydown", e => { if (e.key === "Enter") createPyramidGroup(); });

  // Hall of Fame
  document.getElementById("pinHofBtn")?.addEventListener("click", pinHofEntry);
  document.getElementById("hofPhoto")?.addEventListener("change", async function() {
    const file = this.files[0];
    const preview = document.getElementById("hofPhotoPreview");
    if (file && preview) {
      const base64 = await imageFileToBase64(file, 120);
      preview.src = base64;
      preview.style.display = "block";
    } else if (preview) {
      preview.style.display = "none";
    }
  });
  renderAdminHofList();
  renderHof();

  // Points adjustment
  document.getElementById("adjBtn")?.addEventListener("click", adjustPoints);
  document.getElementById("adjLeaguePicker")?.addEventListener("change", renderAdjTeamPicker);

  // Change password
  document.getElementById("changePwBtn")?.addEventListener("click", changeAdminPassword);

  // Admin tabs — add points + security tabs
  document.querySelectorAll(".atab").forEach(tab => {
    // already handled above but need to handle new tabs too
    if (tab.dataset.atab === "points") renderAdjTeamPicker();
  });

  // ── MCL wiring ──
  document.querySelectorAll(".mcl-tab").forEach(tab => {
    tab.addEventListener("click", () => mclSwitchTab(tab.dataset.mcltab));
  });
  document.getElementById("mclAddTeamBtn")?.addEventListener("click", mclAddTeamToGroup);
  document.getElementById("mclMarkQualifiedBtn")?.addEventListener("click", mclMarkQualified);
  document.getElementById("mclAddR16Btn")?.addEventListener("click", mclAddR16Matchup);
  document.getElementById("mclEndSeasonBtn")?.addEventListener("click", mclEndSeason);
  document.getElementById("mclResetBtn")?.addEventListener("click", mclResetSeason);

  initFirebase();
});