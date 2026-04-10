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
    { label: 'Spreads',          href: 'spreads.html',    key: 'spreads'    },
    { label: 'Player Stats',     href: 'tournament.html', key: 'tournament' },
    { label: 'Tourney Guide',    href: 'https://www.mainebasketballrankings.com/tourney-guide/', key: 'tourney', external: true },
    { label: 'Podcast',          href: 'https://www.youtube.com/watch?v=ZvFlsDrIB2w&list=PLLOJcFaMXfS9gMPVDb-mb5I6oFS0Kl94I', key: 'podcast', external: true },
    { label: 'Merch',            href: 'https://maine-basketball-rankings.printify.me/', key: 'merch', external: true },
    { label: 'Newsletter', href: 'https://www.mainebasketballrankings.com/#/portal', key: 'newsletter', external: true },
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
    <a class="mbr-logo" href="https://www.mainebasketballrankings.com/" target="_blank" rel="noopener">
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

<!-- Sign In Modal -->
<div id="mbrModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:1000; align-items:center; justify-content:center;">
  <div style="background:#fff; border-radius:10px; padding:36px 32px; max-width:380px; width:90%; box-shadow:0 8px 40px rgba(0,0,0,0.18); position:relative;">
    <h2 style="font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Sign In</h2>

    <!-- Step 1: Email -->
    <div id="mbrStep1">
      <p style="font-size:14px; color:#666; margin-bottom:20px;">Enter your email and we'll send you a 6-digit code.</p>
      <input type="email" id="mbrEmailInput" placeholder="you@example.com" autocomplete="email"
        style="width:100%; padding:10px 14px; border:1px solid #ddd; border-radius:6px; font-size:16px; margin-bottom:12px; font-family:'Barlow',sans-serif; box-sizing:border-box;" />
      <div id="mbrModalMsg" style="font-size:13px; color:#ee6730; margin-bottom:12px; min-height:18px;"></div>
      <button id="mbrSendBtn" class="mbr-btn mbr-btn-signin" style="width:100%; padding:10px;">Send Code</button>
      <button id="mbrCancelBtn" style="width:100%; margin-top:10px; background:none; border:none; color:#999; font-size:13px; cursor:pointer; font-family:'Barlow',sans-serif;">Cancel</button>
    </div>

    <!-- Step 2: OTP code -->
    <div id="mbrStep2" style="display:none;">
      <p style="font-size:14px; color:#666; margin-bottom:6px;">We sent a 6-digit code to:</p>
      <p id="mbrEmailConfirm" style="font-size:14px; font-weight:600; color:#333; margin-bottom:20px;"></p>
      <input type="text" id="mbrOtpInput" placeholder="123456" maxlength="6" autocomplete="one-time-code" inputmode="numeric"
        style="width:100%; padding:14px; border:1px solid #ddd; border-radius:6px; font-size:28px; letter-spacing:8px; text-align:center; margin-bottom:12px; font-family:'Barlow Condensed',sans-serif; box-sizing:border-box;" />
      <div id="mbrOtpMsg" style="font-size:13px; color:#ee6730; margin-bottom:12px; min-height:18px;"></div>
      <button id="mbrVerifyBtn" class="mbr-btn mbr-btn-signin" style="width:100%; padding:10px;">Sign In</button>
      <button id="mbrBackBtn" style="width:100%; margin-top:10px; background:none; border:none; color:#999; font-size:13px; cursor:pointer; font-family:'Barlow',sans-serif;">← Use a different email</button>
    </div>
  </div>
</div>
    `;
  }

  function openModal() {
    const modal = document.getElementById('mbrModal');
    modal.style.display = 'flex';
    document.getElementById('mbrEmailInput').value = '';
    document.getElementById('mbrModalMsg').textContent = '';
    document.getElementById('mbrOtpInput').value = '';
    document.getElementById('mbrOtpMsg').textContent = '';
    document.getElementById('mbrStep1').style.display = '';
    document.getElementById('mbrStep2').style.display = 'none';
    document.getElementById('mbrSendBtn').disabled = false;
    _modalOpen = true;
    setTimeout(() => document.getElementById('mbrEmailInput').focus(), 100);
  }

  function closeModal() {
    document.getElementById('mbrModal').style.display = 'none';
    _modalOpen = false;
  }

  function showStep2(email) {
    document.getElementById('mbrEmailConfirm').textContent = email;
    document.getElementById('mbrStep1').style.display = 'none';
    document.getElementById('mbrStep2').style.display = '';
    setTimeout(() => document.getElementById('mbrOtpInput').focus(), 100);
  }

  function renderAuth(user, isPaid) {
    const area = document.getElementById('mbrAuthArea');
    // Update drawer auth slot if present
    const drawerAuth = document.getElementById('mbr-drawer-auth');

    if (!user) {
      area.innerHTML = `<button class="mbr-btn mbr-btn-signin" id="mbrSignInBtn">Account</button>`;
      document.getElementById('mbrSignInBtn').addEventListener('click', openModal);
      if (drawerAuth) drawerAuth.innerHTML = `<button onclick="document.getElementById('mbrSignInBtn')?.click()||MBRNav._openModal()" style="background:#111;color:#fff;border:none;border-radius:4px;padding:8px 16px;font-family:'Barlow',sans-serif;font-weight:600;font-size:13px;cursor:pointer;width:100%;">Sign In</button>`;
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
      if (drawerAuth) drawerAuth.innerHTML = `
        <div style="font-size:12px;color:#666;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user.email}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${isPaid ? `<span style="font-size:10px;background:#ee6730;color:#fff;padding:2px 6px;border-radius:3px;font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">PRO</span>` : ''}
          <button id="mbrDrawerSignOut" style="background:transparent;border:1px solid #ddd;color:#777;border-radius:4px;padding:4px 10px;font-family:'Barlow',sans-serif;font-size:12px;cursor:pointer;">Sign Out</button>
        </div>`;
      document.getElementById('mbrDrawerSignOut')?.addEventListener('click', async () => {
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

    // Step 1: Send OTP
    document.getElementById('mbrSendBtn').addEventListener('click', async () => {
      const email = document.getElementById('mbrEmailInput').value.trim();
      const msg = document.getElementById('mbrModalMsg');
      if (!email) { msg.style.color = '#c0392b'; msg.textContent = 'Please enter your email.'; return; }
      msg.style.color = '#555'; msg.textContent = 'Sending…';
      document.getElementById('mbrSendBtn').disabled = true;
      const { error } = await getSB().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) {
        msg.style.color = '#c0392b'; msg.textContent = 'Error: ' + error.message;
        document.getElementById('mbrSendBtn').disabled = false;
      } else {
        showStep2(email);
      }
    });

    // Enter key on email input
    document.getElementById('mbrEmailInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('mbrSendBtn').click();
    });

    // Step 2: Verify OTP
    document.getElementById('mbrVerifyBtn').addEventListener('click', async () => {
      const email = document.getElementById('mbrEmailInput').value.trim();
      const token = document.getElementById('mbrOtpInput').value.trim();
      const msg = document.getElementById('mbrOtpMsg');
      if (token.length !== 6) { msg.style.color = '#c0392b'; msg.textContent = 'Enter the 6-digit code from your email.'; return; }
      msg.style.color = '#555'; msg.textContent = 'Verifying…';
      document.getElementById('mbrVerifyBtn').disabled = true;
      const { error } = await getSB().auth.verifyOtp({ email, token, type: 'email' });
      if (error) {
        msg.style.color = '#c0392b'; msg.textContent = 'Invalid or expired code. Try again.';
        document.getElementById('mbrVerifyBtn').disabled = false;
        document.getElementById('mbrOtpInput').value = '';
      } else {
        msg.style.color = '#ee6730'; msg.textContent = '✓ Signed in!';
        setTimeout(() => closeModal(), 800);
      }
    });

    // Enter key on OTP input
    document.getElementById('mbrOtpInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('mbrVerifyBtn').click();
    });

    // Back button
    document.getElementById('mbrBackBtn').addEventListener('click', () => {
      document.getElementById('mbrStep1').style.display = '';
      document.getElementById('mbrStep2').style.display = 'none';
      document.getElementById('mbrSendBtn').disabled = false;
      document.getElementById('mbrModalMsg').textContent = '';
    });
  }

  function wireBurger(activeKey) {
    const topbar = document.querySelector('.mbr-topbar');
    if (!topbar) return;

    // Burger button
    const burger = document.createElement('button');
    burger.id = 'mbr-burger';
    burger.innerHTML = '&#9776;';
    burger.setAttribute('aria-label', 'Menu');
    burger.style.cssText = 'display:none;background:none;border:none;font-size:22px;cursor:pointer;color:#333;padding:4px 8px;margin-left:8px;line-height:1;';
    topbar.appendChild(burger);

    // Drawer
    const drawerLinks = NAV_LINKS.map(link => {
      const isActive = link.key === activeKey ? ' class="active"' : '';
      const target = link.external ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${link.href}"${isActive}${target}>${link.label}</a>`;
    }).join('');

    const drawer = document.createElement('div');
    drawer.id = 'mbr-drawer';
    drawer.style.cssText = 'display:none;position:fixed;inset:0;z-index:500;';
    drawer.innerHTML = `
      <div id="mbr-drawer-bg" style="position:absolute;inset:0;background:rgba(0,0,0,0.4);"></div>
      <div id="mbr-drawer-panel" style="position:absolute;top:0;right:0;width:240px;height:100%;background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,0.15);display:flex;flex-direction:column;padding-top:16px;overflow-y:auto;">
        <div id="mbr-drawer-auth" style="padding:16px 24px 12px;border-bottom:2px solid #f0f0f0;font-family:'Barlow',sans-serif;font-size:13px;color:#999;">Not signed in</div>
        ${drawerLinks}
      </div>`;
    document.body.appendChild(drawer);

    // Drawer link styles
    const style = document.createElement('style');
    style.textContent = `
      #mbr-drawer.open { display: block !important; }
      #mbr-drawer-panel a { font-family: 'Barlow', sans-serif; font-weight: 600; font-size: 16px; color: #222; text-decoration: none; padding: 15px 24px; border-bottom: 1px solid #f0f0f0; display: block; }
      #mbr-drawer-panel a.active { color: #ee6730; }
      #mbr-drawer-panel a:hover { background: #f8f8f8; }
      @media (max-width: 700px) {
        #mbr-burger { display: block !important; }
        .mbr-nav { display: none !important; }
        .mbr-auth-user { display: none !important; }
      }
    `;
    document.head.appendChild(style);

    burger.addEventListener('click', () => drawer.classList.toggle('open'));
    drawer.querySelector('#mbr-drawer-bg').addEventListener('click', () => drawer.classList.remove('open'));
  }

  function init({ active = '' } = {}) {
    const mount = document.getElementById('mbr-header');
    if (!mount) {
      console.warn('MBRNav: add <div id="mbr-header"></div> to your page');
      return;
    }
    mount.innerHTML = buildHeader(active);
    wireModal();
    wireBurger(active);
    initAuth();
  }

  return { init, getSB };
})();
