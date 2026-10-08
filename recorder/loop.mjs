// Recorder loop for .github/workflows/record.yml.
//
// Why a loop: the live page used to read a snapshot this recorder wrote every
// 15 minutes on a cron schedule, but GitHub's scheduler drops and delays cron
// runs, and from Oct. 1, 2026 it started only about five of the 96 a day, so
// the "live" map was often hours old while every run showed green. And the
// ADS-B feeds refuse requests from Cloudflare, so the page's relay can't fetch
// them itself. So ONE long-lived job does both jobs:
//
//   - every LIVE_MS it fetches adsb.fi and POSTs the helicopters to the live
//     relay (worker/), authenticating with this job's GitHub OIDC token;
//   - every ARCHIVE_MIN minutes it appends a compact snapshot to
//     data/log/YYYY-MM-DD.jsonl on the `data` branch (never main, so it never
//     triggers a Pages rebuild);
//   - shortly before the job's time limit it starts its own successor through
//     workflow_dispatch, which is not subject to cron delays. The cron in the
//     workflow is only a backstop that restarts the chain if it breaks.
//
// Usage (inside the workflow):  node recorder/loop.mjs          # loop
//                               node recorder/loop.mjs --once   # one fetch, post and archive line
// Env: GH_TOKEN, REPO, GITHUB_RUN_ID, ACTIONS_ID_TOKEN_REQUEST_URL/_TOKEN;
// optional RUN_BUDGET_MIN (default 330).
import { fetchHelis, archiveLine, dayET } from "./adsb.mjs";

const RELAY = "https://rotor-motion-adsb.josh-greenman.workers.dev/ingest";
const AUDIENCE = "rotor-motion-adsb";   // must match AUDIENCE in worker/src/index.js
const WORKFLOW = "record.yml";
const LIVE_MS = 10_000;
const ARCHIVE_MIN = 15;
const MAX_FEED_FAILURE_MIN = 60;        // give up (and fail the run) after this long without data

const REPO = process.env.REPO;
const TOKEN = process.env.GH_TOKEN;
const RUN_ID = process.env.GITHUB_RUN_ID || "0";
const BUDGET_MS = Number(process.env.RUN_BUDGET_MIN || 330) * 60_000;
const START = Date.now();
const once = process.argv.includes("--once");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })} ET] ${m}`);

// ---- GitHub REST ------------------------------------------------------------
async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json",
      ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : {};
}

// Append one line to the day's log on the `data` branch, server-side.
async function archive(snap) {
  const path = `data/log/${dayET(snap.t)}.jsonl`;
  const line = archiveLine(snap) + "\n";
  for (let attempt = 1; attempt <= 4; attempt++) {
    let sha, prev = "";
    try {
      const f = await gh("GET", `/contents/${path}?ref=data`);
      sha = f.sha;
      prev = Buffer.from(f.content, "base64").toString("utf8");
    } catch (e) {
      if (e.status !== 404) throw e;   // a new day: the file doesn't exist yet
    }
    try {
      await gh("PUT", `/contents/${path}`, {
        message: `log helicopters ${new Date(snap.t * 1000).toISOString().replace(/\.\d+Z$/, "Z")}`,
        content: Buffer.from(prev + line).toString("base64"),
        branch: "data", ...(sha ? { sha } : {}),
        committer: { name: "rotor-recorder", email: "actions@users.noreply.github.com" },
      });
      return;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      log(`archive write raced (attempt ${attempt}); retrying`);
      await sleep(3000 * attempt);
    }
  }
  throw new Error("could not append to the archive after 4 attempts");
}

// ---- Live relay -------------------------------------------------------------
let oidc = null, oidcExp = 0;
async function oidcToken() {
  if (oidc && Date.now() / 1000 < oidcExp - 60) return oidc;
  const u = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  u.searchParams.set("audience", AUDIENCE);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  if (!res.ok) throw new Error(`OIDC token request: HTTP ${res.status}`);
  oidc = (await res.json()).value;
  oidcExp = JSON.parse(Buffer.from(oidc.split(".")[1], "base64url").toString()).exp;
  return oidc;
}

async function postLive(snap) {
  const body = JSON.stringify({ t: snap.t, source: "adsb.fi", ac: snap.ac });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(RELAY, { method: "POST", body,
      headers: { Authorization: `Bearer ${await oidcToken()}`, "Content-Type": "application/json" } });
    if (res.ok) return;
    if (res.status === 401 && attempt === 1) { oidc = null; continue; }   // token aged out; get a fresh one
    throw new Error(`relay HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function dispatchSuccessor() {
  await gh("POST", `/actions/workflows/${WORKFLOW}/dispatches`, { ref: "main", inputs: { predecessor: String(RUN_ID) } });
  log("successor dispatched");
}

// ---- Main -------------------------------------------------------------------
if (once) {
  const snap = await fetchHelis();
  await postLive(snap);
  await archive(snap);
  log(`${snap.ac.length} helicopters posted and archived`);
  process.exit(0);
}

let lastGood = Date.now(), lastArchiveSlot = null;
let relayFailures = 0, exitCode = 0;
try {
  while (Date.now() - START < BUDGET_MS) {
    const tick = Date.now();
    let snap = null;
    try {
      snap = await fetchHelis();
      lastGood = Date.now();
    } catch (e) {
      console.log(`::warning::${e.message}`);
      if (Date.now() - lastGood > MAX_FEED_FAILURE_MIN * 60_000) {
        console.log(`::error::no data from adsb.fi for ${MAX_FEED_FAILURE_MIN} minutes`);
        exitCode = 1;
        break;
      }
    }
    if (snap) {
      try { await postLive(snap); relayFailures = 0; }
      catch (e) { relayFailures++; console.log(`::warning::live post failed: ${e.message}`); }
      // Archive once per quarter hour, from the first good fetch in that slot.
      const slot = Math.floor(snap.t / (ARCHIVE_MIN * 60));
      if (slot !== lastArchiveSlot) {
        try { await archive(snap); lastArchiveSlot = slot; log(`archived ${snap.ac.length} helicopters`); }
        catch (e) { console.log(`::warning::archive failed: ${e.message}`); }
      }
    }
    if (relayFailures === 30) console.log("::error::30 live posts in a row failed; the relay may be down");
    await sleep(Math.max(0, LIVE_MS - (Date.now() - tick)));
  }
} finally {
  try { await dispatchSuccessor(); }
  catch (e) { console.log(`::error::could not dispatch a successor: ${e.message}`); exitCode = 1; }
}
process.exit(exitCode || (relayFailures >= 30 ? 1 : 0));
