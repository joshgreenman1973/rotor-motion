// Snapshot NYC helicopters from airplanes.live and append to a per-day log.
// Run on a schedule by GitHub Actions; builds our own history since no free
// ADS-B archive exists. Compact records so the repo stays small.
import fs from "node:fs";

const API = "https://api.airplanes.live/v2/point/40.7/-74.0/45";
const BBOX = [-74.28, 40.45, -73.70, 40.92]; // lon/lat min/max (NYC harbor + approaches)
const HELI = /^(B06|B47|B407|B412|B429|B05|EC|AS3|AS50|AS55|AS65|A109|A119|A139|AW1|S76|S92|H60|UH|R22|R44|R66|MD5|H500|EXPL|GAZL|H269|EH10|NH90|B505)/i;

const isHeli = (a) => a.category === "A7" || (a.t && HELI.test(a.t));
const inBox = (a) => a.lat != null && a.lon >= BBOX[0] && a.lon <= BBOX[2] && a.lat >= BBOX[1] && a.lat <= BBOX[3];

// Fail loud on a broken feed. An empty sky is normal overnight, so zero
// helicopters is a legitimate snapshot -- but a bad status, unparseable body
// or a payload with no `ac` array at all means the feed is down, and that must
// never be recorded as "no helicopters flying."
const res = await fetch(API, { headers: { "User-Agent": "rotor-motion-recorder" } });
if (!res.ok) {
  console.error(`airplanes.live returned HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
let j;
try {
  j = await res.json();
} catch {
  console.error("airplanes.live returned a body that is not JSON");
  process.exit(1);
}
if (!Array.isArray(j.ac)) {
  console.error(`airplanes.live response has no 'ac' array: ${JSON.stringify(j).slice(0, 200)}`);
  process.exit(1);
}

const t = Math.floor(Date.now() / 1000);
const ac = j.ac.filter((a) => isHeli(a) && inBox(a)).map((a) => ({
  h: a.hex, fl: (a.flight || "").trim(), ty: a.t || "", op: (a.ownOp || "").trim(),
  la: +a.lat.toFixed(4), lo: +a.lon.toFixed(4),
  al: a.alt_baro === "ground" ? 0 : a.alt_baro, gs: a.gs != null ? Math.round(a.gs) : null,
}));

const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD (ET)
fs.mkdirSync("data/log", { recursive: true });
fs.appendFileSync(`data/log/${day}.jsonl`, JSON.stringify({ t, ac }) + "\n");
console.log(`${day}  ${ac.length} helicopters logged`);
