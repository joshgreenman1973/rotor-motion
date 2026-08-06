# Rotor Motion

Live **helicopter** traffic over New York Harbor, drawn on the **FAA New York
Helicopter Route Chart** — tour flights, commuters, NYPD, medevac and news birds
as they fly. A companion to [Harbor Motion](https://joshgreenman1973.github.io/nyc-harbor-traffic/)
(boats), built on the same MapLibre GL + deck.gl stack.

- **Data:** real-time ADS-B from [airplanes.live](https://airplanes.live) (browser-direct,
  no key), filtered to rotorcraft (ADS-B emitter category **A7**). Helicopters leave
  fading "radar" wakes colored by altitude; hover for type, operator, altitude, speed.
- **Chart:** the FAA NY Helicopter Route Chart via [VFRMap.com](https://vfrmap.com),
  proxied through images.weserv.nl to add CORS (MapLibre fetches tiles for WebGL).

## Notes / limits
- ADS-B equipage is mandated in NYC's controlled airspace, so coverage is good, but
  some police/military or privacy-blocked aircraft may not appear on a free feed.
- This is a **live** view (plus accumulating session wakes) — there is no free
  turnkey historical archive of helicopter tracks, so there's no "year" view (yet).
  A future version could self-archive the live feed, as Harbor Motion does for AIS.
- We are building that archive now: `recorder/poll.mjs` snapshots the feed on a
  schedule and commits to the **[`data` branch](https://github.com/joshgreenman1973/rotor-motion/tree/data/data/log)**
  (one `data/log/YYYY-MM-DD.jsonl` per day, ET). It lives on its own branch
  because every commit to `main` triggers a full Pages rebuild, and the site
  itself reads only the live API. When the historical view is built, read the
  archive over `raw.githubusercontent.com` rather than moving it back onto `main`.
- The chart date segment (`CHART_DATE` in app.js) rolls each ~56-day FAA cycle; update it if tiles stop loading.

*Not for navigation. Chart © VFRMap.com / FAA. ADS-B via airplanes.live.*
