/* Rotor Motion — live helicopters over New York Harbor on the FAA NY Helicopter
   Route Chart. Real-time ADS-B from airplanes.live (browser-direct, no key),
   filtered to rotorcraft (ADS-B emitter category A7). Helicopters leave fading
   "radar" wakes that build up through the session. Not for navigation. */

// ---- Config -------------------------------------------------------------
const API = "https://api.airplanes.live/v2/point/40.7/-74.0/45";   // lat, lon, radius(nm)
// FAA NY Helicopter Route Chart via VFRMap (TMS path /{z}/{y}/{x}). VFRMap sends
// no CORS header and MapLibre fetches tiles for WebGL, so we proxy through
// images.weserv.nl which adds `access-control-allow-origin: *`.
const CHART_DATE = "20260319";
const CHART_TILES = `https://images.weserv.nl/?url=vfrmap.com/${CHART_DATE}/tiles/helic/{z}/{y}/{x}.jpg`;
const POLL_MS = 8000;
const TRAIL_WINDOW = 2 * 3600;   // seconds of wake to keep

// Altitude colour bands (feet) — helicopters work the low corridors.
const ALT_BANDS = [
  { max: 600, label: "≤ 600 ft", c: [214, 40, 40] },
  { max: 1000, label: "600–1,000", c: [240, 140, 30] },
  { max: 1500, label: "1,000–1,500", c: [225, 190, 40] },
  { max: 2500, label: "1,500–2,500", c: [50, 160, 95] },
  { max: Infinity, label: "2,500 ft +", c: [45, 120, 205] },
];
function altColor(alt) {
  const a = typeof alt === "number" ? alt : 0;
  for (const b of ALT_BANDS) if (a <= b.max) return b.c;
  return [120, 130, 150];
}
// Helicopter type fallback (for the rare A7-less rotorcraft)
const HELI_TYPE = /^(B06|B47|B407|B412|B429|B05|EC|AS3|AS50|AS55|AS65|A109|A119|A139|AW1|S76|S92|H60|UH|R22|R44|R66|MD5|H500|EXPL|GAZL|H269|EH10|NH90|B505)/i;

const $ = (id) => document.getElementById(id);
const fleet = new Map();   // hex -> {lat,lon,alt,gs,track,flight,type,op,reg,last,trail:[[lon,lat,t]]}

// ---- Map (TMS heli chart) ----------------------------------------------
const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      heli: { type: "raster", tiles: [CHART_TILES], tileSize: 256, scheme: "tms",
        maxzoom: 13, attribution: "© VFRMap.com / FAA" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#cdd7d2" } },
      { id: "heli", type: "raster", source: "heli" },
    ],
  },
  center: [-73.99, 40.70], zoom: 11, minZoom: 9.5, maxZoom: 13, dragRotate: false,
  attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");
const overlay = new deck.MapboxOverlay({ interleaved: true, layers: [] });
map.addControl(overlay);

const tooltip = $("tooltip");
function setTooltip(x, y, html) {
  if (!html) { tooltip.style.display = "none"; return; }
  tooltip.innerHTML = html; tooltip.style.display = "block";
  tooltip.style.left = (x + 14) + "px"; tooltip.style.top = (y + 14) + "px";
}

// ---- Legend -------------------------------------------------------------
$("legend").innerHTML = ALT_BANDS.map((b) =>
  `<span class="key"><span class="dot" style="background:rgb(${b.c})"></span>${b.label}</span>`).join("");

// ---- Live polling -------------------------------------------------------
const isHeli = (a) => a.category === "A7" || (a.t && HELI_TYPE.test(a.t));
async function poll() {
  try {
    const j = await (await fetch(API, { cache: "no-store" })).json();
    const t = Date.now() / 1000;
    for (const a of (j.ac || [])) {
      if (!isHeli(a) || a.lat == null || a.lon == null) continue;
      let h = fleet.get(a.hex);
      if (!h) { h = { trail: [] }; fleet.set(a.hex, h); }
      const alt = a.alt_baro === "ground" ? 0 : a.alt_baro;
      Object.assign(h, { lat: a.lat, lon: a.lon, alt, gs: a.gs, track: a.track,
        flight: (a.flight || "").trim(), type: a.t, op: (a.ownOp || "").trim(), reg: a.r, desc: a.desc, last: t });
      const lp = h.trail[h.trail.length - 1];
      if (!lp || Math.abs(lp[0] - a.lon) + Math.abs(lp[1] - a.lat) > 0.00012) h.trail.push([a.lon, a.lat, t]);
      const cut = t - TRAIL_WINDOW;
      while (h.trail.length && h.trail[0][2] < cut) h.trail.shift();
    }
    // prune fully-gone aircraft
    for (const [k, h] of fleet)
      if (t - (h.last || 0) > TRAIL_WINDOW && (!h.trail.length)) fleet.delete(k);
    updateCount(t);
  } catch (e) { console.warn("poll failed", e); $("count").textContent = "feed unavailable"; }
}
function updateCount(t) {
  let now = 0;
  for (const h of fleet.values()) if (t - (h.last || 0) < 120) now++;
  $("count").innerHTML = `<span class="n">${now}</span> helicopter${now === 1 ? "" : "s"} aloft now`;
}

// ---- Render -------------------------------------------------------------
function render() {
  const now = Date.now() / 1000;
  const all = [...fleet.values()];
  const live = all.filter((h) => h.lat != null && now - (h.last || 0) < 180);
  const trails = all.filter((h) => h.trail.length > 1)
    .map((h) => ({ alt: h.alt, p: h.trail.map((q) => [q[0], q[1]]), t: h.trail.map((q) => q[2]) }));
  overlay.setProps({ layers: [
    new deck.TripsLayer({ id: "wake-glow", data: trails, getPath: (d) => d.p, getTimestamps: (d) => d.t,
      getColor: (d) => altColor(d.alt), opacity: 0.2, widthMinPixels: 6, capRounded: true, jointRounded: true,
      trailLength: TRAIL_WINDOW, currentTime: now, fadeTrail: true, parameters: { depthTest: false } }),
    new deck.TripsLayer({ id: "wake", data: trails, getPath: (d) => d.p, getTimestamps: (d) => d.t,
      getColor: (d) => altColor(d.alt), opacity: 0.85, widthMinPixels: 1.8, capRounded: true, jointRounded: true,
      trailLength: TRAIL_WINDOW, currentTime: now, fadeTrail: true, parameters: { depthTest: false } }),
    new deck.ScatterplotLayer({ id: "halo", data: live, getPosition: (d) => [d.lon, d.lat],
      getFillColor: (d) => [...altColor(d.alt), 60], stroked: false, getRadius: 260,
      radiusMinPixels: 13, radiusMaxPixels: 32, parameters: { depthTest: false } }),
    new deck.ScatterplotLayer({ id: "heli", data: live, getPosition: (d) => [d.lon, d.lat],
      getFillColor: (d) => altColor(d.alt), getLineColor: [20, 30, 45, 235], lineWidthMinPixels: 1.4,
      stroked: true, getRadius: 130, radiusMinPixels: 5.5, radiusMaxPixels: 16, pickable: true,
      parameters: { depthTest: false } }),
  ] });
  requestAnimationFrame(render);
}

// ---- Tooltip ------------------------------------------------------------
const ago = (s) => { s = Math.max(0, Math.round(Date.now() / 1000 - s)); return s < 90 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; };
overlay.setProps({
  onHover: (info) => {
    if (info.object && info.layer && info.layer.id === "heli") {
      const h = info.object, L = [];
      L.push(`<div class="nm">${h.flight || h.reg || "Unknown"}${h.type ? " · " + h.type : ""}</div>`);
      if (h.op) L.push(`<div class="meta">${h.op}</div>`);
      const mv = [];
      if (typeof h.alt === "number") mv.push(`${h.alt.toLocaleString()} ft`);
      else if (h.alt === 0) mv.push("on ground");
      if (h.gs != null) mv.push(`${Math.round(h.gs)} kn`);
      if (h.track != null) mv.push(`hdg ${Math.round(h.track)}°`);
      if (mv.length) L.push(`<div class="meta">${mv.join(" · ")}</div>`);
      L.push(`<div class="meta">seen ${ago(h.last)}</div>`);
      setTooltip(info.x, info.y, L.join(""));
    } else setTooltip(0, 0, null);
  },
});

// ---- Intro dismiss ------------------------------------------------------
$("title-close").onclick = () => $("title").classList.add("hidden");
let dimmed = false;
const dimTitle = () => { if (!dimmed) { dimmed = true; $("title").classList.add("dim"); } };
map.on("dragstart", dimTitle); map.on("zoomstart", dimTitle);

// ---- Go -----------------------------------------------------------------
map.on("load", () => map.resize());
poll(); setInterval(poll, POLL_MS);
requestAnimationFrame(render);
