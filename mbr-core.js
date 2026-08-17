/* ═══════════════════════════════════════════════════════════════════════════
   mbr-core.js — shared plumbing for the Maine Basketball Rankings scorers
   ---------------------------------------------------------------------------
   STEP 1 of unifying the four scorers (football / baseball / basketball / field).

   This file owns ONLY the layer that was already effectively identical in all
   four scorers: Supabase transport, the offline push queue, the school
   autocomplete lookup, and the game-report upload/email triggers. Everything
   sport-specific (play entry, stat model, geometry, PDF layout, box score,
   clock rules) stays in the sport file.

   USAGE — load before the sport script, then configure:

     <script src="mbr-core.js?v=1"><\/script>
     ...
     MBR.init({
       queueKey  : 'mbr_fb_push_queue',
       isTestMode: () => G_test_mode,
       gameId    : () => G_game_id,
       makePDF   : () => generatePDF({ returnBlob:true })
     });

   The getters are closures supplied by the sport file because its top-level
   `let` bindings are not reachable from another script. Nothing here reads
   sport state directly.

   Every function is also published as a bare global with the SAME NAME it had
   inside the scorers, so existing call sites keep working untouched. That is
   deliberate: it keeps this first step a pure move, not a rewrite.

   CACHE NOTE: bump the ?v= query string when this file changes, or the service
   worker may serve a stale copy. This revision is v=14.

   NATIVE (Capacitor): sign-in opens in the system browser and returns through
   the custom scheme in NATIVE_REDIRECT, and the push queue and auth session are
   written through to native storage rather than trusting localStorage. Both
   paths degrade to the plain web behaviour when Capacitor isn't present, so the
   same file serves the website and the app.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const SB_URL = 'https://vtwupenqieesoktonbzg.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0d3VwZW5xaWVlc29rdG9uYnpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTA0MzgsImV4cCI6MjA4Nzk4NjQzOH0.OqkqF7NXr5LBQsQ0sl6S2o-kzQqbtBlRCLFszRnUoHA';

  // ══ DURABLE STORAGE ══════════════════════════════════════════════════════
  // localStorage is the wrong home for anything we cannot afford to lose. A
  // WKWebView evicts it under storage pressure and Safari's ITP can clear it
  // after a week of no visits — either one silently destroys a queue of unsent
  // scoring events, which is the single worst failure this app has.
  //
  // So: an in-memory mirror is the synchronous source of truth, which means
  // every existing call site stays synchronous and untouched, while writes also
  // go to the most durable backend available:
  //
  //   1. Capacitor Preferences  — native UserDefaults, survives everything
  //   2. IndexedDB              — not evicted on the same terms as localStorage
  //   3. localStorage           — last resort, and a mirror for older builds
  const NATIVE = !!(global.Capacitor && global.Capacitor.isNativePlatform
                    && global.Capacitor.isNativePlatform());
  const capPlugin = (n) => (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins[n]) || null;

  let _idbP = null;
  function idb() {
    if (_idbP) return _idbP;
    _idbP = new Promise((res) => {
      try {
        const rq = indexedDB.open('mbr-core', 1);
        rq.onupgradeneeded = () => { try { rq.result.createObjectStore('kv'); } catch (e) {} };
        rq.onsuccess = () => res(rq.result);
        rq.onerror   = () => res(null);
      } catch (e) { res(null); }
    });
    return _idbP;
  }
  async function idbGet(k) {
    const db = await idb(); if (!db) return null;
    return new Promise((res) => {
      try {
        const rq = db.transaction('kv', 'readonly').objectStore('kv').get(k);
        rq.onsuccess = () => res(rq.result == null ? null : rq.result);
        rq.onerror   = () => res(null);
      } catch (e) { res(null); }
    });
  }
  async function idbSet(k, v) {
    const db = await idb(); if (!db) return false;
    return new Promise((res) => {
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res(true);
        tx.onerror    = () => res(false);
      } catch (e) { res(false); }
    });
  }

  async function durableGet(key) {
    const P = capPlugin('Preferences');
    if (P) { try { const r = await P.get({ key }); if (r && r.value != null) return r.value; } catch (e) {} }
    const v = await idbGet(key);
    if (v != null) return v;
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  async function durableSet(key, value) {
    const P = capPlugin('Preferences');
    if (P) { try { await P.set({ key, value }); } catch (e) {} }
    await idbSet(key, value);
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  async function durableDel(key) {
    const P = capPlugin('Preferences');
    if (P) { try { await P.remove({ key }); } catch (e) {} }
    await idbSet(key, null);
    try { localStorage.removeItem(key); } catch (e) {}
  }

  // Ask the browser not to evict us. Cheap, and it measurably improves the odds
  // of keeping a queue on a phone that is low on space.
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {}

  // Exposed so scorers and the home screen can agree on the season without
  // each keeping their own copy of the rule.
  function seasonYearForDate(iso) {
    const d = new Date((iso || new Date().toLocaleDateString('en-CA')) + 'T12:00:00');
    const y = d.getFullYear();
    // Month is 0-based: 7 = August. Aug 15 or later belongs to the next school year.
    const rolled = (d.getMonth() > 7) || (d.getMonth() === 7 && d.getDate() >= 15);
    return rolled ? y + 1 : y;
  }

  const cfg = {
    queueKey  : 'mbr_push_queue',
    isTestMode: () => false,
    gameId    : () => null,
    isFinalized: () => false,
    makePDF   : null,
    sportId   : null,                      // this scorer's sport uuid
    // season_year rule — one rule for every sport.
    //
    // season_year is the calendar year the SCHOOL YEAR ends, so 25-26 is 2026.
    // A season runs mid-August to mid-August, which means a single cutoff covers
    // all of them: Aug 15 2026 onward is the 26-27 season, i.e. 2027.
    //
    //   Sep 2026 soccer      -> 2027     Nov 2026 basketball -> 2027
    //   Feb 2027 basketball  -> 2027     May 2027 lacrosse   -> 2027
    //   Jun 2026 lacrosse    -> 2026     Aug 3 2026          -> 2026
    //
    // This replaces the old per-sport rules (calendar year for fall/spring,
    // October rollover for basketball), which filed a Sept 2026 soccer game as
    // 2026 — a season behind.
    seasonYearFor: (iso) => MBR.seasonYearFor(iso),
    trackingLevel: 'full_stats',           // NB: constraint rejects 'full'
    keepAwake : true,                      // scorers want it; the home screen sets false
    isScoring : null,                      // () => true while a game is live, so OTA waits
  };

  // sportId may be supplied as a plain value OR a function. A function is safer:
  // init() runs early, and a getter would be evaluated immediately by
  // Object.assign — before the sport file's own state exists. Baseball picks its
  // sport at setup, so it must be resolved lazily.
  const sportIdNow = (override) => {
    const v = (override != null) ? override : cfg.sportId;
    return (typeof v === 'function') ? v() : v;
  };

  // Signed in -> send the user's token so Postgres can resolve auth.uid().
  // Signed out -> the anon key, exactly as before. Scoring is unaffected.
  const hdr = (extra) => {
    const s = sessionLoad();
    const bearer = (s && s.access_token && !isExpired(s)) ? s.access_token : SB_KEY;
    return Object.assign(
      { apikey: SB_KEY, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      extra || {}
    );
  };

  // ── Sign-in (Google) ─────────────────────────────────────────────────────
  // Scoring an MBR game stays login-free — this is only needed to CREATE your
  // own team (travel, JV, rec), so the rows can be owned by somebody.
  //
  // No supabase-js: the whole flow is a redirect out and a token back in the URL
  // hash. Once signed in, requests carry the user's token instead of the anon
  // key, which is how Postgres knows who auth.uid() is.
  const AUTH_KEY = 'mbr_auth';

  // Mirrored in memory so hdr() stays synchronous on every request, and written
  // through to durable storage so a signed-in coach isn't silently signed out
  // when the OS reclaims webview storage.
  let _sess;                                   // undefined = not yet read
  function sessionLoad() {
    if (_sess !== undefined) return _sess;
    try {
      const s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      _sess = (s && s.access_token) ? s : null; // stale tokens still return; refresh handles them
    } catch (e) { _sess = null; }
    return _sess;
  }
  function sessionSave(s) {
    _sess = s || null;
    try { s ? localStorage.setItem(AUTH_KEY, JSON.stringify(s)) : localStorage.removeItem(AUTH_KEY); } catch (e) {}
    if (s) durableSet(AUTH_KEY, JSON.stringify(s)); else durableDel(AUTH_KEY);
  }
  async function hydrateSession() {
    try {
      if (sessionLoad()) return;               // localStorage still had it
      const raw = await durableGet(AUTH_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && s.access_token) {
        _sess = s;
        try { localStorage.setItem(AUTH_KEY, raw); } catch (e) {}
      }
    } catch (e) {}
  }
  function isExpired(s) { return !!(s && s.expires_at && (s.expires_at * 1000) < Date.now() + 60000); }

  // Capture the token Supabase appends to the URL after Google sends the user
  // back, then scrub it from the address bar so it is not left lying around.
  function captureRedirect() {
    if (!global.location || !location.hash || location.hash.indexOf('access_token=') === -1) return false;
    if (!captureFromUrl(location.href)) return false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    return true;
  }

  async function refreshSession() {
    const s = sessionLoad();
    if (!s || !s.refresh_token) return null;
    try {
      const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token })
      });
      if (!r.ok) { sessionSave(null); return null; }
      const d = await r.json();
      const ns = { access_token: d.access_token, refresh_token: d.refresh_token || s.refresh_token,
                   expires_at: d.expires_at || (Math.floor(Date.now()/1000) + (d.expires_in || 3600)) };
      sessionSave(ns); return ns;
    } catch (e) { return null; }
  }

  // A long game can outlive a token, so top it up before it lapses.
  async function ensureSession() {
    let s = sessionLoad();
    if (s && isExpired(s)) s = await refreshSession();
    return s;
  }

  // Split out so it can be tested, and so a caller can render it as a link
  // rather than a redirect if that suits the UI better.
  function authUrl(returnTo, provider) {
    const back = returnTo || (global.location ? location.href.split('#')[0] : '');
    const p = provider || 'google';
    return `${SB_URL}/auth/v1/authorize?provider=${encodeURIComponent(p)}`
         + `&redirect_to=${encodeURIComponent(back)}`;
  }
  // ── Native sign-in ───────────────────────────────────────────────────────
  // Google refuses OAuth inside an embedded webview and fails with
  // disallowed_useragent, so under Capacitor the authorize URL has to open in
  // the system browser (ASWebAuthenticationSession). It returns via a custom URL
  // scheme, which arrives as an appUrlOpen event rather than a page load — so
  // the token has to be readable out of an arbitrary URL string, not just
  // location.hash.
  //
  // This scheme must be registered in Info.plist (CFBundleURLSchemes) AND added
  // to the Supabase redirect allowlist, same as the app.mainebasketballrankings
  // wildcard was.
  const NATIVE_REDIRECT = 'com.mainebasketballrankings.scorer://auth';

  function captureFromUrl(url) {
    if (!url) return false;
    const i = url.indexOf('#');
    if (i === -1) return false;
    const p = new URLSearchParams(url.slice(i + 1));
    if (!p.get('access_token')) return false;
    sessionSave({
      access_token : p.get('access_token'),
      refresh_token: p.get('refresh_token'),
      expires_at   : parseInt(p.get('expires_at') || '0', 10) || (Math.floor(Date.now()/1000) + 3600),
    });
    return true;
  }

  // Apple require an equivalent privacy-preserving login wherever a third-party
  // one is offered (guideline 4.8), so Google alone isn't shippable. Both go
  // through the same path — only the provider string differs.
  function signIn(provider, returnTo) {
    if (NATIVE) {
      const url = authUrl(NATIVE_REDIRECT, provider);
      const B = capPlugin('Browser');
      if (B) { B.open({ url, presentationStyle: 'popover' }); return; }
      try { global.open(url, '_system'); } catch (e) { location.href = url; }
      return;
    }
    location.href = authUrl(returnTo, provider);
  }
  function signInWithGoogle(returnTo) { signIn('google', returnTo); }
  function signInWithApple(returnTo)  { signIn('apple',  returnTo); }

  // ── Sign-in sheet ────────────────────────────────────────────────────────
  // One place for the provider buttons, because Apple has rules about how their
  // button may look and how prominent it has to be, and duplicating that across
  // five files is how it drifts out of compliance.
  //
  // Apple 4.8: where a third-party login is offered, an equivalent
  // privacy-preserving option must be offered too — and their button must be
  // no less prominent. So Apple sits first, same width, same weight.
  const APPLE_LOGO =
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" style="margin-top:-2px">'
    + '<path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35'
    + 'C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8'
    + '-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25'
    + '.29 2.58-2.34 4.5-3.74 4.25z"/></svg>';
  const GOOGLE_LOGO =
    '<svg viewBox="0 0 48 48" width="17" height="17" aria-hidden="true">'
    + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
    + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
    + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
    + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  function closeSignInSheet(){
    const el = document.getElementById('mbr-signin-sheet');
    if (el) el.remove();
  }

  // opts: { returnTo, before, title, note }
  //   before — run just before we navigate away (e.g. stash unsaved setup)
  function signInSheet(opts) {
    const o = opts || {};
    closeSignInSheet();
    const back = o.returnTo || (global.location ? location.href.split('#')[0] : '');

    const wrap = document.createElement('div');
    wrap.id = 'mbr-signin-sheet';
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;'
      + 'background:rgba(15,17,23,.62);padding:18px;'
      + '-webkit-user-select:none;user-select:none;';
    wrap.innerHTML =
      `<div style="background:#fff;border-radius:14px;padding:20px 18px 14px;max-width:340px;width:100%;
                   font-family:'Barlow',system-ui,sans-serif;color:#0f1117;
                   box-shadow:0 10px 40px rgba(0,0,0,.3)">
         <div style="font-family:'Playfair Display',Georgia,serif;font-weight:900;font-size:19px;
                     text-align:center;margin-bottom:6px">${o.title || 'Sign in'}</div>
         <div style="font-size:13px;line-height:1.5;color:#6b7280;text-align:center;margin-bottom:16px">
           ${o.note || 'Save your teams and rosters so you\u2019re not retyping a lineup before every game.'}
         </div>

         <button id="mbr-si-apple" style="width:100%;height:46px;border:none;border-radius:9px;
           background:#000;color:#fff;font-size:16px;font-weight:600;cursor:pointer;
           display:flex;align-items:center;justify-content:center;gap:7px;
           font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
           ${APPLE_LOGO}<span>Sign in with Apple</span></button>

         <button id="mbr-si-google" style="width:100%;height:46px;margin-top:10px;border:1px solid #dadce0;
           border-radius:9px;background:#fff;color:#3c4043;font-size:16px;font-weight:600;cursor:pointer;
           display:flex;align-items:center;justify-content:center;gap:9px;
           font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
           ${GOOGLE_LOGO}<span>Sign in with Google</span></button>

         <button id="mbr-si-cancel" style="width:100%;margin-top:12px;padding:8px;border:none;
           background:transparent;color:#6b7280;font-size:13px;cursor:pointer;
           font-family:'Barlow',sans-serif">Not now</button>
       </div>`;
    document.body.appendChild(wrap);

    const go = (provider) => {
      try { if (typeof o.before === 'function') o.before(); } catch (e) {}
      closeSignInSheet();
      signIn(provider, back);
    };
    document.getElementById('mbr-si-apple').onclick  = () => go('apple');
    document.getElementById('mbr-si-google').onclick = () => go('google');
    document.getElementById('mbr-si-cancel').onclick = closeSignInSheet;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSignInSheet(); });
  }
  function signInWithApple(returnTo)  { signIn('apple',  returnTo); }
  function signOut() { sessionSave(null); }
  function isSignedIn() { return !!sessionLoad(); }

  // Who is signed in. Cached, because the scorer asks on every render.
  let _me = null;
  async function currentUser(force) {
    const s = await ensureSession();
    if (!s) { _me = null; return null; }
    if (_me && !force) return _me;
    try {
      const r = await fetch(`${SB_URL}/auth/v1/user`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${s.access_token}` }
      });
      if (!r.ok) { if (r.status === 401) sessionSave(null); return null; }
      const u = await r.json();
      const meta = u.user_metadata || {};
      // Which provider they used. Supabase reports it on the identity; fall back
      // to app_metadata for older sessions.
      const prov = (Array.isArray(u.identities) && u.identities.length
                     ? u.identities[u.identities.length - 1].provider
                     : (u.app_metadata && u.app_metadata.provider)) || null;
      // Apple's "Hide My Email" hands back a privaterelay.appleid.com address.
      // It's a real, stable, deliverable address — but it is NOT the person's
      // actual email, so it will never match their Google identity. Anything
      // that reconciles accounts by email has to know the difference.
      const relay = !!(u.email && /@privaterelay\.appleid\.com$/i.test(u.email));
      _me = { id: u.id, email: u.email,
              name: meta.full_name || meta.name || (relay ? 'Apple user' : u.email),
              provider: prov, privateRelay: relay };
      return _me;
    } catch (e) { return null; }
  }

  // The async currentUser() caches into _me; once a team has been created we
  // have already awaited it, so callers can read the id synchronously to stamp
  // the matching game without a second round-trip.
  function currentUserId() { return _me && _me.id ? _me.id : null; }

  captureRedirect();

  // ── Supabase read ────────────────────────────────────────────────────────
  async function sbFetch(path) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: hdr() });
    return r.json();
  }

  // ── Supabase update ──────────────────────────────────────────────────────
  // Promoted from the field scorer; football was hand-rolling PATCH at each site.
  function sbPatch(table, filter, body) {
    return fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: hdr({ Prefer: 'return=minimal' }),
      body: JSON.stringify(body)
    });
  }

  // ── Monotonic event stamp ────────────────────────────────────────────────
  // Play order is the client's business, not the DB's, so stamps must be
  // strictly increasing even when two events land in the same millisecond.
  let _lastStamp = 0;
  function evtStamp() {
    const now = Date.now();
    _lastStamp = (now <= _lastStamp) ? _lastStamp + 1 : now;
    return new Date(_lastStamp).toISOString();
  }

  // ── Offline push queue ───────────────────────────────────────────────────
  let _flushing = false;
  let _droppedRows = 0;

  // The queue is the one thing losing which actually costs a customer a game, so
  // it lives in memory (synchronous, unchanged for every caller) and is written
  // through to durable storage on every mutation.
  let _queue = null;
  let _hydrated = false;

  function queueLoad() {
    if (_queue) return _queue;
    try { _queue = JSON.parse(localStorage.getItem(cfg.queueKey) || '[]'); }
    catch (e) { _queue = []; }
    return _queue;
  }
  // Draining a long queue calls this once per event, so the durable write is
  // coalesced onto a short timer. localStorage still takes every write
  // synchronously, and pagehide forces a final flush, so a kill between the two
  // costs nothing.
  let _durT = null;
  function queueSave(q) {
    _queue = Array.isArray(q) ? q : [];
    const json = JSON.stringify(_queue);
    try { localStorage.setItem(cfg.queueKey, json); } catch (e) {}
    if (_durT) clearTimeout(_durT);
    _durT = setTimeout(() => { _durT = null; durableSet(cfg.queueKey, JSON.stringify(_queue)); }, 250);
  }

  // Pull the real queue out of durable storage once at startup and reconcile it
  // with whatever localStorage still holds. If the two disagree we keep the
  // LONGER one: a duplicate insert comes back 409, which flushQueue already
  // treats as success, whereas a dropped row is gone for good.
  async function hydrateQueue() {
    if (_hydrated) return;
    _hydrated = true;
    try {
      // Re-read from localStorage under the sport's REAL queueKey. The mirror
      // may already hold rows read under the default key, because setQueueStatus
      // and an early sbInsert can both run before init() supplies the real one.
      let local = [];
      try { local = JSON.parse(localStorage.getItem(cfg.queueKey) || '[]'); } catch (e) { local = []; }
      if (!Array.isArray(local)) local = [];
      const raw     = await durableGet(cfg.queueKey);
      let durable   = [];
      try { durable = raw ? JSON.parse(raw) : []; } catch (e) { durable = []; }
      if (!Array.isArray(durable)) durable = [];
      _queue = (durable.length > local.length) ? durable : local;
      const json = JSON.stringify(_queue);
      try { localStorage.setItem(cfg.queueKey, json); } catch (e) {}
      await durableSet(cfg.queueKey, json);
      setQueueStatus();
      if (_queue.length && navigator.onLine) flushQueue();
    } catch (e) {}
  }
  function setQueueStatus() {
    const q = queueLoad();
    let el = document.getElementById('push-queue-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'push-queue-status';
      el.style.cssText = 'position:fixed;bottom:8px;left:10px;font-size:11px;font-family:sans-serif;display:flex;align-items:center;gap:5px;z-index:9999;opacity:0.85;';
      document.body.appendChild(el);
    }
    const drop = _droppedRows > 0 ? `<span style="color:#c00">· ${_droppedRows} rejected</span>` : '';
    el.innerHTML = (q.length === 0 && !drop) ? ''
      : `${q.length ? '<span>🟡</span><span style="color:#888">' + q.length + ' event' + (q.length > 1 ? 's' : '') + ' queued</span>' : ''}${drop}`;
  }

  // A 4xx means the row will NEVER be accepted (bad enum, bad column, duplicate).
  // Retrying it forever just blocks everything behind it. 408/429 are the
  // exceptions — those are "try again", not "never".
  function isPermanentReject(status) {
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
  }

  async function flushQueue() {
    if (_flushing) return;
    _flushing = true;
    let q = queueLoad();
    while (q.length > 0) {
      const { table, row } = q[0];
      try {
        const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
          method: 'POST',
          headers: hdr({ Prefer: 'return=minimal' }),
          body: JSON.stringify(row)
        });
        if (r.ok || r.status === 409) { q.shift(); queueSave(q); setQueueStatus(); continue; }
        if (isPermanentReject(r.status)) {
          // Drop it and keep going — do NOT let one bad row wedge the whole queue.
          let body = ''; try { body = await r.text(); } catch (_) {}
          console.error('DROPPING permanently-rejected event', r.status, body, row);
          _droppedRows++;
          q.shift(); queueSave(q); setQueueStatus();
          continue;
        }
        throw new Error(`HTTP ${r.status}`);          // 5xx / 429 → transient, retry later
      } catch (e) {
        console.warn('flush failed (transient), will retry', e);
        break;
      }
    }
    _flushing = false;
  }

  // ── Supabase insert (queues when offline) ────────────────────────────────
  async function sbInsert(table, row) {
    if (cfg.isTestMode()) return;
    if (navigator.onLine) {
      try {
        const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
          method: 'POST',
          headers: hdr({ Prefer: 'return=minimal' }),
          body: JSON.stringify(row)
        });
        if (!r.ok && r.status !== 409) {
          if (isPermanentReject(r.status)) {
            let body = ''; try { body = await r.text(); } catch (_) {}
            console.error('event REJECTED (not queued — it would never succeed)', r.status, body, row);
            _droppedRows++; setQueueStatus(); return;
          }
          throw new Error(`HTTP ${r.status}`);
        }
        // only pay for a drain when there is actually something queued
        if (queueLoad().length) flushQueue();
        return;
      } catch (e) { console.warn('sbInsert failed, queuing', e); }
    }
    const q = queueLoad(); q.push({ table, row }); queueSave(q); setQueueStatus();
  }

  // ── School autocomplete ──────────────────────────────────────────────────
  // A school can have more than one team row (gender / sport), so every id is
  // kept per name and the caller picks whichever actually has a roster.
  let _schools = null;
  let _schoolIds = {};
  // Supabase caps ANY single response at 1000 rows, whatever `limit` asks for.
  // With ~1040 team rows a one-shot fetch silently lost everything after "Wi" —
  // Wiscasset, Wisdom, Woodland, Yarmouth and York never appeared in any
  // autocomplete. Page through until the tail is exhausted.
  const SCHOOL_PAGE = 1000;
  async function loadSchools() {
    if (_schools) return _schools;
    try {
      const byName = {};
      for (let offset = 0, guard = 0; guard < 25; offset += SCHOOL_PAGE, guard++) {
        const rows = await sbFetch(
          `teams?select=id,school_name&order=school_name.asc&limit=${SCHOOL_PAGE}&offset=${offset}`);
        if (!Array.isArray(rows) || rows.length === 0) break;
        rows.forEach(r => { if (r.school_name) { (byName[r.school_name] = byName[r.school_name] || []).push(r.id); } });
        if (rows.length < SCHOOL_PAGE) break;      // short page = last page
      }
      _schools = Object.keys(byName).sort();
      _schoolIds = byName;
    } catch (e) { _schools = []; _schoolIds = {}; }
    global._schools = _schools; global._schoolIds = _schoolIds;
    return _schools;
  }
  function schoolIds() { return _schoolIds; }

  // ── Game report: upload the PDF, then trigger the subscriber email ───────
  async function autoUploadGameReport() {
    const gid = cfg.gameId();
    if (!gid || cfg.isTestMode() || !cfg.makePDF) return;
    try {
      const blob = await cfg.makePDF();
      const path = `${gid}.pdf`;
      const up = await fetch(`${SB_URL}/storage/v1/object/game-reports/${path}`, {
        method: 'POST',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
        body: blob
      });
      if (!up.ok) { console.warn('report upload failed', up.status); return; }
      const url = `${SB_URL}/storage/v1/object/public/game-reports/${path}`;
      await fetch(`${SB_URL}/rest/v1/games?id=eq.${gid}`, {
        method: 'PATCH',
        headers: hdr({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ report_url: url })
      });
    } catch (e) { console.warn('autoUploadGameReport error', e); }
  }

  async function emailGameReport() {
    const gid = cfg.gameId();
    if (!gid || cfg.isTestMode()) return;
    try {
      const r = await fetch(`${SB_URL}/functions/v1/email-game-report`, {
        method: 'POST',
        headers: hdr(),
        body: JSON.stringify({ game_id: gid })
      });
      console.log('email-game-report', await r.json().catch(() => ({ status: r.status })));
    } catch (e) { console.warn('email trigger failed', e); }
  }

  // ── Unscheduled / emergency game ─────────────────────────────────────────
  // Turns an ad-hoc matchup into a real games row so it syncs to the scoreboard,
  // the live page, the XML feed and the report email. Returns the new game id, or
  // null so the caller can fall back to a local-only (test-mode) game.
  //
  // Merged from the basketball and field scorers: basketball's response-body
  // error logging and `event` support, field's pluggable season-year rule.
  async function createGame(opts) {
    const o = opts || {};
    try {
      const iso = o.date || new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD, local
      const row = {
        sport_id      : sportIdNow(o.sportId),
        season_year   : (o.seasonYear != null) ? o.seasonYear : cfg.seasonYearFor(iso),
        home_team_id  : o.homeTeamId,
        away_team_id  : o.awayTeamId,
        game_date     : iso,
        status        : 'scheduled',
        location      : o.venue || null,
        tracking_level: o.trackingLevel || cfg.trackingLevel,
      };
      if (o.event) row.event = o.event;
      if (o.isSummer != null) row.is_summer = !!o.isSummer;
      // A game that involves a user-created team must itself be owned, so it is
      // hidden from public listings exactly like the team is. Two canonical
      // Maine teams leave this null and the row stays public + login-free.
      if (o.ownerId) row.owner_id = o.ownerId;
      if (!row.sport_id || !row.home_team_id || !row.away_team_id) {
        console.warn('createGame: missing sport or team ids', row);
        return null;
      }
      const res = await fetch(`${SB_URL}/rest/v1/games`, {
        method: 'POST',
        headers: hdr({ Prefer: 'return=representation' }),
        body: JSON.stringify(row)
      });
      if (!res.ok) {
        console.warn('createGame insert failed', res.status, await res.text().catch(() => ''));
        return null;
      }
      const data = await res.json();
      const g = Array.isArray(data) ? data[0] : data;
      return (g && g.id) ? g.id : null;
    } catch (e) { console.warn('createGame error', e); return null; }
  }

  // Resolve a school name to a team id. A school owns one team row per
  // sport-and-gender, so both filters run server-side. Gender is optional and
  // falls back gracefully — football has a single team per school, but soccer,
  // lacrosse and basketball are split boys/girls and WILL pick the wrong roster
  // without it. Merged up from the field scorer's fetchTeamIdByName.
  async function resolveTeamId(schoolName, sportId, gender) {
    const name = String(schoolName || '').trim();
    const sid = sportIdNow(sportId);
    if (!name || !sid) return null;
    const enc = encodeURIComponent(name);
    const tries = [];
    if (gender) {
      const g = /girl|women|f$/i.test(String(gender)) ? 'girls' : 'boys';
      tries.push(`teams?school_name=eq.${enc}&sport_id=eq.${sid}&gender=ilike.${g}&select=id&limit=1`);
    }
    tries.push(`teams?school_name=eq.${enc}&sport_id=eq.${sid}&select=id&limit=1`);
    for (const q of tries) {
      try {
        const rows = await sbFetch(q);
        if (rows && rows.length && rows[0].id) return rows[0].id;
      } catch (e) { console.warn('resolveTeamId query failed', e); }
    }
    return null;
  }

  // ── User-created team ────────────────────────────────────────────────────
  // Scoring a Maine game is anon/login-free. But a team that is NOT in the
  // master schedule — a non-Maine scrimmage opponent, a travel / JV / rec squad
  // — has to be created, and the database only lets a SIGNED-IN user do it: the
  // teams INSERT policy is `with_check (owner_id = auth.uid())`, authenticated
  // role only. So this stamps ownership AND, by requiring a live session, IS the
  // gate — the server rejects an anonymous attempt outright.
  //
  // (NH football teams that count against Maine records live in the master
  // schedule already, so they resolve as canonical and never reach here.)
  async function createTeam(schoolName, sportId, gender, roster) {
    const name = String(schoolName || '').trim();
    const sid  = sportIdNow(sportId);
    const g    = /girl|women|f$/i.test(String(gender || '')) ? 'Girls' : 'Boys';
    if (!name || !sid) return null;
    const me = await currentUser();
    if (!me) return null;                 // no session — caller should prompt sign-in
    try {
      const row = { school_name: name, sport_id: sid, gender: g,
                    owner_id: me.id, visibility: 'private' };
      if (roster && roster.length) row.roster = roster;
      const res = await fetch(`${SB_URL}/rest/v1/teams`, {
        method : 'POST',
        headers: hdr({ Prefer: 'return=representation' }),
        body   : JSON.stringify(row)
      });
      if (!res.ok) {
        console.warn('createTeam failed', res.status, await res.text().catch(() => ''));
        return null;
      }
      const data = await res.json();
      const t = Array.isArray(data) ? data[0] : data;
      return (t && t.id) ? t.id : null;
    } catch (e) { console.warn('createTeam error', e); return null; }
  }

  // Resolve a school to a team id, CREATING an owner-stamped team when the name
  // is not a known Maine (or master-schedule) team. Return shapes let the setup
  // UI react without eating a silent 403:
  //   { id, created:false }        existing canonical (or already-owned) team
  //   { id, created:true }         a new team owned by the signed-in user
  //   { id:null, needsAuth:true }  not in the DB and nobody is signed in — prompt
  //   { id:null, failed:true }     signed in, but the insert did not take
  async function resolveOrCreateTeamId(schoolName, sportId, gender, roster) {
    const existing = await resolveTeamId(schoolName, sportId, gender);
    if (existing) return { id: existing, created: false };
    if (!isSignedIn()) return { id: null, needsAuth: true, name: String(schoolName || '').trim() };
    const id = await createTeam(schoolName, sportId, gender, roster);
    if (id) return { id, created: true };
    return { id: null, failed: true, needsAuth: !isSignedIn() };
  }

  // The signed-in user's own teams for a sport, roster included so a "My Teams"
  // picker can fill the lineup too. RLS returns only the caller's own rows.
  async function listMyTeams(sportId) {
    const sid = sportIdNow(sportId);
    const me = await currentUser();
    if (!me || !sid) return [];
    try {
      const rows = await sbFetch(
        `teams?owner_id=eq.${me.id}&sport_id=eq.${sid}` +
        `&select=id,school_name,gender,roster&order=school_name.asc`);
      return Array.isArray(rows) ? rows : [];
    } catch (e) { console.warn('listMyTeams failed', e); return []; }
  }

  // Persist a lineup onto an owned team so it carries to the next game. The
  // owner_id filter + the "owner edits own" UPDATE policy mean a canonical team
  // (owner_id NULL) matches nothing and is left untouched — safe to call for
  // either side without checking ownership first.
  async function saveTeamRoster(teamId, roster) {
    if (!teamId) return false;
    const me = await currentUser();
    if (!me) return false;
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/teams?id=eq.${teamId}&owner_id=eq.${me.id}`,
        { method: 'PATCH', headers: hdr({ Prefer: 'return=minimal' }),
          body: JSON.stringify({ roster: roster || [] }) });
      return r.ok;
    } catch (e) { console.warn('saveTeamRoster failed', e); return false; }
  }

  // ── Coach dashboard (my-games page) ──────────────────────────────────────
  // All of the signed-in user's own teams, across every sport.
  async function myTeamsAll() {
    const me = await currentUser();
    if (!me) return [];
    try {
      const rows = await sbFetch(
        `teams?owner_id=eq.${me.id}` +
        `&select=id,school_name,gender,sport_id,roster&order=school_name.asc`);
      return Array.isArray(rows) ? rows : [];
    } catch (e) { console.warn('myTeamsAll failed', e); return []; }
  }
  // All of the signed-in user's own games, newest first, with team names + scores.
  async function myGames() {
    const me = await currentUser();
    if (!me) return [];
    try {
      const rows = await sbFetch(
        `games?owner_id=eq.${me.id}` +
        `&select=id,game_date,status,sport_id,event,location,` +
        `home_score,away_score,home_score_live,away_score_live,` +
        `home_team:home_team_id(school_name),away_team:away_team_id(school_name)` +
        `&order=game_date.desc`);
      return Array.isArray(rows) ? rows : [];
    } catch (e) { console.warn('myGames failed', e); return []; }
  }
  // Delete one owned game and its events. game_events has RLS disabled; the games
  // DELETE is owner-scoped so it can only ever remove the caller's own row.
  async function deleteGame(gameId) {
    if (!gameId) return false;
    const me = await currentUser();
    if (!me) return false;
    try {
      await fetch(`${SB_URL}/rest/v1/game_events?game_id=eq.${gameId}`,
        { method: 'DELETE', headers: hdr({ Prefer: 'return=minimal' }) });
      const r = await fetch(`${SB_URL}/rest/v1/games?id=eq.${gameId}&owner_id=eq.${me.id}`,
        { method: 'DELETE', headers: hdr({ Prefer: 'return=minimal' }) });
      return r.ok;
    } catch (e) { console.warn('deleteGame failed', e); return false; }
  }
  // Delete an owned team. If games still reference it, block (unless cascade) so a
  // coach doesn't silently lose game history. cascade=true removes those games too.
  async function deleteTeam(teamId, cascade) {
    if (!teamId) return { ok: false };
    const me = await currentUser();
    if (!me) return { ok: false };
    try {
      const g = await sbFetch(
        `games?owner_id=eq.${me.id}` +
        `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})&select=id`);
      const gameIds = (g || []).map(x => x.id);
      if (gameIds.length && !cascade) return { ok: false, blocked: true, gameCount: gameIds.length };
      for (const gid of gameIds) { await deleteGame(gid); }
      const r = await fetch(`${SB_URL}/rest/v1/teams?id=eq.${teamId}&owner_id=eq.${me.id}`,
        { method: 'DELETE', headers: hdr({ Prefer: 'return=minimal' }) });
      return { ok: r.ok };
    } catch (e) { console.warn('deleteTeam failed', e); return { ok: false }; }
  }

  // ── Live clock sync ──────────────────────────────────────────────────────
  // The XML feed's <GameClock> reads games.game_clock. Scoring events alone do
  // not move the clock, so without this the broadcast clock freezes between
  // plays. Promoted from the field scorer, which had it and football did not.
  // Skips identical writes, so a stopped clock costs nothing.
  let _clkTimer = null, _lastClkLabel = null;
  function startClockSync(labelFn, everyMs) {
    stopClockSync();
    if (typeof labelFn !== 'function') return;
    _clkTimer = setInterval(() => {
      const gid = cfg.gameId();
      if (!gid || cfg.isTestMode() || (cfg.isFinalized && cfg.isFinalized())) return;
      let lbl; try { lbl = labelFn(); } catch (e) { return; }
      if (lbl == null || lbl === _lastClkLabel) return;
      _lastClkLabel = lbl;
      sbPatch('games', 'id=eq.' + gid, { game_clock: lbl }).catch(() => {});
    }, everyMs || 20000);
  }
  function stopClockSync() { if (_clkTimer) { clearInterval(_clkTimer); _clkTimer = null; } }

  // ── Status bar ───────────────────────────────────────────────────────────
  // By default the webview runs full-screen underneath the iOS status bar, so
  // the clock, wifi and battery land on top of the top bar. CSS
  // env(safe-area-inset-top) is the usual answer, but it reports 0 under this
  // Capacitor config, so do it natively instead: tell iOS to reserve the status
  // bar area and inset the webview below it. That fixes every page at once and
  // doesn't depend on each file remembering to pad itself.
  function initStatusBar() {
    const SB = capPlugin('StatusBar');
    if (!SB) return;
    try { SB.setOverlaysWebView({ overlay: false }); } catch (e) {}
    // Dark text — the whole app is on a light background.
    try { SB.setStyle({ style: 'LIGHT' }); } catch (e) {}
    try { SB.setBackgroundColor({ color: '#ffffff' }); } catch (e) {}
  }
  if (NATIVE) {
    if (global.document && document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', initStatusBar);
    else initStatusBar();
  }

  // ── Local mode ───────────────────────────────────────────────────────────
  // Not everyone scoring a game cares about the Maine schedule. A coach in
  // Pittsburgh will never see a game in that list, and a Portland AAU coach
  // won't either — for both of them the scheduled-games picker is dead weight
  // between them and the New Game button.
  //
  // Local mode hides it and starts every scorer on New Game. It's a preference,
  // not a lockout: the toggle stays visible and flipping it back restores the
  // schedule immediately. Stored durably so it survives an app restart.
  const LOCAL_MODE_KEY = 'mbr_local_mode';
  let _localMode = null;                 // null = not yet read

  function localMode() {
    if (_localMode !== null) return _localMode;
    try { _localMode = localStorage.getItem(LOCAL_MODE_KEY) === '1'; }
    catch (e) { _localMode = false; }
    return _localMode;
  }
  function setLocalMode(on) {
    _localMode = !!on;
    try { localStorage.setItem(LOCAL_MODE_KEY, _localMode ? '1' : '0'); } catch (e) {}
    durableSet(LOCAL_MODE_KEY, _localMode ? '1' : '0');
    try { global.dispatchEvent(new CustomEvent('mbr:localmode', { detail: _localMode })); } catch (e) {}
    return _localMode;
  }
  async function hydrateLocalMode() {
    try {
      const raw = await durableGet(LOCAL_MODE_KEY);
      if (raw == null) return;
      const v = raw === '1';
      if (v !== localMode()) {
        _localMode = v;
        try { localStorage.setItem(LOCAL_MODE_KEY, raw); } catch (e) {}
        try { global.dispatchEvent(new CustomEvent('mbr:localmode', { detail: v })); } catch (e) {}
      }
    } catch (e) {}
  }

  // Hide a scheduled-games block and flip the scorer to its "new game" mode.
  // Each scorer passes its own element ids, because their setup screens differ.
  function applyLocalMode(opts) {
    const o = opts || {};
    const on = localMode();
    (o.hide || []).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = on ? 'none' : '';
    });
    if (on && typeof o.onNewGame === 'function') { try { o.onNewGame(); } catch (e) {} }
    return on;
  }

  // ── Over-the-air updates ─────────────────────────────────────────────────
  // The scorers are web files inside a native shell, so a scoring bug can be
  // fixed and delivered the same night instead of waiting on App Review. Apple
  // permits this for interpreted code (3.3.2) as long as the app's purpose
  // doesn't change — native plugins, the icon and Info.plist still need a build.
  //
  // The critical call is notifyAppReady(). Capgo activates a downloaded bundle
  // provisionally and rolls back to the last good one if the app doesn't confirm
  // a healthy boot. Miss this and every update reverts, silently, which looks
  // exactly like "the update didn't work".
  function otaPlugin() { return capPlugin('CapacitorUpdater'); }

  let _otaReadySent = false;
  function otaNotifyReady() {
    if (_otaReadySent) return;
    const U = otaPlugin(); if (!U) return;
    _otaReadySent = true;
    try { U.notifyAppReady(); } catch (e) { console.warn('ota notifyAppReady', e); }
  }

  // Check on launch and whenever the app comes back to the foreground — a coach
  // leaves the app open all game, so "on launch" alone could mean days.
  function otaInit() {
    const U = otaPlugin(); if (!U) return;
    otaNotifyReady();
    // Never interrupt a game in progress: a bundle swap reloads the webview, and
    // doing that mid-quarter would be worse than any bug it fixes. Scorers set
    // this flag; the update lands on the next quiet foreground instead.
    const busy = () => {
      try { return typeof cfg.isScoring === 'function' ? !!cfg.isScoring() : false; }
      catch (e) { return false; }
    };
    const check = () => {
      if (busy() || !navigator.onLine) return;
      try { U.notifyAppReady(); } catch (e) {}
    };
    if (global.document) {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    }
    try { global.addEventListener('online', check); } catch (e) {}
  }

  function otaVersion() {
    const U = otaPlugin();
    if (!U || !U.current) return Promise.resolve(null);
    return U.current().then(r => (r && r.bundle) ? r.bundle.version : null).catch(() => null);
  }

  // ── Keep the screen on ───────────────────────────────────────────────────
  // A phone that sleeps in the third quarter is useless at the scorer's table.
  // iOS Safari's Wake Lock support is patchy, so prefer the native plugin and
  // fall back to Wake Lock in the browser. iOS also drops a wake lock whenever
  // the app is backgrounded, so it gets re-taken when we come back.
  let _wakeLock = null;
  async function keepAwake(on) {
    const K = capPlugin('KeepAwake');
    if (K) { try { on ? await K.keepAwake() : await K.allowSleep(); } catch (e) {} return; }
    try {
      if (on && navigator.wakeLock && !_wakeLock) {
        _wakeLock = await navigator.wakeLock.request('screen');
        _wakeLock.addEventListener('release', () => { _wakeLock = null; });
      } else if (!on && _wakeLock) { await _wakeLock.release(); _wakeLock = null; }
    } catch (e) {}
  }

  // ── File export ──────────────────────────────────────────────────────────
  // A blob URL with a download attribute does nothing inside a webview — the
  // tap just silently fails. On native the file is written to the app's cache
  // and handed to the iOS share sheet, so it can go to Files, Mail, AirDrop or
  // anywhere else. Callers use the same one line either way.
  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(String(r.result).split(',')[1] || '');
      r.onerror   = rej;
      r.readAsDataURL(blob);
    });
  }
  // iOS will only present one share sheet at a time. End-of-game fires a CSV and
  // a PDF back to back, and the second was being silently dropped while the
  // first was still on screen — the CSV appeared, the PDF never did. So shares
  // are queued: each waits for the previous sheet to be dismissed.
  let _shareChain = Promise.resolve();
  function queueShare(fn) {
    const next = _shareChain.then(fn, fn);
    _shareChain = next.catch(() => {});
    return next;
  }

  async function saveFile(filename, blob) {
    const FS = capPlugin('Filesystem'), SH = capPlugin('Share');
    if (FS && SH) {
      try {
        const data = await blobToBase64(blob);
        const w = await FS.writeFile({ path: filename, data, directory: 'CACHE' });
        await queueShare(() => SH.share({ title: filename, url: w.uri }));
        return true;
      } catch (e) {
        // A user cancelling the sheet also lands here; that isn't a failure, and
        // re-triggering a browser download on top of it would be wrong.
        const msg = String((e && (e.message || e)) || '');
        if (/cancel/i.test(msg)) return false;
        console.warn('native save failed, falling back to download', e);
      }
    }
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1000);
      return true;
    } catch (e) { console.warn('saveFile failed', e); return false; }
  }

  // ── Small shared utility ─────────────────────────────────────────────────
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ── Wire up + publish ────────────────────────────────────────────────────
  function init(options) {
    Object.assign(cfg, options || {});
    // queueKey isn't known until now, so the durable read has to happen here
    // rather than at load. It's async; the in-memory mirror covers the gap.
    hydrateQueue();
    hydrateSession();
    hydrateLocalMode();
    otaInit();
    if (cfg.keepAwake) {
      keepAwake(true);
      if (global.document) document.addEventListener('visibilitychange', () => {
        if (!document.hidden) keepAwake(true);       // iOS drops the lock on background
      });
    }
    try { setQueueStatus(); } catch (e) {}
    return MBR;
  }

  const MBR = {
    SB_URL, SB_KEY, init, cfg,
    sbFetch, sbInsert, sbPatch, evtStamp,
    startClockSync, stopClockSync,
    queueLoad, queueSave, flushQueue, setQueueStatus, isPermanentReject,
    durableGet, durableSet, durableDel, hydrateQueue, hydrateSession,
    NATIVE, NATIVE_REDIRECT, captureFromUrl,
    loadSchools, schoolIds, createGame, resolveTeamId, createTeam, resolveOrCreateTeamId,
    listMyTeams, saveTeamRoster, myTeamsAll, myGames, deleteGame, deleteTeam,
    signInWithGoogle, signInWithApple, signIn, signInSheet, closeSignInSheet, authUrl, signOut, isSignedIn, currentUser, currentUserId, ensureSession,
    autoUploadGameReport, emailGameReport,
    clamp, keepAwake, saveFile, initStatusBar, queueShare,
    otaNotifyReady, otaVersion,
    localMode, setLocalMode, applyLocalMode,
    seasonYearFor: seasonYearForDate,
    get droppedRows() { return _droppedRows; },
  };

  // Publish under the same bare names the scorers already use, so this first
  // step is a move rather than a rewrite. New code should prefer MBR.*.
  global.MBR = MBR;
  ['sbFetch','sbInsert','evtStamp','queueLoad','queueSave','flushQueue','setQueueStatus',
   'isPermanentReject','loadSchools','autoUploadGameReport','emailGameReport','clamp',
   'createGame','resolveTeamId','sbPatch','startClockSync','stopClockSync','saveFile']
    .forEach(n => { global[n] = MBR[n]; });
  global.SB_URL = SB_URL;
  global.SB_KEY = SB_KEY;
  global._schools = null;
  global._schoolIds = {};

  // ── Native URL callback ──────────────────────────────────────────────────
  // The web flow returns through a page load, so the scorer re-renders for free.
  // Native has no reload — the token arrives as an event — so nudge the UI the
  // same way the reload would have, and fire mbr:signedin for anything else
  // that wants to know.
  if (NATIVE) {
    const A = capPlugin('App');
    if (A && A.addListener) {
      A.addListener('appUrlOpen', (data) => {
        if (!data || !data.url) return;
        if (!captureFromUrl(data.url)) return;
        _me = null;
        try { const B = capPlugin('Browser'); if (B) B.close(); } catch (e) {}
        try { if (typeof global.renderAuthLine === 'function') global.renderAuthLine(); } catch (e) {}
        try { if (typeof global.loadMyTeams   === 'function') global.loadMyTeams();   } catch (e) {}
        try { global.dispatchEvent(new CustomEvent('mbr:signedin')); } catch (e) {}
      });
    }
  }

  // Drain triggers — safe to attach before the sport file configures us.
  global.addEventListener('online', () => flushQueue());
  // Last chance to get the queue onto durable storage before iOS suspends us.
  global.addEventListener('pagehide', () => {
    try { durableSet(cfg.queueKey, JSON.stringify(queueLoad())); } catch (e) {}
  });
  if (global.document) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) flushQueue(); });
  }
  setInterval(() => { if (navigator.onLine && !document.hidden) flushQueue(); }, 30000);

})(typeof window !== 'undefined' ? window : globalThis);
