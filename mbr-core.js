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
   worker may serve a stale copy.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const SB_URL = 'https://vtwupenqieesoktonbzg.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0d3VwZW5xaWVlc29rdG9uYnpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTA0MzgsImV4cCI6MjA4Nzk4NjQzOH0.OqkqF7NXr5LBQsQ0sl6S2o-kzQqbtBlRCLFszRnUoHA';

  const cfg = {
    queueKey  : 'mbr_push_queue',
    isTestMode: () => false,
    gameId    : () => null,
    isFinalized: () => false,
    makePDF   : null,
    sportId   : null,                      // this scorer's sport uuid
    // season_year rule. Default: the calendar year of the game date. Basketball
    // is the only sport that crosses New Year's, so it overrides this.
    seasonYearFor: (iso) => new Date(iso + 'T12:00:00').getFullYear(),
    trackingLevel: 'full_stats',           // NB: constraint rejects 'full'
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

  function sessionLoad() {
    try {
      const s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      if (!s || !s.access_token) return null;
      // treat as expired a minute early, so a request never dies mid-flight
      if (s.expires_at && (s.expires_at * 1000) < Date.now() + 60000) return s;  // stale: refresh below
      return s;
    } catch (e) { return null; }
  }
  function sessionSave(s) {
    try { s ? localStorage.setItem(AUTH_KEY, JSON.stringify(s)) : localStorage.removeItem(AUTH_KEY); } catch (e) {}
  }
  function isExpired(s) { return !!(s && s.expires_at && (s.expires_at * 1000) < Date.now() + 60000); }

  // Capture the token Supabase appends to the URL after Google sends the user
  // back, then scrub it from the address bar so it is not left lying around.
  function captureRedirect() {
    if (!global.location || !location.hash || location.hash.indexOf('access_token=') === -1) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    const s = {
      access_token : p.get('access_token'),
      refresh_token: p.get('refresh_token'),
      expires_at   : parseInt(p.get('expires_at') || '0', 10) || (Math.floor(Date.now()/1000) + 3600),
    };
    if (!s.access_token) return false;
    sessionSave(s);
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
  function authUrl(returnTo) {
    const back = returnTo || (global.location ? location.href.split('#')[0] : '');
    return `${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`;
  }
  function signInWithGoogle(returnTo) { location.href = authUrl(returnTo); }
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
      _me = { id: u.id, email: u.email,
              name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || u.email };
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

  function queueLoad() {
    try { return JSON.parse(localStorage.getItem(cfg.queueKey) || '[]'); } catch (e) { return []; }
  }
  function queueSave(q) {
    try { localStorage.setItem(cfg.queueKey, JSON.stringify(q)); } catch (e) {}
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

  // ── Small shared utility ─────────────────────────────────────────────────
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ── Wire up + publish ────────────────────────────────────────────────────
  function init(options) {
    Object.assign(cfg, options || {});
    try { setQueueStatus(); } catch (e) {}
    return MBR;
  }

  const MBR = {
    SB_URL, SB_KEY, init, cfg,
    sbFetch, sbInsert, sbPatch, evtStamp,
    startClockSync, stopClockSync,
    queueLoad, queueSave, flushQueue, setQueueStatus, isPermanentReject,
    loadSchools, schoolIds, createGame, resolveTeamId, createTeam, resolveOrCreateTeamId,
    listMyTeams, saveTeamRoster,
    signInWithGoogle, authUrl, signOut, isSignedIn, currentUser, currentUserId, ensureSession,
    autoUploadGameReport, emailGameReport,
    clamp,
    get droppedRows() { return _droppedRows; },
  };

  // Publish under the same bare names the scorers already use, so this first
  // step is a move rather than a rewrite. New code should prefer MBR.*.
  global.MBR = MBR;
  ['sbFetch','sbInsert','evtStamp','queueLoad','queueSave','flushQueue','setQueueStatus',
   'isPermanentReject','loadSchools','autoUploadGameReport','emailGameReport','clamp',
   'createGame','resolveTeamId','sbPatch','startClockSync','stopClockSync']
    .forEach(n => { global[n] = MBR[n]; });
  global.SB_URL = SB_URL;
  global.SB_KEY = SB_KEY;
  global._schools = null;
  global._schoolIds = {};

  // Drain triggers — safe to attach before the sport file configures us.
  global.addEventListener('online', () => flushQueue());
  if (global.document) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) flushQueue(); });
  }
  setInterval(() => { if (navigator.onLine && !document.hidden) flushQueue(); }, 30000);

})(typeof window !== 'undefined' ? window : globalThis);
