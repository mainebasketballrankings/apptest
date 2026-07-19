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
    makePDF   : null,
  };

  const hdr = (extra) => Object.assign(
    { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    extra || {}
  );

  // ── Supabase read ────────────────────────────────────────────────────────
  async function sbFetch(path) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: hdr() });
    return r.json();
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
  async function loadSchools() {
    if (_schools) return _schools;
    try {
      const rows = await sbFetch('teams?select=id,school_name&order=school_name.asc&limit=2000');
      const byName = {};
      (rows || []).forEach(r => { if (r.school_name) { (byName[r.school_name] = byName[r.school_name] || []).push(r.id); } });
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
    sbFetch, sbInsert, evtStamp,
    queueLoad, queueSave, flushQueue, setQueueStatus, isPermanentReject,
    loadSchools, schoolIds,
    autoUploadGameReport, emailGameReport,
    clamp,
    get droppedRows() { return _droppedRows; },
  };

  // Publish under the same bare names the scorers already use, so this first
  // step is a move rather than a rewrite. New code should prefer MBR.*.
  global.MBR = MBR;
  ['sbFetch','sbInsert','evtStamp','queueLoad','queueSave','flushQueue','setQueueStatus',
   'isPermanentReject','loadSchools','autoUploadGameReport','emailGameReport','clamp']
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
