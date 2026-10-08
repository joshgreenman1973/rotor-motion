// Cloudflare Worker: live helicopter positions for Rotor Motion.
//
// The free ADS-B feeds send no CORS header, so the browser can't call them,
// and they refuse requests from Cloudflare's network (adsb.fi: HTTP 403,
// adsb.lol: HTTP 429, seen 2026-10-08), so this Worker can't fetch them either.
// GitHub's runners can. So the recorder loop (recorder/loop.mjs, a long-running
// GitHub Actions job) fetches adsb.fi every few seconds and POSTs the
// helicopters here; this Worker keeps the latest batch in a Durable Object and
// serves it to the page with `access-control-allow-origin: *`.
//
// No shared secret: each POST carries the job's GitHub Actions OIDC token, and
// the Worker accepts it only if GitHub signed it for a workflow on this repo's
// main branch.
//
//   GET  /        -> {t, source, ac:[...]}  (same shape as the recorder writes)
//   POST /ingest  -> store a new batch      (Authorization: Bearer <OIDC JWT>)

const REPO = "joshgreenman1973/rotor-motion";
const AUDIENCE = "rotor-motion-adsb";
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const MAX_BODY = 256 * 1024;
const CACHE_SECONDS = 5;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

function json(body, status, maxAge) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

// ---- GitHub OIDC verification --------------------------------------------
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const b64json = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));
let jwks = null, jwksAt = 0;

async function signingKey(kid) {
  for (let pass = 0; pass < 2; pass++) {
    // Refetch the key set hourly, or at once if GitHub has rotated to a kid we lack.
    if (!jwks || Date.now() - jwksAt > 3600e3 || pass === 1) {
      const r = await fetch(JWKS_URL);
      if (!r.ok) throw new Error(`JWKS HTTP ${r.status}`);
      jwks = (await r.json()).keys || [];
      jwksAt = Date.now();
    }
    const k = jwks.find((x) => x.kid === kid);
    if (k) return crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  }
  throw new Error("unknown signing key");
}

async function verifyActionsToken(header) {
  const m = /^Bearer (.+)$/.exec(header || "");
  if (!m) throw new Error("no bearer token");
  const parts = m[1].split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const head = b64json(parts[0]);
  if (head.alg !== "RS256") throw new Error("unexpected alg");
  const key = await signingKey(head.kid);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error("bad signature");
  const c = b64json(parts[1]);
  const now = Date.now() / 1000;
  if (c.iss !== ISSUER) throw new Error("wrong issuer");
  if (c.aud !== AUDIENCE) throw new Error("wrong audience");
  if (!(c.exp > now) || (c.nbf && c.nbf > now + 60)) throw new Error("expired");
  if (c.repository !== REPO || c.ref !== "refs/heads/main") throw new Error("wrong repository or branch");
  return c;
}

// ---- Worker ----------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const store = env.LATEST.get(env.LATEST.idFromName("nyc"));

    if (url.pathname === "/ingest" && request.method === "POST") {
      try {
        await verifyActionsToken(request.headers.get("authorization"));
      } catch (e) {
        return json({ error: `unauthorized: ${e.message}` }, 401, 0);
      }
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: "too large" }, 413, 0);
      let b;
      try { b = JSON.parse(text); } catch { return json({ error: "not JSON" }, 400, 0); }
      if (typeof b.t !== "number" || !Array.isArray(b.ac) || typeof b.source !== "string") {
        return json({ error: "expected {t, source, ac:[]}" }, 400, 0);
      }
      await store.fetch("https://store/", { method: "PUT", body: JSON.stringify({ t: b.t, source: b.source, ac: b.ac }) });
      return json({ ok: true, n: b.ac.length }, 200, 0);
    }

    if (request.method !== "GET") return json({ error: "not found" }, 404, 0);

    // Edge-cache reads for a few seconds so a crowd of viewers costs the
    // Durable Object one read per Cloudflare location per CACHE_SECONDS.
    const cache = caches.default;
    const key = new Request(new URL("/latest", request.url).toString());
    const hit = await cache.match(key);
    if (hit) return hit;
    const r = await store.fetch("https://store/");
    if (r.status !== 200) return json({ error: "no positions received yet" }, 503, 0);
    const out = json(await r.text(), 200, CACHE_SECONDS);
    ctx.waitUntil(cache.put(key, out.clone()));
    return out;
  },
};

// One instance holds the latest batch, in memory and in storage (so it
// survives the object being evicted between posts).
export class Latest {
  constructor(state) {
    this.state = state;
    this.val = null;
  }
  async fetch(request) {
    if (request.method === "PUT") {
      this.val = await request.text();
      await this.state.storage.put("latest", this.val);
      return new Response("ok");
    }
    if (this.val == null) this.val = (await this.state.storage.get("latest")) ?? null;
    return this.val == null ? new Response("", { status: 404 }) : new Response(this.val);
  }
}
