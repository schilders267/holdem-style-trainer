const tableStorageKey = "holdem-style-table-players";
const tableDismissedStorageKey = "holdem-style-table-dismissed";
const tableSeenStorageKey = "holdem-style-table-seen-snaps";
const tableSeatLimit = 9;

const state = {
  captures: [],
  baseline: null,
  access: null,
  tablePlayers: loadTablePlayers(),
  dismissedTablePlayers: loadStoredKeys(tableDismissedStorageKey),
  seenTableSnaps: loadStoredKeys(tableSeenStorageKey),
  hasLoadedCaptures: false,
  selectedId: null,
  query: ""
};

const captureList = document.querySelector("#captureList");
const players = document.querySelector("#players");
const emptyState = document.querySelector("#emptyState");
const analysisView = document.querySelector("#analysisView");
const activeTitle = document.querySelector("#activeTitle");
const activeStatus = document.querySelector("#activeStatus");
const tableSummary = document.querySelector("#tableSummary");
const captureCount = document.querySelector("#captureCount");
const playerCount = document.querySelector("#playerCount");
const connection = document.querySelector("#connection");
const refreshBtn = document.querySelector("#refreshBtn");
const clearTableBtn = document.querySelector("#clearTableBtn");
const playerSearch = document.querySelector("#playerSearch");
const clearSearch = document.querySelector("#clearSearch");
const playersTitle = document.querySelector("#playersTitle");
const showAllBtn = document.querySelector("#showAllBtn");
const scopeLabel = document.querySelector("#scopeLabel");
const clearPlayersBtn = document.querySelector("#clearPlayersBtn");
const baselineUpdated = document.querySelector("#baselineUpdated");
const baselineStats = document.querySelector("#baselineStats");
const updateBaselineBtn = document.querySelector("#updateBaselineBtn");
const phoneCaptureUrl = document.querySelector("#phoneCaptureUrl");
const phoneLanUrl = document.querySelector("#phoneLanUrl");
const copyPhoneUrlBtn = document.querySelector("#copyPhoneUrlBtn");
const tableSeatCount = document.querySelector("#tableSeatCount");

refreshBtn.addEventListener("click", loadCaptures);
clearTableBtn.addEventListener("click", clearTable);
updateBaselineBtn.addEventListener("click", updateBaseline);
copyPhoneUrlBtn.addEventListener("click", copyPhoneUrl);
playerSearch.addEventListener("input", () => {
  state.query = playerSearch.value.trim().toLowerCase();
  render();
});
clearSearch.addEventListener("click", () => {
  playerSearch.value = "";
  state.query = "";
  render();
});
showAllBtn.addEventListener("click", () => {
  state.selectedId = null;
  render();
});
clearPlayersBtn.addEventListener("click", clearPlayers);

captureList.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-table]");
  if (removeButton) {
    removeFromTable(removeButton.dataset.removeTable);
    return;
  }

  const item = event.target.closest("[data-table-player]");
  if (!item) return;
  const result = getLatestPlayerResultByName(item.dataset.tablePlayer);
  if (!result) return;
  state.selectedId = result.capture.id;
  playerSearch.value = "";
  state.query = "";
  render();
});

players.addEventListener("click", (event) => {
  const addTableButton = event.target.closest("[data-add-table]");
  if (addTableButton) {
    addToTable(addTableButton.dataset.addTable);
    return;
  }

  const removeTableButton = event.target.closest("[data-remove-table-player]");
  if (removeTableButton) {
    removeFromTable(removeTableButton.dataset.removeTablePlayer);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-player]");
  if (deleteButton) {
    deletePlayer(deleteButton.dataset.deletePlayer);
    return;
  }

  const button = event.target.closest("[data-view-id]");
  if (!button) return;
  state.selectedId = button.dataset.viewId;
  playerSearch.value = "";
  state.query = "";
  render();
});

await Promise.all([loadAccessInfo(), loadBaseline(), loadCaptures()]);
connectEvents();

async function loadCaptures() {
  const response = await fetch("/api/captures");
  const data = await response.json();
  state.captures = data.captures || [];
  reconcileTablePlayers();
  autoSeatNewSnapshots({ seedOnly: !state.hasLoadedCaptures && !state.seenTableSnaps.length });
  state.hasLoadedCaptures = true;
  render();
}

async function loadBaseline() {
  const response = await fetch("/api/baseline");
  const data = await response.json();
  state.baseline = data.baseline || null;
  renderBaseline();
}

async function loadAccessInfo() {
  try {
    const response = await fetch("/api/access");
    const data = await response.json();
    state.access = data;
    phoneCaptureUrl.textContent = data.captureUrl ? `Local name: ${data.captureUrl}` : "Local name unavailable";
    phoneCaptureUrl.href = data.captureUrl || "/capture";
    phoneLanUrl.textContent = data.lanCaptureUrl ? `Current Wi-Fi: ${data.lanCaptureUrl}` : "Current Wi-Fi address unavailable";
    phoneLanUrl.href = data.lanCaptureUrl || data.captureUrl || "/capture";
  } catch (error) {
    console.error(error);
    phoneCaptureUrl.textContent = `${window.location.origin}/capture`;
    phoneCaptureUrl.href = "/capture";
    phoneLanUrl.textContent = "";
    phoneLanUrl.href = "/capture";
  }
}

async function copyPhoneUrl() {
  const url = state.access?.lanCaptureUrl || state.access?.captureUrl || `${window.location.origin}/capture`;
  try {
    await navigator.clipboard.writeText(url);
    copyPhoneUrlBtn.textContent = "Copied";
    window.setTimeout(() => {
      copyPhoneUrlBtn.textContent = "Copy";
    }, 1400);
  } catch (error) {
    console.error(error);
    window.prompt("Copy this phone capture URL:", url);
  }
}

function addToTable(playerName) {
  const name = cleanPlayerName(playerName);
  if (!name || isOnTable(name)) return;
  if (state.tablePlayers.length >= tableSeatLimit) {
    window.alert("The table is full. Remove a player before adding another.");
    return;
  }
  state.tablePlayers = [...state.tablePlayers, name];
  state.dismissedTablePlayers = state.dismissedTablePlayers.filter((key) => key !== playerKey(name));
  saveTablePlayers();
  saveStoredKeys(tableDismissedStorageKey, state.dismissedTablePlayers);
  render();
}

function removeFromTable(playerName) {
  const key = playerKey(playerName);
  state.tablePlayers = state.tablePlayers.filter((name) => playerKey(name) !== key);
  if (key && !state.dismissedTablePlayers.includes(key)) {
    state.dismissedTablePlayers = [...state.dismissedTablePlayers, key];
    saveStoredKeys(tableDismissedStorageKey, state.dismissedTablePlayers);
  }
  saveTablePlayers();
  render();
}

function clearTable() {
  if (!state.tablePlayers.length) return;
  const confirmed = window.confirm("Remove every player from the table?");
  if (!confirmed) return;
  const dismissed = new Set(state.dismissedTablePlayers);
  for (const { player } of getAllPlayerResults()) dismissed.add(playerKey(player?.name));
  state.dismissedTablePlayers = [...dismissed].filter(Boolean);
  state.tablePlayers = [];
  saveTablePlayers();
  saveStoredKeys(tableDismissedStorageKey, state.dismissedTablePlayers);
  render();
}

function loadTablePlayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(tableStorageKey) || "[]");
    if (!Array.isArray(saved)) return [];
    return uniquePlayerNames(saved.map(cleanPlayerName).filter(Boolean)).slice(0, tableSeatLimit);
  } catch {
    return [];
  }
}

function saveTablePlayers() {
  localStorage.setItem(tableStorageKey, JSON.stringify(state.tablePlayers.slice(0, tableSeatLimit)));
}

function loadStoredKeys(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(saved)) return [];
    return [...new Set(saved.map(playerKey).filter(Boolean))];
  } catch {
    return [];
  }
}

function saveStoredKeys(key, values) {
  localStorage.setItem(key, JSON.stringify([...new Set(values.map(playerKey).filter(Boolean))]));
}

async function updateBaseline() {
  updateBaselineBtn.disabled = true;
  updateBaselineBtn.textContent = "Updating...";
  try {
    const response = await fetch("/api/baseline", { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    state.baseline = data.baseline || null;
    renderBaseline();
    render();
  } catch (error) {
    console.error(error);
    window.alert("Could not update the baseline. Check the server and try again.");
  } finally {
    updateBaselineBtn.disabled = false;
    updateBaselineBtn.textContent = "Update baseline";
  }
}

async function clearPlayers() {
  const confirmed = window.confirm(
    "Clear all players and snapshot history from the dashboard? Saved screenshot image files will remain on disk."
  );
  if (!confirmed) return;

  clearPlayersBtn.disabled = true;
  clearPlayersBtn.textContent = "Clearing...";
  try {
    const response = await fetch("/api/captures", { method: "DELETE" });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    state.captures = data.captures || [];
    state.selectedId = null;
    state.tablePlayers = [];
    state.dismissedTablePlayers = [];
    state.seenTableSnaps = [];
    state.hasLoadedCaptures = false;
    saveTablePlayers();
    saveStoredKeys(tableDismissedStorageKey, state.dismissedTablePlayers);
    saveStoredKeys(tableSeenStorageKey, state.seenTableSnaps);
    playerSearch.value = "";
    state.query = "";
    render();
  } catch (error) {
    console.error(error);
    window.alert("Could not clear players. Check the server and try again.");
  } finally {
    clearPlayersBtn.disabled = false;
    clearPlayersBtn.textContent = "Clear players";
  }
}

async function deletePlayer(playerName) {
  if (!playerName) return;
  const confirmed = window.confirm(
    `Delete ${playerName} from the tracked player database and remove their snapshots from this dashboard? Raw image files stay on disk.`
  );
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/players/${encodeURIComponent(playerName)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    state.captures = data.captures || [];
    state.selectedId = null;
    removeFromTable(playerName);
    render();
  } catch (error) {
    console.error(error);
    window.alert(`Could not delete ${playerName}. Check the server and try again.`);
  }
}

function connectEvents() {
  const events = new EventSource("/api/events");
  events.addEventListener("open", () => {
    connection.textContent = "Live";
    connection.classList.add("is-live");
  });
  events.addEventListener("captures", (event) => {
    const data = JSON.parse(event.data);
    state.captures = data.captures || [];
    if (!state.captures.some((capture) => capture.id === state.selectedId) && state.captures[0]) {
      state.selectedId = null;
    }
    reconcileTablePlayers();
    autoSeatNewSnapshots();
    render();
  });
  events.addEventListener("error", () => {
    connection.textContent = "Reconnecting";
    connection.classList.remove("is-live");
  });
}

function render() {
  captureCount.textContent = state.captures.length;
  playerCount.textContent = state.captures.reduce((sum, capture) => sum + (capture.players?.length || 0), 0);
  renderBaseline();
  renderTablePanel();

  if (!state.captures.length) {
    emptyState.hidden = false;
    analysisView.hidden = true;
    return;
  }

  emptyState.hidden = true;
  analysisView.hidden = false;
  const active = getSelectedCapture();
  renderBoardSummary(active);
  renderPlayers();
}

function renderBaseline() {
  const baseline = state.baseline;
  if (!baseline) {
    baselineUpdated.textContent = "Not set";
    baselineStats.innerHTML = `<span class="baseline-chip">No baseline yet</span>`;
    return;
  }

  baselineUpdated.textContent = `${baseline.playerCount || 0} players · ${formatDateTime(baseline.updatedAt)}`;
  const stats = baseline.stats || {};
  const preferredKeys = ["vpip", "pfr", "3b", "fold3b", "cbet", "foldcbet", "steal", "checkraise", "wtsd", "wsd"];
  const entries = preferredKeys
    .map((key) => [key, baselineStatByKey(baseline, key)])
    .filter(([, stat]) => stat && Number.isFinite(stat.avg));
  const usedStats = new Set(entries.map(([, stat]) => stat));
  const fallbackEntries = Object.entries(stats)
    .filter(([key, stat]) => !preferredKeys.includes(key) && !usedStats.has(stat) && stat && Number.isFinite(stat.avg))
    .slice(0, Math.max(0, 10 - entries.length));
  const visible = [...entries, ...fallbackEntries].slice(0, 10);

  if (!visible.length) {
    baselineStats.innerHTML = `<span class="baseline-chip">Update after a few accepted players</span>`;
    return;
  }

  baselineStats.innerHTML = visible
    .map(([, stat]) => `
      <span class="baseline-chip">
        <small>${escapeHtml(stat.label)}</small>
        <strong>${formatStatAverage(stat.avg, "")}</strong>
      </span>
    `)
    .join("");
}

function renderTablePanel() {
  reconcileTablePlayers();
  tableSeatCount.textContent = `${state.tablePlayers.length}/${tableSeatLimit}`;
  clearTableBtn.disabled = !state.tablePlayers.length;

  if (!state.tablePlayers.length) {
    captureList.innerHTML = `
      <div class="table-empty">
        <strong>No table players yet.</strong>
        <span>Add players from the profile cards. Max ${tableSeatLimit} seats.</span>
      </div>
    `;
    return;
  }

  captureList.innerHTML = state.tablePlayers
    .map((name) => {
      const result = getLatestPlayerResultByName(name);
      const capture = result?.capture || null;
      const player = result?.player || null;
      const selected = capture?.id === state.selectedId ? "is-selected" : "";
      const style = player ? classifyStyle(normalizeStats(player.stats), state.baseline).label : "Missing";
      return `
        <div class="table-seat ${selected}">
          <button class="table-seat-main" data-table-player="${escapeHtml(name)}">
            ${capture ? `<img src="${capture.imageUrl}" alt="" />` : `<span class="seat-placeholder">?</span>`}
            <span>
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(style)}${capture ? ` · ${formatTime(capture.createdAt)}` : ""}</small>
            </span>
          </button>
          <button class="seat-remove" data-remove-table="${escapeHtml(name)}" aria-label="Remove ${escapeHtml(name)} from table" title="Remove from table">×</button>
        </div>
      `;
    })
    .join("");
}

function renderPlayers(playerList, status) {
  const active = getSelectedCapture();

  if (state.query) {
    renderPlayerSearchResults();
    return;
  }

  playersTitle.textContent = active ? "Snapshot Player Profiles" : "All Player Profiles";

  if (active?.status === "error" || active?.status === "discarded") {
    const className = active.status === "discarded" ? "discard-row" : "error-row";
    players.innerHTML = `
      <div class="${className}">
        ${escapeHtml(active?.error || active?.tableSummary || "Analysis failed.")}
      </div>
    `;
    return;
  }

  if (active?.status === "processing") {
    players.innerHTML = `<div class="loading-row">Analyzing visible stats...</div>`;
    return;
  }

  const results = active ? playersFromCapture(active) : getAllPlayerResults();

  if (!active && !results.length && state.captures.some((capture) => capture.status === "processing")) {
    players.innerHTML = `<div class="loading-row">Analyzing visible stats...</div>`;
    return;
  }

  if (!active && !results.length && state.captures.some((capture) => capture.status === "error" || capture.status === "discarded")) {
    players.innerHTML = `<p class="muted">No accepted player profiles yet. Check discarded or error snapshots in the thumbnail list.</p>`;
    return;
  }

  if (!results.length) {
    players.innerHTML = `<p class="muted">No player stats were extracted from this screenshot.</p>`;
    return;
  }

  players.innerHTML = results
    .map(({ capture, player }) => playerCard(player, active ? null : capture))
    .join("");
}

function renderPlayerSearchResults() {
  const results = getPlayerSearchResults();
  playersTitle.textContent = `Player Search: ${results.length} match${results.length === 1 ? "" : "es"}`;

  if (!results.length) {
    players.innerHTML = `<p class="muted">No analyzed player names match this search yet.</p>`;
    return;
  }

  players.innerHTML = results
    .map(({ capture, player }) => playerCard(player, capture))
    .join("");
}

function getPlayerSearchResults() {
  const query = state.query;
  if (!query) return [];
  return state.captures.flatMap((capture) => {
    if (capture.status !== "ready") return [];
    return (capture.players || [])
      .filter((player) => playerMatchesQuery(player, capture, query))
      .map((player) => ({ capture, player }));
  });
}

function getAllPlayerResults() {
  return state.captures.flatMap((capture) => playersFromCapture(capture));
}

function getLatestPlayerResultByName(playerName) {
  const key = playerKey(playerName);
  if (!key) return null;
  return getAllPlayerResults().find(({ player }) => playerKey(player?.name) === key) || null;
}

function reconcileTablePlayers() {
  const known = new Set(getAllPlayerResults().map(({ player }) => playerKey(player?.name)).filter(Boolean));
  const next = uniquePlayerNames(state.tablePlayers).filter((name) => known.has(playerKey(name))).slice(0, tableSeatLimit);
  if (next.length !== state.tablePlayers.length || next.some((name, index) => name !== state.tablePlayers[index])) {
    state.tablePlayers = next;
    saveTablePlayers();
  }
}

function autoSeatNewSnapshots({ seedOnly = false } = {}) {
  const seen = new Set(state.seenTableSnaps);
  const newEntries = [];

  for (const result of getAllPlayerResults()) {
    const key = capturePlayerKey(result.capture, result.player);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    newEntries.push(result);
  }

  if (!newEntries.length) return;

  state.seenTableSnaps = [...seen].slice(-300);
  saveStoredKeys(tableSeenStorageKey, state.seenTableSnaps);

  if (seedOnly) return;

  for (const { player } of [...newEntries].reverse()) {
    seatSnapshotPlayer(cleanPlayerName(player?.name));
  }
}

function seatSnapshotPlayer(playerName) {
  const name = cleanPlayerName(playerName);
  const key = playerKey(name);
  if (!key) return;

  state.tablePlayers = state.tablePlayers.filter((current) => playerKey(current) !== key);
  state.dismissedTablePlayers = state.dismissedTablePlayers.filter((dismissed) => dismissed !== key);

  while (state.tablePlayers.length >= tableSeatLimit) {
    state.tablePlayers.shift();
  }

  state.tablePlayers = [...state.tablePlayers, name];
  saveTablePlayers();
  saveStoredKeys(tableDismissedStorageKey, state.dismissedTablePlayers);
}

function isOnTable(playerName) {
  const key = playerKey(playerName);
  return Boolean(key && state.tablePlayers.some((name) => playerKey(name) === key));
}

function uniquePlayerNames(names) {
  const seen = new Set();
  const result = [];
  for (const name of names) {
    const clean = cleanPlayerName(name);
    const key = playerKey(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function cleanPlayerName(value) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, 80);
}

function playerKey(value) {
  return cleanPlayerName(value).toLowerCase();
}

function capturePlayerKey(capture, player) {
  const captureId = String(capture?.id || "").trim();
  const key = playerKey(player?.name);
  return captureId && key ? `${captureId}:${key}` : "";
}

function playersFromCapture(capture) {
  if (capture.status !== "ready") return [];
  return (capture.players || []).map((player) => ({ capture, player }));
}

function getSelectedCapture() {
  if (!state.selectedId) return null;
  return state.captures.find((capture) => capture.id === state.selectedId) || null;
}

function renderBoardSummary(active) {
  const readyCount = state.captures.filter((capture) => capture.status === "ready").length;
  const baselineCount = state.baseline?.playerCount || 0;

  if (!active) {
    scopeLabel.textContent = "All snapshots";
    activeTitle.textContent = "Player Board";
    activeStatus.textContent = "Live";
    activeStatus.dataset.status = "ready";
    tableSummary.textContent = `Showing ${playerCount.textContent} player profile${playerCount.textContent === "1" ? "" : "s"} from ${readyCount} accepted snapshot${readyCount === 1 ? "" : "s"}. Labels compare against your saved ${baselineCount}-player CoinPoker baseline until you update it.`;
    showAllBtn.hidden = true;
    return;
  }

  scopeLabel.textContent = "Selected snapshot";
  activeTitle.textContent = active.playerName || active.note || "Snapshot";
  activeStatus.textContent = active.status;
  activeStatus.dataset.status = active.status;
  tableSummary.textContent = active.tableSummary || "";
  showAllBtn.hidden = false;
}

function playerCard(player, capture) {
  const stats = normalizeStats(player.stats);
  const baseline = state.baseline;
  const style = classifyStyle(stats, baseline);
  const badges = playerBadges(stats, baseline);
  const quickRead = normalizeQuickRead(player, stats, state.baseline);
  const notes = Array.isArray(player.studyNotes) ? player.studyNotes : [];
  const playerName = cleanPlayerName(player.name || "");
  const onTable = isOnTable(playerName);
  const tableFull = state.tablePlayers.length >= tableSeatLimit;
  const tableButton = !playerName
    ? `<button class="mini-action table-mini" disabled>Add to table</button>`
    : onTable
    ? `<button class="mini-action table-mini is-on-table" data-remove-table-player="${escapeHtml(playerName)}">Remove from table</button>`
    : `<button class="mini-action table-mini" data-add-table="${escapeHtml(playerName)}" ${tableFull ? "disabled" : ""}>Add to table</button>`;
  return `
    <article class="player-card">
      <div class="player-card-header">
        <div>
          <h3>
            <span>${escapeHtml(player.name || "Unknown player")}</span>
            ${badges.map((badge) => `<span class="player-badge ${badge.className}">${escapeHtml(badge.label)}</span>`).join("")}
          </h3>
          <p>${escapeHtml(style.label)}</p>
        </div>
        <div class="card-actions">
          ${tableButton}
          <button class="mini-action danger-mini" data-delete-player="${escapeHtml(player.name || "")}">Delete</button>
          ${capture ? `<button class="mini-action" data-view-id="${capture.id}">View</button>` : ""}
        </div>
      </div>
      <p class="style-reason">${escapeHtml(style.reason)}</p>
      ${capture ? `<p class="snapshot-meta">Snapshot ${formatTime(capture.createdAt)}</p>` : ""}
      <div class="quick-read">
        ${quickCell("When to bluff", quickRead.whenToBluff, "is-primary")}
        ${quickCell("Value bets", `${quickRead.honestyRating}/10`)}
        ${quickCell("When he bluffs", quickRead.whenHeBluffs)}
        ${quickCell("Pressure plan", quickRead.pressurePlan)}
        ${quickCell("Caution", quickRead.caution)}
      </div>
      <div class="stat-strip">
        ${stats.map((stat) => statCell(stat.label, stat.value, baseline)).join("")}
      </div>
      <h4>Full Analysis</h4>
      <p class="player-summary">${escapeHtml(player.summary || "")}</p>
      <ul class="notes-list">
        ${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
      </ul>
    </article>
  `;
}

function quickCell(label, value, className = "") {
  return `
    <span class="${className}">
      <small>${label}</small>
      <strong>${escapeHtml(value || "-")}</strong>
    </span>
  `;
}

function captureMatchesQuery(capture) {
  const query = state.query;
  if (!query) return true;
  if (String(capture.playerName || "").toLowerCase().includes(query)) return true;
  return (capture.players || []).some((player) => playerMatchesQuery(player, capture, query));
}

function playerMatchesQuery(player, capture, query) {
  return [player?.name, capture?.playerName, capture?.note]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function getFirstPlayerName(capture) {
  return (capture.players || []).find((player) => player?.name)?.name || "";
}

function normalizeStats(stats) {
  if (Array.isArray(stats)) return stats.filter((stat) => stat?.label || stat?.value);
  if (!stats || typeof stats !== "object") return [];
  const labels = {
    vpip: "VPIP",
    pfr: "PFR",
    threeBet: "3B",
    foldToThreeBet: "Fold 3B",
    cbet: "CBet",
    foldToCbet: "Fold CBet",
    steal: "Steal",
    checkRaise: "Check/Raise",
    wtsd: "WTSD",
    wsd: "W$SD",
    wonShowdown: "W$SD",
    aggression: "Agg",
    hands: "Hands"
  };
  return Object.entries(stats)
    .map(([key, value]) => ({
      label: labels[key] || key,
      value
    }))
    .filter((stat) => stat.value);
}

function normalizeQuickRead(player, stats, baseline) {
  const quickRead = player.quickRead || {};
  const statMap = statLookup(stats);
  const vpip = statNumber(statMap, "vpip");
  const pfr = statNumber(statMap, "pfr");
  const threeBet = statNumber(statMap, "3");
  const foldToThreeBet = statNumber(statMap, "fold", "3");
  const foldToCbet = statNumber(statMap, "fold", "c");
  const cbet = statNumber(statMap, "cbet");
  const steal = statNumber(statMap, "steal");
  const wtsd = statNumber(statMap, "wtsd");
  const wsd = statNumber(statMap, "wsd");
  const avgPFR = metricAvg(baseline, "pfr", 18);
  const avgThreeBet = metricAvg(baseline, "threeBet", 7);
  const avgCbet = metricAvg(baseline, "cbet", 55);
  const avgSteal = metricAvg(baseline, "steal", 30);
  const avgWTSD = metricAvg(baseline, "wtsd", 35);
  const avgWSD = metricAvg(baseline, "wsd", 52);
  const valueBetRating = valueBetFrequencyRating({
    pfr,
    threeBet,
    cbet,
    steal,
    wtsd,
    wsd,
    avgPFR,
    avgThreeBet,
    avgCbet,
    avgSteal,
    avgWTSD,
    avgWSD
  });

  return {
    whenToBluff: bluffAgainstText({ foldToCbet, foldToThreeBet, wtsd, wsd, avgWTSD, avgWSD }),
    honestyRating: valueBetRating,
    whenHeBluffs: hisBluffText({ cbet, steal, threeBet, wtsd, wsd, avgWTSD, avgWSD }),
    pressurePlan: pressurePlanText({ vpip, foldToCbet, foldToThreeBet, cbet, wtsd, wsd, avgWTSD, avgWSD }),
    caution: cautionText({ cbet, threeBet, foldToCbet, foldToThreeBet, wtsd, wsd, avgWTSD, avgWSD })
  };
}

function classifyStyle(stats, baseline) {
  const statMap = statLookup(stats);
  const vpip = statNumber(statMap, "vpip");
  const pfr = statNumber(statMap, "pfr");
  const threeBet = statNumber(statMap, "3");
  const foldToThreeBet = statNumber(statMap, "fold", "3");
  const foldToCbet = statNumber(statMap, "fold", "c");
  const cbet = statNumber(statMap, "cbet");
  const steal = statNumber(statMap, "steal");
  const wtsd = statNumber(statMap, "wtsd");
  const wsd = statNumber(statMap, "wsd");
  const gap = Number.isFinite(vpip) && Number.isFinite(pfr) ? vpip - pfr : null;
  const baselineLabel = baseline?.playerCount >= 3 ? `against your ${baseline.playerCount}-player saved CoinPoker baseline` : "using absolute fallback until the baseline has more players";

  if (!baseline || baseline.playerCount < 3) {
    return classifyAbsoluteStyle({ vpip, pfr, threeBet, foldToThreeBet, foldToCbet, cbet, steal, wtsd, wsd, gap });
  }

  const avgVPIP = metricAvg(baseline, "vpip", 28);
  const avgPFR = metricAvg(baseline, "pfr", 18);
  const avgThreeBet = metricAvg(baseline, "threeBet", 7);
  const avgFoldThreeBet = metricAvg(baseline, "foldToThreeBet", 45);
  const avgFoldCbet = metricAvg(baseline, "foldToCbet", 42);
  const avgCbet = metricAvg(baseline, "cbet", 55);
  const avgSteal = metricAvg(baseline, "steal", 30);
  const avgWTSD = metricAvg(baseline, "wtsd", 35);
  const avgWSD = metricAvg(baseline, "wsd", 52);
  const avgGap = metricAvg(baseline, "gap", 10);
  const aggressionRatio = averageRatios([
    ratio(pfr, avgPFR),
    ratio(threeBet, avgThreeBet),
    ratio(cbet, avgCbet),
    ratio(steal, avgSteal)
  ]);

  if (Number.isFinite(vpip) && Number.isFinite(pfr) && vpip <= avgVPIP * 0.7 && pfr <= avgPFR * 0.75) {
    return {
      label: "Nit",
      reason: `VPIP and PFR are far below baseline: ${vpip}%/${pfr}% versus ${Math.round(avgVPIP)}%/${Math.round(avgPFR)}%.`
    };
  }
  if (Number.isFinite(vpip) && vpip <= avgVPIP * 0.9 && aggressionRatio <= 0.9 && (foldToThreeBet >= avgFoldThreeBet * 1.1 || foldToCbet >= avgFoldCbet * 1.1)) {
    return {
      label: "Weak Tight",
      reason: `Below-baseline aggression and above-baseline folding under pressure.`
    };
  }
  if (Number.isFinite(vpip) && vpip >= avgVPIP * 1.25 && aggressionRatio >= 1.25) {
    return {
      label: "Maniac",
      reason: `Looseness and pressure are both much higher than baseline.`
    };
  }
  if (Number.isFinite(vpip) && vpip >= avgVPIP * 1.1 && (aggressionRatio <= 0.9 || (Number.isFinite(gap) && gap >= avgGap * 1.2))) {
    return {
      label: "Loose Passive",
      reason: `VPIP is above baseline, but raising pressure lags or the VPIP/PFR gap is wide.`
    };
  }
  if (Number.isFinite(wtsd) && Number.isFinite(wsd) && wtsd >= avgWTSD * 1.08 && wsd <= avgWSD * 0.92) {
    return {
      label: "Calling Station",
      reason: `${wtsd}% WTSD and ${wsd}% W$SD show more light showdown calls than baseline.`
    };
  }
  if (Number.isFinite(vpip) && vpip >= avgVPIP && ((Number.isFinite(foldToCbet) && foldToCbet <= avgFoldCbet * 0.85) || (Number.isFinite(foldToThreeBet) && foldToThreeBet <= avgFoldThreeBet * 0.85) || (Number.isFinite(wtsd) && wtsd >= avgWTSD * 1.08))) {
    return {
      label: "Calling Station",
      reason: `Looser than baseline and stickier versus pressure${Number.isFinite(wtsd) ? `, with ${wtsd}% WTSD` : ""}.`
    };
  }
  if (Number.isFinite(wtsd) && Number.isFinite(wsd) && wtsd >= avgWTSD * 1.05 && wsd <= avgWSD * 0.95) {
    return {
      label: "Loose Passive",
      reason: `High WTSD with below-baseline W$SD suggests too many weak showdown calls.`
    };
  }
  if (Number.isFinite(vpip) && vpip >= avgVPIP * 1.08 && aggressionRatio >= 1.08) {
    return {
      label: "LAG",
      reason: `VPIP and pressure stats are above the saved baseline.`
    };
  }
  if (Number.isFinite(vpip) && Number.isFinite(gap) && vpip >= avgVPIP * 0.88 && vpip <= avgVPIP * 1.08 && aggressionRatio >= 0.95 && aggressionRatio <= 1.15 && gap <= avgGap * 1.1) {
    return {
      label: "TAG",
      reason: `Near-baseline VPIP with solid raising pressure and a controlled VPIP/PFR gap.`
    };
  }
  if (aggressionRatio >= 1.15) {
    return {
      label: "Aggressive Regular",
      reason: `Pressure stats are meaningfully higher ${baselineLabel}.`
    };
  }
  return {
    label: "Balanced Regular",
    reason: `Near the saved CoinPoker baseline without an extreme loose, tight, or sticky pattern.`
  };
}

function playerBadges(stats, baseline) {
  const row = statRow(stats);
  const callerTopQuartile = baseline?.metrics?.callerScore?.p75;
  if (!baseline || baseline.playerCount < 4 || !Number.isFinite(row.callerScore) || !Number.isFinite(callerTopQuartile)) return [];
  if (row.callerScore < callerTopQuartile) return [];
  return [
    {
      label: "Fish",
      className: "is-fish"
    }
  ];
}

function metricAvg(baseline, key, fallback) {
  const value = baseline?.metrics?.[key]?.avg;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function valueBetFrequencyRating({
  pfr,
  threeBet,
  cbet,
  steal,
  wtsd,
  wsd,
  avgPFR,
  avgThreeBet,
  avgCbet,
  avgSteal,
  avgWTSD,
  avgWSD
}) {
  const pressureRatio = averageRatios([
    ratio(pfr, avgPFR),
    ratio(threeBet, avgThreeBet),
    ratio(cbet, avgCbet),
    ratio(steal, avgSteal)
  ]);
  let score = 5;
  if (Number.isFinite(pressureRatio)) score += (pressureRatio - 1) * 2.2;
  if (Number.isFinite(wsd) && Number.isFinite(avgWSD)) score += ((wsd - avgWSD) / 10) * 2.2;
  if (Number.isFinite(wtsd) && Number.isFinite(avgWTSD)) score += ((wtsd - avgWTSD) / 12) * 0.8;
  if (Number.isFinite(wtsd) && Number.isFinite(wsd) && wtsd >= avgWTSD * 1.08 && wsd <= avgWSD * 0.92) score -= 1.4;
  if (Number.isFinite(wtsd) && Number.isFinite(wsd) && wtsd <= avgWTSD * 0.9 && wsd >= avgWSD * 1.05) score += 1.1;
  return clampRating(score);
}

function ratio(value, average) {
  if (!Number.isFinite(value) || !Number.isFinite(average) || average <= 0) return null;
  return value / average;
}

function averageRatios(values) {
  const numbers = values.filter(Number.isFinite);
  if (!numbers.length) return 1;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function classifyAbsoluteStyle({ vpip, pfr, threeBet, foldToThreeBet, foldToCbet, cbet, steal, wtsd, wsd, gap }) {
  if (vpip <= 16 && pfr <= 10) return { label: "Nit", reason: `Very tight preflop: ${vpip}% VPIP and ${pfr}% PFR.` };
  if (vpip <= 22 && pfr <= 14 && threeBet <= 6 && (foldToThreeBet >= 45 || foldToCbet >= 40)) return { label: "Weak Tight", reason: "Tight range, low pressure, and folds enough when attacked." };
  if (vpip >= 45 && pfr >= 25 && threeBet >= 12) return { label: "Maniac", reason: `Very loose and forceful: ${vpip}% VPIP, ${pfr}% PFR, ${threeBet}% 3B.` };
  if (wtsd >= 40 && wsd <= 47) return { label: "Calling Station", reason: `High ${wtsd}% WTSD with ${wsd}% W$SD suggests light showdown calls.` };
  if (wtsd <= 28 && wsd >= 55) return { label: "Weak Tight", reason: `Low ${wtsd}% WTSD and high ${wsd}% W$SD show selective, honest showdowns.` };
  if (vpip >= 38 && gap >= 18 && pfr < 24) return { label: "Loose Passive", reason: "Large VPIP/PFR gap suggests calling too many hands." };
  if (vpip >= 35 && gap >= 15 && foldToCbet <= 35) return { label: "Calling Station", reason: "Loose preflop and sticky postflop with low Fold to C-Bet." };
  if (vpip >= 28 && pfr >= 20 && (threeBet >= 8 || steal >= 38)) return { label: "LAG", reason: "Loose-aggressive profile with active raises and steals." };
  if (vpip >= 19 && vpip <= 28 && pfr >= 14 && pfr <= 23 && threeBet <= 10) return { label: "TAG", reason: `Tight-aggressive range: ${vpip}% VPIP and ${pfr}% PFR.` };
  if (cbet >= 65 || steal >= 40 || threeBet >= 9) return { label: "Aggressive Regular", reason: "Aggression shows in C-Bet, Steal, or 3-Bet frequency." };
  return { label: "Balanced Regular", reason: "No extreme loose, passive, or hyper-aggressive stat pattern." };
}

function statRow(stats) {
  const statMap = statLookup(stats);
  const vpip = statNumber(statMap, "vpip");
  const pfr = statNumber(statMap, "pfr");
  const gap = Number.isFinite(vpip) && Number.isFinite(pfr) ? vpip - pfr : null;
  const foldToThreeBet = statNumber(statMap, "fold", "3");
  const foldToCbet = statNumber(statMap, "fold", "c");
  const wtsd = statNumber(statMap, "wtsd");
  const wsd = statNumber(statMap, "wsd");
  return {
    vpip,
    pfr,
    threeBet: statNumber(statMap, "3"),
    foldToThreeBet,
    foldToCbet,
    cbet: statNumber(statMap, "cbet"),
    steal: statNumber(statMap, "steal"),
    wtsd,
    wsd,
    gap,
    callerScore: callerScore({ vpip, gap, foldToCbet, foldToThreeBet, wtsd, wsd })
  };
}

function callerScore({ vpip, gap, foldToCbet, foldToThreeBet, wtsd, wsd }) {
  if (!Number.isFinite(vpip) || !Number.isFinite(gap)) return null;
  const stickiness = averageNumbers([
    Number.isFinite(foldToCbet) ? 100 - foldToCbet : null,
    Number.isFinite(foldToThreeBet) ? 100 - foldToThreeBet : null,
    Number.isFinite(wtsd) ? wtsd : null,
    Number.isFinite(wsd) ? 100 - wsd : null
  ]);
  return vpip * 0.45 + gap * 1.25 + stickiness * 0.3;
}

function bluffAgainstText({ foldToCbet, foldToThreeBet, wtsd, wsd, avgWTSD, avgWSD }) {
  if (wtsd >= avgWTSD * 1.08 && wsd <= avgWSD * 0.92) {
    return `Value bet more than bluff; ${wtsd}% WTSD and ${wsd}% W$SD call light.`;
  }
  if (foldToCbet >= 45) {
    return `Bluff c-bet/turn barrels; ${foldToCbet}% Fold to C-Bet gives fold equity.`;
  }
  if (foldToThreeBet >= 50) {
    return `3-bet bluff late opens; ${foldToThreeBet}% Fold to 3-Bet can fold.`;
  }
  if (foldToCbet <= 34 && foldToThreeBet <= 35) {
    return `Avoid pure bluffs; ${foldToCbet}% Fold C-Bet and ${foldToThreeBet}% Fold 3-Bet continue.`;
  }
  if (foldToCbet <= 34) {
    return `Do not bluff flop c-bets much; ${foldToCbet}% Fold to C-Bet continues.`;
  }
  if (foldToThreeBet <= 35) {
    return `Do not 3-bet bluff often; ${foldToThreeBet}% Fold to 3-Bet defends.`;
  }
  return "Use selective semi-bluffs; fold-to stats are middle range.";
}

function hisBluffText({ cbet, steal, threeBet, wtsd, wsd, avgWTSD, avgWSD }) {
  if (wtsd <= avgWTSD * 0.85 && wsd >= avgWSD * 1.05) {
    return `Showdowns are strong; ${wtsd}% WTSD and ${wsd}% W$SD mean fewer river bluffs.`;
  }
  if (steal >= 45) {
    return `Expect light cutoff/button steals; ${steal}% Steal is wide.`;
  }
  if (cbet >= 65) {
    return `Flop c-bets include air; ${cbet}% C-Bet is very frequent.`;
  }
  if (threeBet >= 10) {
    return `Some 3-bets are pressure; ${threeBet}% 3-Bet is aggressive.`;
  }
  return "Bluffs are less obvious; aggression stats are not extreme.";
}

function pressurePlanText({ vpip, foldToCbet, foldToThreeBet, cbet, wtsd, wsd, avgWTSD, avgWSD }) {
  if (wtsd >= avgWTSD * 1.08 && wsd <= avgWSD * 0.92) {
    return `Thin value rivers; showdown stats show too many weak calls.`;
  }
  if (foldToCbet >= 45) {
    return `Continuation-bet more flops, then barrel turns versus weak calls.`;
  }
  if (foldToThreeBet >= 50) {
    return `Attack late opens with blocker 3-bets; expect preflop folds.`;
  }
  if (vpip >= 35 && foldToCbet <= 34) {
    return `Value bet thinner; loose range and low Fold C-Bet continue.`;
  }
  if (cbet >= 65 && foldToCbet <= 34) {
    return `Float flop wider, then stab turns when his c-bet stops.`;
  }
  return "Pressure selectively in position; avoid autopilot multi-street bluffs.";
}

function cautionText({ cbet, threeBet, foldToCbet, foldToThreeBet, wtsd, wsd, avgWTSD, avgWSD }) {
  if (wtsd <= avgWTSD * 0.85 && wsd >= avgWSD * 1.05) {
    return `Respect river aggression; low WTSD and high W$SD show strength.`;
  }
  if (foldToCbet <= 30) {
    return `Low ${foldToCbet}% Fold to C-Bet means bluff c-bets get called.`;
  }
  if (foldToThreeBet <= 30) {
    return `Low ${foldToThreeBet}% Fold to 3-Bet means bluff 3-bets get called.`;
  }
  if (cbet >= 65) {
    return `Do not overfold flops; ${cbet}% C-Bet includes weak hands.`;
  }
  if (threeBet >= 10) {
    return `Do not assume every 3-bet is premium at ${threeBet}%.`;
  }
  return "Give big turn and river raises extra credit.";
}

function statLookup(stats) {
  return stats.map((stat) => ({
    label: String(stat.label || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
    value: stat.value
  }));
}

function statNumber(stats, ...needles) {
  const normalizedNeedles = needles.map((needle) => String(needle).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const stat = stats.find((candidate) => normalizedNeedles.every((needle) => candidate.label.includes(needle)));
  if (!stat) return null;
  const match = String(stat.value || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function averageNumbers(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return 40;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function clampRating(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 5;
  return Math.max(1, Math.min(10, Math.round(number)));
}

function statCell(label, value, baseline) {
  const comparison = statComparison(label, value, baseline);
  return `
    <span class="stat-cell ${comparison.className}" title="${escapeHtml(comparison.title)}">
      <small>${label}</small>
      <strong>${escapeHtml(value || "-")}</strong>
      <em>${escapeHtml(comparison.avgText)}</em>
    </span>
  `;
}

function statComparison(label, value, baseline) {
  const number = numericValue(value);
  const average = baselineStatByKey(baseline, statKey(label));
  if (!Number.isFinite(number) || !average || average.count < 2) {
    return {
      className: "is-normal",
      avgText: "Avg -",
      title: "Not enough saved baseline data for this stat yet."
    };
  }

  const direction = aggressionDirection(label);
  const diff = number - average.avg;
  const threshold = normalThreshold(average.avg);
  let className = "is-normal";
  if (direction > 0 && diff > threshold) className = "is-more-aggressive";
  if (direction > 0 && diff < -threshold) className = "is-less-aggressive";
  if (direction < 0 && diff > threshold) className = "is-less-aggressive";
  if (direction < 0 && diff < -threshold) className = "is-more-aggressive";

  return {
    className,
    avgText: `Avg ${formatStatAverage(average.avg, value)}`,
    title: `${label}: ${value}; saved baseline average ${formatStatAverage(average.avg, value)}.`
  };
}

function aggressionDirection(label) {
  const key = statKey(label);
  if (/fold|f23|ft3|ftcb|foldtocbet|foldto3bet/.test(key)) return -1;
  if (/hands|sample|wsd|wonsd|showdownwin/.test(key)) return 0;
  if (/vpip|pfr|3b|3bet|cbet|bet|raise|checkraise|xr|steal|agg|af|wtsd/.test(key)) return 1;
  return 0;
}

function normalThreshold(avg) {
  if (!Number.isFinite(avg)) return 4;
  return Math.max(3, Math.min(8, Math.abs(avg) * 0.12));
}

function statKey(label) {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function baselineStatByKey(baseline, key) {
  const stats = baseline?.stats || {};
  const aliases = statAliases(key);
  return aliases.map((alias) => stats[alias]).find((stat) => stat && Number.isFinite(stat.avg)) || null;
}

function statAliases(key) {
  const normalized = statKey(key);
  const aliases = new Set([normalized, normalized.replace("to", "")]);
  if (normalized === "3bet") aliases.add("3b");
  if (normalized === "3b") aliases.add("3bet");
  if (normalized.includes("fold") && normalized.includes("3")) {
    ["fold3b", "foldto3b", "fold3bet", "foldto3bet", "f3b", "ft3b"].forEach((alias) => aliases.add(alias));
  }
  if (normalized.includes("fold") && normalized.includes("cbet")) {
    ["foldcbet", "foldtocbet", "foldcb", "foldtocb", "fcb", "ftcb"].forEach((alias) => aliases.add(alias));
  }
  if (normalized.includes("cbet") && !normalized.includes("fold")) {
    ["cbet", "cb", "continuationbet"].forEach((alias) => aliases.add(alias));
  }
  if (normalized.includes("check") && normalized.includes("raise")) {
    ["checkraise", "xr", "xraise"].forEach((alias) => aliases.add(alias));
  }
  if (normalized === "wtsd" || normalized.includes("wenttoshowdown")) {
    ["wtsd", "wenttoshowdown"].forEach((alias) => aliases.add(alias));
  }
  if (normalized === "wsd" || normalized.includes("wonsd") || normalized.includes("wonshowdown") || normalized.includes("showdownwin")) {
    ["wsd", "wonsd", "wonshowdown", "showdownwin", "showdownwinrate"].forEach((alias) => aliases.add(alias));
  }
  return [...aliases];
}

function numericValue(value) {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function formatStatAverage(avg, originalValue) {
  if (!Number.isFinite(avg)) return "-";
  const suffix = String(originalValue || "").includes("%") ? "%" : "";
  return `${Math.round(avg)}${suffix}`;
}

function formatTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
