/* ============================================================
   MBR SHARED NAV — nav.js
   Include before </body>:  <script src="nav.js"></script>

   Requires:
   - nav.css loaded in <head>
   - @supabase/supabase-js loaded before this script
   - A <div id="mbr-header"></div> where you want the header

   Per-page usage:
     MBRNav.init({ active: 'scoreboard' });

   Active options: 'scoreboard' | 'rankings' | 'heals' |
                   'goldballs' | 'tournament' | 'team'
   ============================================================ */

const MBRNav = (() => {

  const SUPABASE_URL = 'https://vtwupenqieesoktonbzg.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0d3VwZW5xaWVlc29rdG9uYnpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTA0MzgsImV4cCI6MjA4Nzk4NjQzOH0.OqkqF7NXr5LBQsQ0sl6S2o-kzQqbtBlRCLFszRnUoHA';

  // All nav links — matches Ghost site order exactly
  const NAV_LINKS = [
    { label: 'Scoreboard',       href: 'index.html',      key: 'scoreboard' },
    { label: 'Rankings',         href: 'rankings.html',   key: 'rankings'   },
    { label: 'Heal Points',      href: 'heals.html',      key: 'heals'      },
    { label: 'Gold Ball Odds',   href: '#',               key: 'goldballs'  },
    { label: 'Brackets',         href: 'https://docs.google.com/spreadsheets/d/1dIUqf9-aPeicGSCX2ms3olUDki8QVivnpiVXOZNI_wM/edit?gid=1894028799#gid=1894028799', key: 'brackets', external: true },
    { label: 'Player Stats',     href: 'tournament.html', key: 'tournament' },
    { label: 'Tourney Guide',    href: 'https://www.mainebasketballrankings.com/tourney-guide/', key: 'tourney', external: true },
    { label: 'Podcast',          href: 'https://www.youtube.com/watch?v=ZvFlsDrIB2w&list=PLLOJcFaMXfS9gMPVDb-mb5I6oFS0Kl94I', key: 'podcast', external: true },
    { label: 'Merch',            href: 'https://maine-basketball-rankings.printify.me/', key: 'merch', external: true },
  ];

  let sb = null;
  let _modalOpen = false;

  function getSB() {
    if (!sb) sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return sb;
  }

  function buildHeader(activeKey) {
    const navLinks = NAV_LINKS.map(link => {
      const isActive = link.key === activeKey ? 'active' : '';
      const target = link.external ? 'target="_blank" rel="noopener"' : '';
      return `<a href="${link.href}" class="${isActive}" ${target}>${link.label}</a>`;
    }).join('');

    const logoSrc = 'https://res.cloudinary.com/dulfssb6y/image/upload/v1774220002/ghost-banner-5_sykt26.png';

    return `
<header class="mbr-header" id="mbrHeader">
  <div class="mbr-topbar">
    <a class="mbr-logo" href="index.html">
      <img src="${logoSrc}" alt="Maine Basketball Rankings" />
      <span class="mbr-wordmark">Maine Basketball<br>Rankings</span>
    </a>
    <div class="mbr-auth" id="mbrAuthArea">
      <button class="mbr-btn mbr-btn-signin" id="mbrSignInBtn">Account</button>
    </div>
  </div>
  <nav class="mbr-nav">
    <div class="mbr-nav-inner">
      ${navLinks}
    </div>
  </nav>
</header>

<!-- Magic Link Modal (shared) -->
<div id="mbrModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:1000; align-items:center; justify-content:center;">
  <div style="background:#fff; border-radius:10px; padding:36px 32px; max-width:380px; width:90%; box-shadow:0 8px 40px rgba(0,0,0,0.18); position:relative;">
    <h2 style="font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Sign In</h2>
    <p style="font-size:14px; color:#666; margin-bottom:20px;">Enter your email and we'll send you a magic link.</p>
    <input type="email" id="mbrEmailInput" placeholder="you@example.com"
      style="width:100%; padding:10px 14px; border:1px solid #ddd; border-radius:6px; font-size:14px; margin-bottom:12px; font-family:'Barlow',sans-serif;" />
    <div id="mbrModalMsg" style="font-size:13px; color:#ee6730; margin-bottom:12px; min-height:18px;"></div>
    <button id="mbrSendBtn" class="mbr-btn mbr-btn-signin" style="width:100%; padding:10px;">Send Magic Link</button>
    <button id="mbrCancelBtn" style="width:100%; margin-top:10px; background:none; border:none; color:#999; font-size:13px; cursor:pointer; font-family:'Barlow',sans-serif;">Cancel</button>
  </div>
</div>
    `;
  }

  function openModal() {
    const modal = document.getElementById('mbrModal');
    modal.style.display = 'flex';
    document.getElementById('mbrEmailInput').value = '';
    document.getElementById('mbrModalMsg').textContent = '';
    _modalOpen = true;
  }

  function closeModal() {
    document.getElementById('mbrModal').style.display = 'none';
    _modalOpen = false;
  }

  function renderAuth(user, isPaid) {
    const area = document.getElementById('mbrAuthArea');
    if (!user) {
      area.innerHTML = `<button class="mbr-btn mbr-btn-signin" id="mbrSignInBtn">Account</button>`;
      document.getElementById('mbrSignInBtn').addEventListener('click', openModal);
    } else {
      const badge = isPaid
        ? `<span style="font-size:10px; background:#ee6730; color:#fff; padding:2px 6px; border-radius:3px; font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:0.5px; text-transform:uppercase;">PRO</span>`
        : '';
      area.innerHTML = `
        <div class="mbr-auth-user">${user.email}</div>
        ${badge}
        <button class="mbr-btn mbr-btn-signout" id="mbrSignOutBtn">Sign Out</button>
      `;
      document.getElementById('mbrSignOutBtn').addEventListener('click', async () => {
        await getSB().auth.signOut();
      });
    }
  }

  async function initAuth() {
    const client = getSB();

    // Handle magic link token in URL hash
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }

    const { data: { session } } = await client.auth.getSession();
    if (session?.user) {
      const { data } = await client.from('users').select('tier').eq('email', session.user.email).maybeSingle();
      const isPaid = data?.tier === 'paid';
      renderAuth(session.user, isPaid);
      // Expose for pages that need to gate content
      if (window.mbrAuthCallback) window.mbrAuthCallback(session.user, isPaid);
    } else {
      renderAuth(null, false);
      if (window.mbrAuthCallback) window.mbrAuthCallback(null, false);
    }

    client.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const { data } = await client.from('users').select('tier').eq('email', session.user.email).maybeSingle();
        const isPaid = data?.tier === 'paid';
        renderAuth(session.user, isPaid);
        if (window.mbrAuthCallback) window.mbrAuthCallback(session.user, isPaid);
      } else if (event === 'SIGNED_OUT') {
        renderAuth(null, false);
        if (window.mbrAuthCallback) window.mbrAuthCallback(null, false);
      }
    });
  }

  function wireModal() {
    document.getElementById('mbrCancelBtn').addEventListener('click', closeModal);
    document.getElementById('mbrModal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('mbrModal')) closeModal();
    });
    document.getElementById('mbrSendBtn').addEventListener('click', async () => {
      const email = document.getElementById('mbrEmailInput').value.trim();
      const msg = document.getElementById('mbrModalMsg');
      if (!email) { msg.style.color = '#c0392b'; msg.textContent = 'Please enter your email.'; return; }
      msg.style.color = '#555'; msg.textContent = 'Sending…';
      const redirectTo = window.location.href.split('#')[0];
      const { error } = await getSB().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      if (error) {
        msg.style.color = '#c0392b'; msg.textContent = 'Error: ' + error.message;
      } else {
        msg.style.color = '#ee6730'; msg.textContent = '✓ Check your email for the magic link!';
        document.getElementById('mbrSendBtn').disabled = true;
      }
    });
  }

  function init({ active = '' } = {}) {
    const mount = document.getElementById('mbr-header');
    if (!mount) {
      console.warn('MBRNav: add <div id="mbr-header"></div> to your page');
      return;
    }
    mount.innerHTML = buildHeader(active);
    wireModal();
    initAuth();
  }

  return { init, getSB };
})();
