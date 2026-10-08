# Rotor Motion

Live **helicopter** traffic over New York Harbor, drawn on the **FAA New York
Helicopter Route Chart** — tour flights, commuters, NYPD, medevac and news birds
as they fly. A companion to [Harbor Motion](https://joshgreenman1973.github.io/nyc-harbor-traffic/)
(boats), built on the same MapLibre GL + deck.gl stack.

- **Data:** ADS-B from the [adsb.fi](https://adsb.fi) open data API (no key;
  personal, non-commercial use; 1 request/second), filtered to rotorcraft (ADS-B
  emitter category **A7**). adsb.fi sends no CORS header and refuses requests
  from Cloudflare's network, so neither the browser nor a Worker can call it.
  GitHub's runners can: `recorder/loop.mjs` runs as one long GitHub Actions job,
  fetches adsb.fi every 10 seconds and posts the helicopters to a Cloudflare
  Worker (`worker/`, at `rotor-motion-adsb.josh-greenman.workers.dev`), which
  keeps the latest batch in a Durable Object and serves it to the page with CORS.
  The Worker accepts a post only if it carries a GitHub Actions OIDC token signed
  for this repo's `main` branch, so there is no shared secret. The job hands off
  to a successor before GitHub's 6-hour limit; an hourly cron is only a backstop
  (from Oct. 1, 2026 GitHub started about five of 96 quarter-hourly cron runs a
  day, which left the old snapshot-based page hours out of date). The panel turns
  into a "delayed" warning when the latest positions are more than 3 minutes old.
  airplanes.live, the original source, closed anonymous access in August 2026.
- **Chart:** the FAA NY Helicopter Route Chart via [VFRMap.com](https://vfrmap.com),
  proxied through images.weserv.nl to add CORS (MapLibre fetches tiles for WebGL).

## Notes / limits
- ADS-B equipage is mandated in NYC's controlled airspace, so coverage is good, but
  some police/military or privacy-blocked aircraft may not appear on a free feed.
- There is no free turnkey historical archive of helicopter tracks, so there's
  no "year" view (yet). Wakes build up from when you open the page.
- We are building that archive: the recorder loop appends a snapshot every 15
  minutes to the **[`data` branch](https://github.com/joshgreenman1973/rotor-motion/tree/data/data/log)**
  (one `data/log/YYYY-MM-DD.jsonl` per day, ET). It lives on its own branch
  because every commit to `main` triggers a full Pages rebuild, and the site
  itself doesn't read it. When the historical view is built, read the archive
  over `raw.githubusercontent.com` rather than moving it back onto `main`.
  (`data/latest.json` on that branch is retired; the page reads the Worker.)
- The chart date segment (`CHART_DATE` in app.js) rolls each ~56-day FAA cycle; update it if tiles stop loading.

*Not for navigation. Chart © VFRMap.com / FAA. ADS-B via [adsb.fi](https://adsb.fi).*
