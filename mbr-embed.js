/* ============================================================================
 * mbr-embed.js — shared harness for every *_embed.html iframe surface
 * Served from GitHub Pages; loaded by the embeds on mainebasketballrankings.com
 * (the Ghost site) inside their iframes.
 *
 * WHY THIS EXISTS
 * Every embed used to hand-roll the same two things — the parent-resize
 * postMessage loop and the Supabase URL/key constants. They drifted: some
 * used `const`, some `var`; some debounced clicks at 100ms, some 150ms; the
 * anon key was copy-pasted into ten files. Drift like that is invisible until
 * one embed behaves differently from its siblings. This file is the single
 * source of truth for all of it.
 *
 * DESIGN NOTES
 * - No hard dependency: an embed that loads this gets the shared behavior, but
 *   each embed also keeps a tiny inline fallback (see the snippet the HTML
 *   files carry) so a failed load of THIS file never blanks the page. That
 *   removes the "one file breaks all ten" risk of a shared dependency.
 * - This file does NOT create the Supabase client. storageKey differs per page
 *   (that's the GoTrueClient-deadlock fix — each iframe needs its own key), and
 *   three embeds use raw REST with no client at all. So the client stays in the
 *   page; this file only hands it the URL + key so those aren't copied around.
 * ==========================================================================*/
(function (global) {
  'use strict';

  // ── Config: the ONE place these constants live ────────────────────────────
  var CONFIG = {
    SUPABASE_URL: 'https://vtwupenqieesoktonbzg.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0d3VwZW5xaWVlc29rdG9uYnpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTA0MzgsImV4cCI6MjA4Nzk4NjQzOH0.OqkqF7NXr5LBQsQ0sl6S2o-kzQqbtBlRCLFszRnUoHA',
    // R2 buckets — team logos and site/streamer images (Cloudinary is deprecated)
    R2_LOGOS:   'https://pub-c29fa4b169e04191805575af7679d5f9.r2.dev',
    R2_SITE:    'https://pub-607e71f4996b41a88bb949335554456d.r2.dev'
  };

  // ── Sport UUIDs — canonical, so no embed hand-copies its own drifting map ──
  var SPORT_IDS = {
    basketball:    'b31ab283-b28e-4ba8-9684-b1cf30cea219',
    baseball:      'c87a4d6c-a471-47e1-b6a0-d1643d942bf0',
    softball:      '095c9841-7261-4cb1-824e-6304792b53d0',
    lacrosse:      '9c34ec5c-81b4-4e2e-9f60-740bb30fee4d',
    soccer:        'ff80a695-0e78-4432-98f2-141b2b571e0e',
    field_hockey:  '1054869a-20d4-465f-8ca9-4bc4d2bafe1b',
    football:      'fa905ca5-f416-409b-81ac-777179ee5576',
    volleyball:    'e26b0fcc-0000-0000-0000-000000000000'
  };

  // ── Auto-resize: tell the parent page how tall this embed is ──────────────
  // documentElement.scrollHeight (not body) — body can under-report in an iframe
  // and leave the frame clipped. This is the behavior all ten had converged on.
  function initResize(opts) {
    opts = opts || {};
    var debounceMs = opts.debounceMs != null ? opts.debounceMs : 120;
    var lastH = -1;

    function height() { return document.documentElement.scrollHeight; }

    function send() {
      var h = height();
      // Skip no-op posts; a resize storm otherwise floods the parent.
      if (h === lastH) return;
      lastH = h;
      window.parent.postMessage({ type: 'mbr-embed-resize', height: h }, '*');
    }

    // send on load, on any DOM size change, and after clicks (tabs change height)
    window.addEventListener('load', send);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(send).observe(document.body);
    } else {
      // very old browsers: poll instead of observe
      setInterval(send, 500);
    }
    document.addEventListener('click', function () { setTimeout(send, debounceMs); });

    // let a page force a re-measure after an async render
    return send;
  }

  // ── Supabase client factory ───────────────────────────────────────────────
  // Each embed passes its OWN storageKey. Two iframes sharing a key deadlock
  // GoTrueClient, so this never defaults the key — it throws if you forget,
  // which is a loud failure at dev time instead of a silent hang in production.
  function makeClient(storageKey, supabaseGlobal) {
    var lib = supabaseGlobal || global.supabase;
    if (!lib || !lib.createClient) {
      throw new Error('[mbr-embed] supabase-js not loaded before makeClient()');
    }
    if (!storageKey) {
      throw new Error('[mbr-embed] makeClient requires a unique storageKey per embed');
    }
    return lib.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
      auth: { storageKey: storageKey, persistSession: false, autoRefreshToken: false }
    });
  }

  // Cloudinary → R2 rewrite for any logo URL that slipped through un-migrated.
  function normalizeLogoUrl(url) {
    if (!url) return '';
    if (url.indexOf('res.cloudinary.com') !== -1) {
      var m = url.match(/\/([^\/]+)\.(png|jpg|jpeg|webp|svg)(\?|$)/i);
      if (m) return CONFIG.R2_LOGOS + '/' + m[1] + '.' + m[2];
    }
    return url;
  }

  global.MBREmbed = {
    config: CONFIG,
    SPORT_IDS: SPORT_IDS,
    initResize: initResize,
    makeClient: makeClient,
    normalizeLogoUrl: normalizeLogoUrl
  };
})(window);
