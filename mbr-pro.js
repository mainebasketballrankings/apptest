// mbr-pro.js — ScoreKeepers Pro: the subscription, the paywall, and the gates.
//
//   <script src="mbr-core.js?v=15"></script>
//   <script src="mbr-pro.js?v=1"></script>
//
// Adapted from the reader app's mbr-iap-bridge.js, which got through review.
// What carries over: RevenueCat through the Capacitor "Purchases" plugin,
// entitlement read from customerInfo on purchase/restore/boot, and a purchase
// sheet with the Guideline 3.1.2 disclosures (title, length, price, billing
// terms, Terms of Use and Privacy links, Restore). What's different:
//
//   • Separate RevenueCat app and key. Different bundle ID, different
//     App Store Connect record, separate product catalog: nothing is shared
//     with the reader app's Varsity subscription.
//   • Prices come from the store (priceString), not hard-coded copy, so the
//     sheet can't drift from what App Store Connect actually charges.
//   • Monthly and annual both shown when the offering has them.
//   • Entitlement is cached on the device, because coaches score in gyms with
//     no signal and Pro can't lock up mid-game.
//
// THE SPLIT (decided with Lucas, Aug + 2026-09-23): scoring is free, keeping
// things costs. Free: every sport, the Maine schedule, live scoring, the box
// score, and reports on Maine schedule games. Pro: reusing saved teams and
// rosters, and PDF/CSV reports on your own (non-schedule) games.
//
// App only. On the web there is no store to buy from, so nothing is gated.

(function (global) {
  'use strict';

  // ── Config (fill in from RevenueCat) ──────────────────────────────────────
  // RevenueCat → Project → Apps → the ScoreKeepers App Store app → API keys.
  // NOT the reader app's appl_ key: a wrong key configures fine and then
  // returns no offerings, which looks like "the paywall is empty".
  const RC_API_KEY_IOS = 'appl_REPLACE_WITH_SCOREKEEPERS_KEY';
  const ENTITLEMENT_ID = 'scorekeepers_pro';

  const EULA_URL    = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
  const PRIVACY_URL = 'https://www.mainebasketballrankings.com/privacy/';

  // Cached expiry, so an offline device still knows it's Pro.
  const CACHE_KEY = 'mbr_pro_until';
  // A renewal happens on Apple's side at period end; an offline phone can't
  // see it. Give an expired cache this long before locking, but only offline.
  const OFFLINE_GRACE_MS = 3 * 24 * 3600 * 1000;

  const cap      = () => global.Capacitor;
  const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
  const plugin   = () => cap() && cap().Plugins && cap().Plugins.Purchases;

  let _configured = false;
  let _lastError  = null;

  // ── Entitlement state ────────────────────────────────────────────────────
  function cacheGet() {
    try { return localStorage.getItem(CACHE_KEY) || ''; } catch (e) { return ''; }
  }
  function cacheSet(v) {
    try { v ? localStorage.setItem(CACHE_KEY, v) : localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  // Synchronous on purpose: the gates run inside click handlers.
  function isPro() {
    if (!isNative()) return true;                  // web: nothing to buy, nothing gated
    const v = cacheGet();
    if (!v) return false;
    if (v === 'lifetime') return true;
    const until = Date.parse(v);
    if (isNaN(until)) return false;
    if (until > Date.now()) return true;
    return !navigator.onLine && (Date.now() - until) < OFFLINE_GRACE_MS;
  }

  function applyCustomerInfo(info) {
    const ent = info && info.entitlements && info.entitlements.active
             && info.entitlements.active[ENTITLEMENT_ID];
    // A null expirationDate on an active entitlement means non-expiring.
    const v = ent ? (ent.expirationDate || 'lifetime') : '';
    cacheSet(v);
    paintStatus();
    return !!v;
  }

  // ── RevenueCat ───────────────────────────────────────────────────────────
  async function ensureConfigured() {
    if (_configured) return true;
    if (!isNative()) return false;
    const P = plugin();
    if (!P) { _lastError = 'Purchases plugin missing — npm install @revenuecat/purchases-capacitor'; return false; }
    if (/REPLACE/.test(RC_API_KEY_IOS)) { _lastError = 'RevenueCat key not set in mbr-pro.js'; return false; }
    try {
      // Anonymous RevenueCat user: the subscription belongs to the Apple ID
      // and moves between devices through Restore. Tying it to the Supabase
      // login would mean a second identity to reconcile, and Delete Account
      // would have to reach into RevenueCat too.
      await P.configure({ apiKey: RC_API_KEY_IOS });
      _configured = true;
      return true;
    } catch (e) {
      _lastError = 'configure failed: ' + errMsg(e);
      return false;
    }
  }

  async function packages() {
    if (!(await ensureConfigured())) return [];
    try {
      const r = await plugin().getOfferings();
      const cur = r && r.current;
      if (!cur) { _lastError = 'no current offering'; return []; }
      const list = [];
      if (cur.annual)  list.push(cur.annual);
      if (cur.monthly) list.push(cur.monthly);
      if (!list.length && Array.isArray(cur.availablePackages)) list.push(...cur.availablePackages);
      return list;
    } catch (e) {
      _lastError = 'getOfferings failed: ' + errMsg(e);
      return [];
    }
  }

  async function purchase(pkg) {
    if (!(await ensureConfigured())) return { ok: false, reason: 'not configured' };
    try {
      const r = await plugin().purchasePackage({ aPackage: pkg });
      return { ok: applyCustomerInfo(r && r.customerInfo) };
    } catch (e) {
      if (isCancel(e)) return { ok: false, reason: 'cancelled' };
      _lastError = 'purchase failed: ' + errMsg(e);
      return { ok: false, reason: 'error' };
    }
  }

  async function restore() {
    if (!(await ensureConfigured())) return { ok: false, reason: 'not configured' };
    try {
      const r = await plugin().restorePurchases();
      return { ok: applyCustomerInfo(r && r.customerInfo) };
    } catch (e) {
      _lastError = 'restore failed: ' + errMsg(e);
      return { ok: false, reason: 'error' };
    }
  }

  // Pick up renewals, cancellations and purchases on other devices.
  async function sync() {
    if (!navigator.onLine) return;
    if (!(await ensureConfigured())) return;
    try {
      const r = await plugin().getCustomerInfo();
      applyCustomerInfo(r && r.customerInfo);
    } catch (e) { _lastError = 'sync failed: ' + errMsg(e); }
  }

  const errMsg   = (e) => (e && e.message) ? e.message : String(e);
  // The plugin has reported cancels both ways across versions.
  const isCancel = (e) => !!(e && (e.userCancelled || e.code === '1' || e.code === 1));

  // ── Gates ────────────────────────────────────────────────────────────────
  // Returns true when allowed; otherwise shows the paywall and returns false.
  function require(reason) {
    if (isPro()) return true;
    sheet(reason);
    return false;
  }

  // Reports are free on Maine schedule games (owner_id null) and Pro on your
  // own games. The answer is cached per game so the CSV that follows the PDF
  // at the end of a game can check synchronously.
  const _reportOk = {};
  async function allowReport(gameId) {
    if (isPro() || !gameId) return true;
    if (gameId in _reportOk) {
      if (!_reportOk[gameId]) sheet('report');
      return _reportOk[gameId];
    }
    let own = false;
    try {
      const rows = await global.MBR.sbFetch(`games?id=eq.${gameId}&select=owner_id&limit=1`);
      own = !!(Array.isArray(rows) && rows[0] && rows[0].owner_id);
    } catch (e) {
      return true;   // can't tell (offline) — never hold a coach's report hostage
    }
    _reportOk[gameId] = !own;
    if (own) sheet('report');
    return !own;
  }
  function reportBlocked(gameId) { return !!gameId && _reportOk[gameId] === false; }

  // ── Paywall ──────────────────────────────────────────────────────────────
  const LEADS = {
    teams : 'Saved teams are part of ScoreKeepers Pro.',
    report: 'Reports for your own games are part of ScoreKeepers Pro.',
  };

  const periodLabel = (p) => {
    const t = (p && p.packageType) || '';
    const sp = (p && p.product && p.product.subscriptionPeriod) || '';
    if (t === 'ANNUAL' || sp === 'P1Y') return { unit: 'year', name: 'Annual' };
    if (t === 'MONTHLY' || sp === 'P1M') return { unit: 'month', name: 'Monthly' };
    return { unit: '', name: (p && p.product && p.product.title) || 'Subscription' };
  };

  async function sheet(reason) {
    if (!isNative()) return;
    injectCSS();
    if (document.getElementById('mbr-pro-sheet')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mbr-pro-sheet';
    wrap.className = 'mbrp-bg';
    wrap.innerHTML = `
      <div class="mbrp-box" role="dialog" aria-label="ScoreKeepers Pro">
        <h3>ScoreKeepers Pro</h3>
        ${LEADS[reason] ? `<p class="mbrp-lead">${LEADS[reason]}</p>` : ''}
        <ul class="mbrp-list">
          <li>Save your teams and rosters and load them into any game</li>
          <li>PDF and CSV reports for your own games</li>
        </ul>
        <p class="mbrp-free">Scoring is always free, and so are reports on Maine schedule games.</p>
        <div id="mbrpPkgs"><div class="mbrp-msg">Loading prices\u2026</div></div>
        <p class="mbrp-terms">Payment is charged to your Apple ID account at confirmation of
          purchase. The subscription renews automatically at the same price and length
          unless it is cancelled at least 24 hours before the end of the current period.
          Manage or cancel any time in your Apple ID account settings.</p>
        <div class="mbrp-msg" id="mbrpMsg"></div>
        <button class="mbrp-link" id="mbrpRestore">Restore purchases</button>
        <button class="mbrp-link" id="mbrpClose">Not now</button>
        <div class="mbrp-legal">
          <a href="#" id="mbrpTerms">Terms of Use</a><span>\u00b7</span>
          <a href="#" id="mbrpPrivacy">Privacy Policy</a>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const msg = wrap.querySelector('#mbrpMsg');
    const say = (t, bad) => { msg.textContent = t || ''; msg.className = 'mbrp-msg' + (bad ? ' bad' : ''); };
    const close = () => wrap.remove();

    wrap.querySelector('#mbrpClose').onclick = close;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('#mbrpTerms').onclick   = (e) => { e.preventDefault(); openExternal(EULA_URL); };
    wrap.querySelector('#mbrpPrivacy').onclick = (e) => { e.preventDefault(); openExternal(PRIVACY_URL); };

    wrap.querySelector('#mbrpRestore').onclick = async () => {
      say('Restoring\u2026');
      const r = await restore();
      if (r.ok) { close(); toast('Pro restored'); }
      else say(r.reason === 'error' || r.reason === 'not configured'
               ? 'Couldn\u2019t reach the App Store. Try again in a moment.'
               : 'No ScoreKeepers Pro subscription on this Apple ID.', true);
    };

    const pkgs = await packages();
    const slot = wrap.querySelector('#mbrpPkgs');
    if (!pkgs.length) {
      slot.innerHTML = `<div class="mbrp-msg bad">Subscriptions aren\u2019t available right now.
        Check your connection and try again.</div>`;
      return;
    }
    // Each button carries its own title, length and price — the three things
    // 3.1.2 wants visible before purchase.
    slot.innerHTML = pkgs.map((p, i) => {
      const L = periodLabel(p);
      const price = (p.product && p.product.priceString) || '';
      return `<button class="mbrp-buy${i ? ' alt' : ''}" data-i="${i}">
        <span class="mbrp-buy-t">${L.name}</span>
        <span class="mbrp-buy-p">${price}${L.unit ? ' / ' + L.unit : ''}</span></button>`;
    }).join('');
    slot.querySelectorAll('.mbrp-buy').forEach(b => b.onclick = async () => {
      say('Opening the App Store\u2026');
      const r = await purchase(pkgs[+b.dataset.i]);
      if (r.ok) { close(); toast('Pro unlocked'); }
      else if (r.reason === 'cancelled') say('');
      else say('Couldn\u2019t complete that purchase. Try again in a moment.', true);
    });
  }

  // Small status line for the home screen, if it has a slot for one.
  function paintStatus() {
    const el = document.getElementById('proStatus');
    if (!el) return;
    const sep = document.getElementById('proSep');
    if (!isNative()) { el.style.display = 'none'; if (sep) sep.style.display = 'none'; return; }
    el.textContent = isPro() ? 'Pro' : 'Get Pro';
    el.classList.toggle('on', isPro());
  }

  function openExternal(url) {
    try {
      const B = cap() && cap().Plugins && cap().Plugins.Browser;
      if (B && B.open) { B.open({ url }); return; }
    } catch (e) {}
    global.open(url, '_blank', 'noopener');
  }

  let toastEl = null;
  function toast(text) {
    injectCSS();
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'mbrp-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  const CSS = `
.mbrp-bg{position:fixed;inset:0;z-index:9998;background:rgba(15,17,23,.62);display:flex;
  align-items:center;justify-content:center;padding:18px;
  padding-top:calc(18px + env(safe-area-inset-top,0px));padding-bottom:calc(18px + env(safe-area-inset-bottom,0px));}
.mbrp-box{background:#fff;color:#111;border-radius:14px;padding:22px 18px 14px;max-width:360px;width:100%;
  max-height:100%;overflow-y:auto;font-family:'Barlow',-apple-system,sans-serif;text-align:center;}
.mbrp-box h3{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:800;margin:0 0 6px;}
.mbrp-lead{font-size:14px;color:#333;margin:0 0 10px;}
.mbrp-list{text-align:left;margin:0 0 10px;padding-left:20px;font-size:14px;line-height:1.45;color:#222;}
.mbrp-free{font-size:12px;color:#777;margin:0 0 12px;}
.mbrp-buy{width:100%;display:flex;justify-content:space-between;align-items:center;padding:13px 14px;
  border:none;border-radius:10px;background:#1a7a4a;color:#fff;cursor:pointer;margin-bottom:8px;
  font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;letter-spacing:.03em;}
.mbrp-buy.alt{background:#fff;color:#1a7a4a;box-shadow:inset 0 0 0 2px #1a7a4a;}
.mbrp-terms{font-size:11px;color:#888;line-height:1.45;margin:6px 0 4px;}
.mbrp-msg{min-height:18px;font-size:12px;color:#777;margin:6px 0 2px;}
.mbrp-msg.bad{color:#c0392b;}
.mbrp-link{width:100%;padding:10px;border:none;background:none;color:#666;font-size:13px;font-weight:600;cursor:pointer;}
.mbrp-legal{margin-top:6px;font-size:12px;color:#999;display:flex;gap:8px;justify-content:center;}
.mbrp-legal a{color:#1a7a4a;text-decoration:underline;}
.mbrp-toast{position:fixed;left:50%;transform:translateX(-50%) translateY(10px);
  bottom:calc(74px + env(safe-area-inset-bottom,0px));background:#111;color:#fff;font-size:13px;
  padding:10px 16px;border-radius:20px;opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;z-index:9999;}
.mbrp-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}`;
  function injectCSS() {
    if (document.getElementById('mbr-pro-css')) return;
    const s = document.createElement('style'); s.id = 'mbr-pro-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  global.MBRPro = {
    isPro, require, allowReport, reportBlocked, sheet, restore, sync, paintStatus,
    get lastError() { return _lastError; },
  };

  const boot = () => { paintStatus(); sync(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  try { document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); }); } catch (e) {}
})(window);
