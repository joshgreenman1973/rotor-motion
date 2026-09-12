# Rotor Motion

Live **helicopter** traffic over New York Harbor, drawn on the **FAA New York
Helicopter Route Chart** — tour flights, commuters, NYPD, medevac and news birds
as they fly. A companion to [Harbor Motion](https://joshgreenman1973.github.io/nyc-harbor-traffic/)
(boats), built on the same MapLibre GL + deck.gl stack.

- **Data:** ADS-B from the [adsb.fi](https://adsb.fi) open data API (no key;
  personal, non-commercial use; 1 request/second), filtered to rotorcraft (ADS-B
  emitter category **A7**). adsb.fi sends no CORS header, so the page does not call
  it directly: `recorder/poll.mjs` snapshots it every 15 minutes and writes
  `data/latest.json` to the `data` branch, and the page reads that file over
  raw.githubusercontent.com. The panel shows the snapshot's time and turns into a
  stale warning when it is more than 45 minutes old. airplanes.live, the original
  source, closed anonymous access in August 2026.
- **Chart:** the FAA NY Helicopter Route Chart via [VFRMap.com](https://vfrmap.com),
  proxied through images.weserv.nl to add CORS (MapLibre fetches tiles for WebGL).

## Notes / limits
- ADS-B equipage is mandated in NYC's controlled airspace, so coverage is good, but
  some police/military or privacy-blocked aircraft may not appear on a free feed.
- This is a near-live view (15-minute snapshots, no wakes) — there is no free
  turnkey historical archive of helicopter tracks, so there's no "year" view (yet).
  A future version could self-archive the live feed, as Harbor Motion does for AIS.
- We are building that archive now: `recorder/poll.mjs` snapshots the feed on a
  schedule and commits to the **[`data` branch](https://github.com/joshgreenman1973/rotor-motion/tree/data/data/log)**
  (one `data/log/YYYY-MM-DD.jsonl` per day, ET). It lives on its own branch
  because every commit to `main` triggers a full Pages rebuild, and the site
  itself reads only `data/latest.json`. When the historical view is built, read the
  archive over `raw.githubusercontent.com` rather than moving it back onto `main`.
- The chart date segment (`CHART_DATE` in app.js) rolls each ~56-day FAA cycle; update it if tiles stop loading.

*Not for navigation. Chart © VFRMap.com / FAA. ADS-B via [adsb.fi](https://adsb.fi).*
