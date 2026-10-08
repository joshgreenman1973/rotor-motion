// Shared by recorder/loop.mjs: fetch NYC helicopters from the adsb.fi open data API.
//
// adsb.fi v3 point/radius (nm): readsb "ac" shape, incl. ownOp/desc. No key;
// 1 req/s limit; personal non-commercial use, cite adsb.fi. (airplanes.live
// closed anonymous access ~Aug 12 2026 and now returns 403.)
export const API = "https://opendata.adsb.fi/api/v3/lat/40.7/lon/-74.0/dist/45";
const BBOX = [-74.28, 40.45, -73.70, 40.92]; // lon/lat min/max (NYC harbor + approaches)
// Keep in sync with HELI_TYPE in app.js and the Worker.
const HELI = /^(B06|B47|B407|B412|B429|B05|EC|AS3|AS50|AS55|AS65|A109|A119|A139|AW1|S76|S92|H60|UH|R22|R44|R66|MD5|H500|EXPL|GAZL|H269|EH10|NH90|B505)/i;

const isHeli = (a) => a.category === "A7" || (a.t && HELI.test(a.t));
const inBox = (a) => a.lon >= BBOX[0] && a.lon <= BBOX[2] && a.lat >= BBOX[1] && a.lat <= BBOX[3];

// Throws on a broken feed: a bad status, an unparseable body or a payload with
// no `ac` array means the feed is down, and that must never be recorded as "no
// helicopters flying." Zero helicopters is a legitimate answer (empty sky
// overnight). Returns {t, ac} with the raw feed fields the page renders, for
// every rotorcraft in the 45 nm radius.
export async function fetchHelis() {
  const res = await fetch(API, { headers: { "User-Agent": "rotor-motion-recorder" } });
  if (!res.ok) throw new Error(`adsb.fi returned HTTP ${res.status} ${res.statusText}`);
  let j;
  try { j = await res.json(); } catch { throw new Error("adsb.fi returned a body that is not JSON"); }
  if (!Array.isArray(j.ac)) throw new Error(`adsb.fi response has no 'ac' array: ${JSON.stringify(j).slice(0, 200)}`);
  const t = Math.floor(Date.now() / 1000);
  const ac = j.ac.filter((a) => isHeli(a) && a.lat != null && a.lon != null).map((a) => ({
    hex: a.hex, flight: a.flight, t: a.t, r: a.r, ownOp: a.ownOp, desc: a.desc, category: a.category,
    lat: a.lat, lon: a.lon, alt_baro: a.alt_baro, gs: a.gs, track: a.track,
  }));
  return { t, ac };
}

// One archive line: compact records, harbor bounding box only, so the log stays small.
export function archiveLine({ t, ac }) {
  return JSON.stringify({ t, ac: ac.filter(inBox).map((a) => ({
    h: a.hex, fl: (a.flight || "").trim(), ty: a.t || "", op: (a.ownOp || "").trim(),
    la: +a.lat.toFixed(4), lo: +a.lon.toFixed(4),
    al: a.alt_baro === "ground" ? 0 : a.alt_baro, gs: a.gs != null ? Math.round(a.gs) : null,
  })) });
}

// YYYY-MM-DD in New York time.
export const dayET = (t) => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
