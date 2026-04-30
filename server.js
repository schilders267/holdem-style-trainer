import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname, networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(rootDir, "public");
const dataDir = join(rootDir, "data");
const captureDir = join(rootDir, "data", "captures");
const capturesFile = join(dataDir, "captures.json");
const dbFile = join(dataDir, "holdem.sqlite");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const aiModel = process.env.AI_MODEL || "gpt-4.1";
const imageDetail = process.env.AI_IMAGE_DETAIL || "high";
const execFileAsync = promisify(execFile);
const requiredReadableStats = 10;

const subscribers = new Set();

await mkdir(captureDir, { recursive: true });
await initDatabase();
await migrateJsonCaptures();
const captures = await loadCaptures();
let baseline = await loadBaseline();
if (!baseline) baseline = await updateBaselineSnapshot();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      redirect(res, "/dashboard");
      return;
    }

    if (req.method === "GET" && url.pathname === "/capture") {
      await sendFile(res, join(publicDir, "capture.html"));
      return;
    }

    if (req.method === "GET" && url.pathname === "/dashboard") {
      await sendFile(res, join(publicDir, "dashboard.html"));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/captures") {
      sendJson(res, { captures });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/access") {
      sendJson(res, getAccessInfo());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/baseline") {
      sendJson(res, { baseline });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/baseline") {
      baseline = await updateBaselineSnapshot();
      sendJson(res, { baseline });
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/captures") {
      await clearCaptures(req, res);
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/players/")) {
      await deletePlayer(url.pathname, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      openEventStream(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/captures") {
      await createCapture(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/captures/")) {
      await sendCaptureFile(res, url.pathname);
      return;
    }

    if (req.method === "GET") {
      await sendStatic(res, url.pathname);
      return;
    }

    sendJson(res, { error: "Method not allowed" }, 405);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: "Server error" }, 500);
  }
});

server.on("error", (error) => {
  console.error(`Unable to start server on ${host}:${port}`);
  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Hold'em Style Trainer running at http://localhost:${port}`);
  console.log(`Phone capture page: http://localhost:${port}/capture`);
  console.log(`Desktop dashboard:  http://localhost:${port}/dashboard`);
});

async function createCapture(req, res) {
  const body = await readJson(req);
  if (!body?.image || typeof body.image !== "string") {
    sendJson(res, { error: "Missing image data URL" }, 400);
    return;
  }

  const parsed = parseDataUrl(body.image);
  if (!parsed || !parsed.mimeType.startsWith("image/")) {
    sendJson(res, { error: "Expected a base64 image data URL" }, 400);
    return;
  }

  const id = randomUUID();
  const extension = extensionForMime(parsed.mimeType);
  const fileName = `${id}${extension}`;
  const imagePath = join(captureDir, fileName);
  await writeFile(imagePath, parsed.buffer);

  const capture = {
    id,
    imageUrl: `/captures/${fileName}`,
    createdAt: new Date().toISOString(),
    status: "processing",
    playerName: "Reading player...",
    note: cleanText(body.note || ""),
    players: [],
    tableSummary: "Reading screenshot...",
    source: cleanText(body.source || "phone")
  };

  captures.unshift(capture);
  trimCaptures();
  await saveCaptures();
  publish();
  sendJson(res, { capture }, 202);

  analyzeAndPublish(capture, body.image, parsed.mimeType).catch((error) => {
    console.error(error);
    const userMessage = userFacingAiError(error);
    capture.status = "error";
    capture.tableSummary = userMessage;
    capture.error = userMessage;
    saveCaptures().catch(console.error);
    publish();
  });
}

async function clearCaptures(req, res) {
  captures.length = 0;
  await saveCaptures();
  publish();
  sendJson(res, { captures, cleared: true });
}

async function deletePlayer(pathname, res) {
  const playerName = cleanText(decodeURIComponent(pathname.replace("/api/players/", "")));
  if (!playerName) {
    sendJson(res, { error: "Missing player name" }, 400);
    return;
  }
  for (let index = captures.length - 1; index >= 0; index -= 1) {
    const capture = captures[index];
    capture.players = normalizePlayers(capture.players || []).filter((player) => player.name !== playerName);
    if (capture.playerName === playerName || capture.players.length === 0) {
      captures.splice(index, 1);
    }
  }
  await saveCaptures();
  publish();
  sendJson(res, { captures, deleted: playerName });
}

async function analyzeAndPublish(capture, imageDataUrl, mimeType) {
  const result = await analyzePokerScreenshot(imageDataUrl, mimeType);
  const discardReason = getDiscardReason(result);
  if (discardReason) {
    capture.status = "discarded";
    capture.playerName = getPrimaryPlayerName(result) || "Discarded";
    capture.players = [];
    capture.tableSummary = discardReason;
    capture.confidence = result.confidence || "low";
    capture.model = result.model || "demo";
    capture.practiceOnly = true;
    await saveCaptures();
    publish();
    return;
  }

  capture.status = "ready";
  capture.players = normalizePlayers(result.players);
  capture.playerName = getPrimaryPlayerName(result);
  capture.tableSummary = result.tableSummary || "No table summary returned.";
  capture.confidence = result.confidence || "unknown";
  capture.model = result.model || "demo";
  capture.practiceOnly = true;
  await saveCaptures();
  publish();
}

async function analyzePokerScreenshot(imageDataUrl) {
  if (!process.env.OPENAI_API_KEY || process.env.AI_DISABLED === "1") {
    await delay(800);
    return demoAnalysis();
  }
  const coinPokerContext = buildCoinPokerPoolContext(baseline);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: aiModel,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You analyze Texas Hold'em practice screenshots. You are also the image quality gate. Only accept screenshots when player names and the relevant HUD/stat numbers are legible enough to read confidently. This tool is only for study/practice review, not real-money or prohibited live-game assistance."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: coinPokerContext
            },
            {
              type: "input_text",
              text:
                "Return JSON only with this shape: {\"accepted\":true,\"primaryPlayerName\":\"exact readable player name\",\"discardReason\":\"\",\"tableSummary\":\"one sentence\",\"confidence\":\"medium|high\",\"players\":[{\"name\":\"exact readable player name\",\"style\":\"short label\",\"quickRead\":{\"whenToBluff\":\"specific actionable spot, 8-14 words\",\"honestyRating\":1,\"whenHeBluffs\":\"specific likely bluff pattern, 8-14 words\",\"pressurePlan\":\"specific exploit plan with position/street/action, 8-14 words\",\"caution\":\"specific danger note, 8-14 words\"},\"stats\":[{\"label\":\"HUD stat label exactly as shown or standard abbreviation\",\"value\":\"exact readable value\"}],\"summary\":\"1-2 sentences that uses all readable stats including WTSD and W$SD\",\"studyNotes\":[\"short practice note\"]}]}. Extract the full CoinPoker HUD stat table for every player you return, not just VPIP/PFR/3B and not just the first 8 stats. The required 10-stat profile for every accepted player is VPIP, PFR, 3B or 3-BET, Fold to 3B, C-Bet, Fold to C-Bet, Steal, Check/Raise, WTSD, and W$SD or WSD. Include WTSD and W$SD/WSD in every player's stats array, quickRead reasoning, style choice, and written summary. Compare WTSD and W$SD/WSD against the saved CoinPoker baseline: high WTSD plus low W$SD means sticky/light showdown calling; low WTSD plus high W$SD means selective value-heavy showdowns; high WTSD plus high W$SD means value-heavy calls and bets; low WTSD plus low W$SD means avoids showdown but may be pushed off hands. Use the labels visible in the screenshot where possible. Use style labels from this range when supported by stats: Nit, Weak Tight, Loose Passive, Calling Station, TAG, LAG, Maniac, Aggressive Regular, Balanced Regular. Do not call everyone aggressive; tight low-VPIP low-PFR players who fold under pressure should be Weak Tight or Nit. For quickRead, honestyRating is a 1-10 VALUE-BET FREQUENCY rating relative to the saved CoinPoker baseline: 10 means this player is expected to bet for value much more often than the pool, 5 means around pool average, and 1 means bets are much less value-heavy or more bluff/thin/air-heavy than the pool. Base honestyRating mainly on W$SD/WSD, WTSD, C-Bet, PFR, 3-Bet, Steal, and Check/Raise relative to the baseline; do not use it as a generic truthfulness/deception score. IMPORTANT: whenToBluff means when HERO should bluff AGAINST this player, so base it on this player's Fold to C-Bet, Fold to 3-Bet, WTSD, and W$SD/WSD stats, not on this player's own C-Bet frequency. whenHeBluffs means when this player is likely bluffing, so base it on this player's C-Bet, Steal, 3-Bet, Check/Raise, WTSD, and W$SD/WSD stats. Avoid vague phrases like '3-bet pressure' or 'postflop spots'; include the street/position/action and why the stat supports it. If any returned player has fewer than 10 confidently readable stat cells, or if WTSD or W$SD/WSD is visible but uncertain for any returned player, discard. If the photo is blurry, cropped, glare-covered, too far away, not a poker stats/HUD screenshot, if the player name is uncertain, or if any visible stat number needed for the 10-stat profile is uncertain, return {\"accepted\":false,\"primaryPlayerName\":\"\",\"discardReason\":\"short reason\",\"tableSummary\":\"Discarded: short reason\",\"confidence\":\"low\",\"players\":[]}. Do not guess or invent names, labels, or numbers. When unsure, discard."
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: imageDetail
            }
          ]
        }
      ],
      temperature: 0.2,
      max_output_tokens: 1800
    })
  });

  if (!response.ok) {
    const message = await response.text();
    const error = new Error(`AI request failed: ${response.status} ${message}`);
    error.status = response.status;
    error.apiError = parseAiErrorBody(message);
    throw error;
  }

  const data = await response.json();
  const text = extractResponseText(data);
  const parsed = parseJsonObject(text);
  return {
    ...parsed,
    model: aiModel
  };
}

function demoAnalysis() {
  return {
    model: "demo-no-api-key",
    accepted: true,
    primaryPlayerName: "Seat 1",
    confidence: "medium",
    tableSummary:
      "Demo mode: replace this with live AI by setting OPENAI_API_KEY; sample profiles show how the dashboard will fill in.",
    players: [
      {
        name: "Seat 1",
        style: "Tight aggressive",
        quickRead: {
          whenToBluff: "missed turns after checks",
          honestyRating: 7,
          whenHeBluffs: "late-position pressure",
          pressurePlan: "attack blind folds",
          caution: "respect big reraises"
        },
        stats: [
          { label: "VPIP", value: "18" },
          { label: "PFR", value: "15" },
          { label: "3B", value: "6" },
          { label: "Fold 3B", value: "58" },
          { label: "CBet", value: "62" },
          { label: "Fold CBet", value: "44" },
          { label: "Steal", value: "31" },
          { label: "Check/Raise", value: "6" },
          { label: "WTSD", value: "28" },
          { label: "W$SD", value: "52" }
        ],
        summary:
          "Likely selecting strong starting hands and applying pressure preflop. Postflop aggression suggests they continue with strong ranges.",
        studyNotes: ["Practice defending blinds with disciplined ranges."]
      },
      {
        name: "Seat 4",
        style: "Loose passive",
        quickRead: {
          whenToBluff: "dry flops after calls",
          honestyRating: 8,
          whenHeBluffs: "rare river stabs",
          pressurePlan: "thin value relentlessly",
          caution: "sudden raises are strong"
        },
        stats: [
          { label: "VPIP", value: "42" },
          { label: "PFR", value: "8" },
          { label: "3B", value: "2" },
          { label: "Fold 3B", value: "35" },
          { label: "CBet", value: "28" },
          { label: "Fold CBet", value: "61" },
          { label: "Steal", value: "12" },
          { label: "Check/Raise", value: "2" },
          { label: "WTSD", value: "39" },
          { label: "W$SD", value: "43" }
        ],
        summary:
          "Entering many pots but rarely raising. This profile tends to call too often and reveal strength through sudden aggression.",
        studyNotes: ["Practice thin value-betting and avoiding big bluffs."]
      }
    ]
  };
}

function getDiscardReason(result) {
  if (!result || typeof result !== "object") {
    return "Discarded: AI returned an unreadable response.";
  }
  if (result.accepted === false || result.discarded === true) {
    return result.discardReason || result.tableSummary || "Discarded: screenshot was not clear enough.";
  }
  if (String(result.confidence || "").toLowerCase() === "low") {
    return result.discardReason || "Discarded: AI confidence was too low to trust the stat numbers.";
  }

  const players = normalizePlayers(result.players);
  if (!players.length) {
    return "Discarded: no readable player stats were found.";
  }

  if (!getPrimaryPlayerName(result)) {
    return "Discarded: no readable player name was found.";
  }

  const hasReadableNumericStats = players.every((player) => {
    const stats = normalizeStats(player.stats);
    return hasCompletePlayerProfile(stats);
  });

  if (!hasReadableNumericStats) {
    return "Discarded: every accepted player must have 10 readable numeric HUD stats, including WTSD and W$SD/WSD.";
  }

  return "";
}

function normalizePlayers(players) {
  if (!Array.isArray(players)) return [];
  return players.map((player) => ({
    ...player,
    stats: normalizeStats(player.stats)
  }));
}

function getPrimaryPlayerName(result) {
  const players = normalizePlayers(result?.players);
  return cleanText(result?.primaryPlayerName || players.find((player) => cleanText(player?.name))?.name || "");
}

function hasNumber(value) {
  return /\d/.test(String(value || ""));
}

function hasShowdownStats(stats) {
  const keys = normalizeStats(stats).map((stat) => statKey(stat.label));
  const hasWtsd = keys.some((key) => key.includes("wtsd") || key.includes("wenttoshowdown"));
  const hasWsd = keys.some((key) => key === "wsd" || key.includes("w$sd") || key.includes("wonsd") || key.includes("wonshowdown") || key.includes("showdownwin"));
  return hasWtsd && hasWsd;
}

function hasCompletePlayerProfile(stats) {
  return normalizeStats(stats).filter((stat) => hasNumber(stat.value)).length >= requiredReadableStats && hasShowdownStats(stats);
}

function normalizeStats(stats) {
  if (Array.isArray(stats)) {
    return stats
      .map((stat) => ({
        label: cleanText(stat?.label || stat?.name || ""),
        value: cleanText(stat?.value || "")
      }))
      .filter((stat) => stat.label || stat.value);
  }
  if (stats && typeof stats === "object") {
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
        value: cleanText(value || "")
      }))
      .filter((stat) => stat.value);
  }
  return [];
}

function buildCoinPokerPoolContext(currentBaseline) {
  if (!currentBaseline || currentBaseline.playerCount < 3) {
    return "CoinPoker saved baseline context: fewer than 3 baseline player profiles. Use cautious fallback labels until the baseline is updated with more CoinPoker players.";
  }

  const stats = currentBaseline.stats || {};
  return `CoinPoker saved baseline context: compare this player against this saved CoinPoker baseline, not against modern pro/solver baselines. Baseline updated: ${currentBaseline.updatedAt}. Baseline player count: ${currentBaseline.playerCount}. Baseline averages: VPIP ${baselineAverage(stats, "vpip")}%, PFR ${baselineAverage(stats, "pfr")}%, 3B ${baselineAverage(stats, "3b")}%, Fold to 3B ${baselineAverage(stats, "fold3b")}%, C-Bet ${baselineAverage(stats, "cbet")}%, Fold to C-Bet ${baselineAverage(stats, "foldcbet")}%, Steal ${baselineAverage(stats, "steal")}%, Check/Raise ${baselineAverage(stats, "checkraise")}%, WTSD ${baselineAverage(stats, "wtsd")}%, W$SD ${baselineAverage(stats, "wsd")}%. A player should be called tight/aggressive/passive only relative to this saved CoinPoker baseline. The baseline is intentionally fixed until the user updates it.`;
}

function statNumber(stats, ...needles) {
  const normalizedNeedles = needles.map((needle) => String(needle).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const stat = stats.find((candidate) => normalizedNeedles.every((needle) => candidate.label.includes(needle)));
  if (!stat) return null;
  const match = String(stat.value || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function average(values) {
  const result = averageRaw(values);
  return Number.isFinite(result) ? Math.round(result) : "-";
}

function averageRaw(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function baselineAverage(stats, key) {
  const stat = statAliases(key).map((alias) => stats?.[alias]).find((candidate) => candidate && Number.isFinite(candidate.avg)) || null;
  return Number.isFinite(stat?.avg) ? Math.round(stat.avg) : "-";
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

function extractResponseText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const output of data.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("AI response did not contain JSON.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function parseAiErrorBody(text) {
  try {
    return JSON.parse(text)?.error || null;
  } catch {
    return null;
  }
}

function userFacingAiError(error) {
  const apiError = error.apiError;
  if (apiError?.code === "insufficient_quota") {
    return "OpenAI connected, but this API project has insufficient quota. Add billing or credits, then resend the screenshot.";
  }
  if (error.status === 401) {
    return "OpenAI rejected the API key. Create a new key, export it as OPENAI_API_KEY, and restart the server.";
  }
  if (error.status === 429) {
    return "OpenAI rate-limited the request. Wait a moment, then resend the screenshot.";
  }
  if (error.status >= 500) {
    return "OpenAI had a temporary server error. Try resending the screenshot.";
  }
  return "AI analysis failed. Check the server logs for the exact API response.";
}

function openEventStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  res.write(`event: captures\ndata: ${JSON.stringify({ captures })}\n\n`);
  subscribers.add(res);
  req.on("close", () => subscribers.delete(res));
}

function publish() {
  const payload = `event: captures\ndata: ${JSON.stringify({ captures })}\n\n`;
  for (const subscriber of subscribers) subscriber.write(payload);
}

function getAccessInfo() {
  const hostName = `${hostname().replace(/\.local$/i, "")}.local`;
  const lanAddress = getLanAddress();
  return {
    hostName,
    lanAddress,
    captureUrl: `http://${hostName}:${port}/capture`,
    dashboardUrl: `http://${hostName}:${port}/dashboard`,
    lanCaptureUrl: lanAddress ? `http://${lanAddress}:${port}/capture` : "",
    lanDashboardUrl: lanAddress ? `http://${lanAddress}:${port}/dashboard` : ""
  };
}

function getLanAddress() {
  const interfaces = networkInterfaces();
  const preferred = ["en0", "en1"];
  for (const name of preferred) {
    const address = findUsableAddress(interfaces[name]);
    if (address) return address;
  }
  for (const addresses of Object.values(interfaces)) {
    const address = findUsableAddress(addresses);
    if (address) return address;
  }
  return "";
}

function findUsableAddress(addresses = []) {
  const match = addresses.find((address) => address.family === "IPv4" && !address.internal);
  return match?.address || "";
}

function trimCaptures() {
  if (captures.length > 60) captures.length = 60;
}

async function loadCaptures() {
  try {
    const rows = await querySql(`
      SELECT id, image_url, created_at, status, player_name, note, players_json, table_summary,
             source, confidence, model, practice_only, error
      FROM captures
      ORDER BY datetime(created_at) DESC
      LIMIT 60;
    `);
    return rows.map(captureFromDbRow).filter(Boolean);
  } catch (error) {
    console.error(error);
    return [];
  }
}

async function loadBaseline() {
  try {
    const rows = await querySql(`
      SELECT id, updated_at, player_count, stats_json, metrics_json
      FROM baselines
      WHERE id = 'coinpoker'
      LIMIT 1;
    `);
    return baselineFromRow(rows[0]);
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function updateBaselineSnapshot() {
  const nextBaseline = computeBaseline(captures);
  await runSql(`
    INSERT INTO baselines (id, updated_at, player_count, stats_json, metrics_json)
    VALUES (
      'coinpoker',
      ${sql(nextBaseline.updatedAt)},
      ${nextBaseline.playerCount},
      ${sql(JSON.stringify(nextBaseline.stats))},
      ${sql(JSON.stringify(nextBaseline.metrics))}
    )
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at,
      player_count = excluded.player_count,
      stats_json = excluded.stats_json,
      metrics_json = excluded.metrics_json;
  `);
  return nextBaseline;
}

function baselineFromRow(row) {
  if (!row) return null;
  return {
    updatedAt: row.updated_at,
    playerCount: Number(row.player_count || 0),
    stats: parseJson(row.stats_json, {}),
    metrics: parseJson(row.metrics_json, {})
  };
}

function computeBaseline(captureList) {
  const latestByPlayer = new Map();
  for (const capture of captureList) {
    if (capture.status !== "ready") continue;
    for (const player of normalizePlayers(capture.players || [])) {
      const name = cleanText(player.name || "");
      if (!name) continue;
      const key = name.toLowerCase();
      if (!latestByPlayer.has(key)) latestByPlayer.set(key, player);
    }
  }

  const groups = new Map();
  const rows = [];
  for (const player of latestByPlayer.values()) {
    const stats = normalizeStats(player.stats);
    const row = statRow(stats);
    if (Number.isFinite(row.vpip) && Number.isFinite(row.pfr)) rows.push(row);

    for (const stat of stats) {
      const key = statKey(stat.label);
      const value = numericValue(stat.value);
      if (!key || !Number.isFinite(value)) continue;
      if (!groups.has(key)) {
        groups.set(key, {
          label: stat.label,
          values: []
        });
      }
      groups.get(key).values.push(value);
    }
  }

  const stats = Object.fromEntries(
    [...groups.entries()].map(([key, group]) => [
      key,
      {
        label: group.label,
        avg: averageRaw(group.values),
        count: group.values.length
      }
    ])
  );

  const metricValues = (key) => rows.map((row) => row[key]).filter(Number.isFinite);
  const metrics = {
    vpip: metricSummary(metricValues("vpip")),
    pfr: metricSummary(metricValues("pfr")),
    threeBet: metricSummary(metricValues("threeBet")),
    foldToThreeBet: metricSummary(metricValues("foldToThreeBet")),
    foldToCbet: metricSummary(metricValues("foldToCbet")),
    cbet: metricSummary(metricValues("cbet")),
    steal: metricSummary(metricValues("steal")),
    wtsd: metricSummary(metricValues("wtsd")),
    wsd: metricSummary(metricValues("wsd")),
    gap: metricSummary(metricValues("gap")),
    callerScore: metricSummary(metricValues("callerScore"))
  };

  return {
    updatedAt: new Date().toISOString(),
    playerCount: latestByPlayer.size,
    stats,
    metrics
  };
}

function metricSummary(values) {
  const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    avg: averageRaw(numbers),
    count: numbers.length,
    p25: quantile(numbers, 0.25),
    p50: quantile(numbers, 0.5),
    p75: quantile(numbers, 0.75)
  };
}

function quantile(sortedValues, q) {
  const values = sortedValues.filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  const position = (values.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  if (values[base + 1] === undefined) return values[base];
  return values[base] + rest * (values[base + 1] - values[base]);
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
  const stickiness = averageRaw([
    Number.isFinite(foldToCbet) ? 100 - foldToCbet : null,
    Number.isFinite(foldToThreeBet) ? 100 - foldToThreeBet : null,
    Number.isFinite(wtsd) ? wtsd : null,
    Number.isFinite(wsd) ? 100 - wsd : null
  ]);
  return vpip * 0.45 + gap * 1.25 + (Number.isFinite(stickiness) ? stickiness : 40) * 0.3;
}

function statLookup(stats) {
  return stats.map((stat) => ({
    label: statKey(stat.label),
    value: stat.value
  }));
}

function statKey(label) {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function numericValue(value) {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function captureFromDbRow(row) {
  const players = parseJson(row.players_json, []);
  return normalizeSavedCapture({
    id: row.id,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    status: row.status,
    playerName: row.player_name,
    note: row.note || "",
    players,
    tableSummary: row.table_summary || "",
    source: row.source || "phone",
    confidence: row.confidence || "",
    model: row.model || "",
    practiceOnly: Boolean(row.practice_only),
    error: row.error || ""
  });
}

function normalizeSavedCapture(capture) {
  if (!capture || typeof capture !== "object" || !capture.id || !capture.imageUrl) return null;
  const normalized = {
    ...capture,
    players: Array.isArray(capture.players) ? capture.players : []
  };
  if (normalized.status === "processing") {
    normalized.status = "error";
    normalized.tableSummary = "Analysis was interrupted by a server restart. Resend the screenshot.";
    normalized.error = normalized.tableSummary;
  }
  return normalized;
}

async function saveCaptures() {
  const statements = [
    "BEGIN;",
    "DELETE FROM captures;",
    "DELETE FROM players;"
  ];
  for (const capture of captures) {
    statements.push(insertCaptureSql(capture));
    if (capture.status === "ready") {
      for (const player of normalizePlayers(capture.players || [])) {
        statements.push(upsertPlayerSql(capture, player));
      }
    }
  }
  statements.push("COMMIT;");
  await runSql(statements.join("\n"));
}

async function initDatabase() {
  await mkdir(dataDir, { recursive: true });
  await runSql(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      image_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      player_name TEXT,
      note TEXT,
      players_json TEXT NOT NULL DEFAULT '[]',
      table_summary TEXT,
      source TEXT,
      confidence TEXT,
      model TEXT,
      practice_only INTEGER DEFAULT 1,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS players (
      name TEXT PRIMARY KEY,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      capture_count INTEGER NOT NULL DEFAULT 0,
      latest_capture_id TEXT,
      latest_stats_json TEXT NOT NULL DEFAULT '[]',
      latest_quick_read_json TEXT NOT NULL DEFAULT '{}',
      latest_style TEXT,
      latest_summary TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS baselines (
      id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      player_count INTEGER NOT NULL DEFAULT 0,
      stats_json TEXT NOT NULL DEFAULT '{}',
      metrics_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_captures_player ON captures(player_name);
    CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at);
  `);
}

async function migrateJsonCaptures() {
  const rows = await querySql("SELECT COUNT(*) AS count FROM captures;");
  if (Number(rows[0]?.count || 0) > 0) return;
  let saved = [];
  try {
    saved = JSON.parse(await readFile(capturesFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") console.error(error);
    return;
  }
  if (!Array.isArray(saved) || !saved.length) return;
  const migrated = saved.map(normalizeSavedCapture).filter(Boolean).slice(0, 60);
  const statements = ["BEGIN;"];
  for (const capture of migrated) {
    statements.push(insertCaptureSql(capture));
    if (capture.status === "ready") {
      for (const player of normalizePlayers(capture.players || [])) {
        statements.push(upsertPlayerSql(capture, player));
      }
    }
  }
  statements.push("COMMIT;");
  await runSql(statements.join("\n"));
}

function insertCaptureSql(capture) {
  return `
    INSERT OR REPLACE INTO captures (
      id, image_url, created_at, status, player_name, note, players_json, table_summary,
      source, confidence, model, practice_only, error
    ) VALUES (
      ${sql(capture.id)}, ${sql(capture.imageUrl)}, ${sql(capture.createdAt)}, ${sql(capture.status)},
      ${sql(capture.playerName || "")}, ${sql(capture.note || "")}, ${sql(JSON.stringify(normalizePlayers(capture.players || [])))},
      ${sql(capture.tableSummary || "")}, ${sql(capture.source || "phone")}, ${sql(capture.confidence || "")},
      ${sql(capture.model || "")}, ${capture.practiceOnly === false ? 0 : 1}, ${sql(capture.error || "")}
    );
  `;
}

function upsertPlayerSql(capture, player) {
  const now = new Date().toISOString();
  return `
    INSERT INTO players (
      name, first_seen, last_seen, capture_count, latest_capture_id, latest_stats_json,
      latest_quick_read_json, latest_style, latest_summary, updated_at
    ) VALUES (
      ${sql(player.name)}, ${sql(capture.createdAt)}, ${sql(capture.createdAt)}, 1, ${sql(capture.id)},
      ${sql(JSON.stringify(normalizeStats(player.stats)))}, ${sql(JSON.stringify(player.quickRead || {}))},
      ${sql(player.style || "")}, ${sql(player.summary || "")}, ${sql(now)}
    )
    ON CONFLICT(name) DO UPDATE SET
      first_seen = MIN(first_seen, excluded.first_seen),
      last_seen = MAX(last_seen, excluded.last_seen),
      capture_count = capture_count + 1,
      latest_capture_id = excluded.latest_capture_id,
      latest_stats_json = excluded.latest_stats_json,
      latest_quick_read_json = excluded.latest_quick_read_json,
      latest_style = excluded.latest_style,
      latest_summary = excluded.latest_summary,
      updated_at = excluded.updated_at;
  `;
}

async function runSql(statement) {
  await execFileAsync("sqlite3", ["-cmd", ".timeout 5000", dbFile, statement], {
    maxBuffer: 10 * 1024 * 1024
  });
}

async function querySql(statement) {
  const { stdout } = await execFileAsync("sqlite3", ["-cmd", ".timeout 5000", "-json", dbFile, statement], {
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function sendStatic(res, pathname) {
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath === "/" ? "dashboard.html" : safePath);
  if (!filePath.startsWith(publicDir)) {
    sendJson(res, { error: "Not found" }, 404);
    return;
  }
  await sendFile(res, filePath);
}

async function sendCaptureFile(res, pathname) {
  const fileName = decodeURIComponent(pathname.replace("/captures/", ""));
  if (!/^[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(fileName)) {
    sendJson(res, { error: "Not found" }, 404);
    return;
  }
  await sendFile(res, join(captureDir, fileName));
}

async function sendFile(res, filePath) {
  const { readFile } = await import("node:fs/promises");
  try {
    const data = await readFile(filePath);
    const contentType = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": isBrowserAsset(contentType) ? "no-store" : "public, max-age=3600"
    });
    res.end(data);
  } catch {
    sendJson(res, { error: "Not found" }, 404);
  }
}

function isBrowserAsset(contentType) {
  return /text\/html|text\/css|text\/javascript|application\/json/.test(contentType);
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseDataUrl(value) {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function extensionForMime(mimeType) {
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  return ".jpg";
}

function cleanText(value) {
  return String(value).slice(0, 300).replace(/[<>]/g, "").trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
