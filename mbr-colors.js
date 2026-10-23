/* mbr-colors.js — school colours for any page or app view.
 *
 * Colours live in Supabase's `schools` table (one row per school, keyed by the
 * exact teams.school_name). The table works out:
 *   display_color — the darkest colour that isn't white or black (the one that
 *                   represents the school on a page)
 *   alt_color     — the next colour, or white
 *
 * Usage:
 *   const pal = await MBRColors.matchup(homeName, awayName);
 *   pal.home.fill / pal.home.text / pal.home.stroke   (stroke is null unless
 *   pal.away.fill / pal.away.text / pal.away.stroke    the team is drawn white)
 *
 * Same-colour rule: when the two schools' display colours are too close to tell
 * apart (Cony vs Camden Hills — both red and white), the HOME team switches to
 * its alt colour. If that alt is white, home is drawn white with a stroke in
 * its display colour, and its text uses the display colour so it stays legible.
 * A light alt (cream, gold) gets the same stroke-and-text treatment.
 */
(function () {
  const SB_URL = 'https://vtwupenqieesoktonbzg.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0d3VwZW5xaWVlc29rdG9uYnpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTA0MzgsImV4cCI6MjA4Nzk4NjQzOH0.OqkqF7NXr5LBQsQ0sl6S2o-kzQqbtBlRCLFszRnUoHA';

  // Used when a school has no row (out-of-state opponents, a new school).
  const DEFAULT = { away: '#2563a8', home: '#c17f24' };
  // How far apart two colours must be to read as different, measured as
  // CIEDE2000 (how different they look to a person, not how far apart the RGB
  // numbers are). Red vs orange (Cony / Gardiner) is ~14, navy vs black ~24,
  // maroon vs navy ~36. Under 25 the home team switches colours.
  const CLASH = 25;

  const cache = {};   // school_name -> { display, alt } | null

  function rgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function lab(h) {
    const c = rgb(h).map(v => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; });
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    const X = f((c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047);
    const Y = f(c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722);
    const Z = f((c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  // CIEDE2000 colour difference
  function distance(a, b) {
    if (!rgb(a) || !rgb(b)) return Infinity;
    const [L1, a1, b1] = lab(a), [L2, a2, b2] = lab(b);
    const rad = Math.PI / 180, deg = 180 / Math.PI, p7 = x => Math.pow(x, 7);
    const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
    const G = 0.5 * (1 - Math.sqrt(p7(Cb) / (p7(Cb) + p7(25))));
    const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
    const C1 = Math.hypot(a1p, b1), C2 = Math.hypot(a2p, b2);
    const h1 = (Math.atan2(b1, a1p) * deg + 360) % 360, h2 = (Math.atan2(b2, a2p) * deg + 360) % 360;
    let dh = 0;
    if (C1 * C2) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 > h1 ? h2 - h1 - 360 : h2 - h1 + 360;
    const dL = L2 - L1, dC = C2 - C1, dH = 2 * Math.sqrt(C1 * C2) * Math.sin(dh / 2 * rad);
    const Lb = (L1 + L2) / 2, Cbp = (C1 + C2) / 2;
    let hb = h1 + h2;
    if (C1 * C2) hb = Math.abs(h1 - h2) <= 180 ? hb / 2 : hb < 360 ? (hb + 360) / 2 : (hb - 360) / 2;
    const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad)
              + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.20 * Math.cos((4 * hb - 63) * rad);
    const RC = 2 * Math.sqrt(p7(Cbp) / (p7(Cbp) + p7(25)));
    const RT = -Math.sin(2 * 30 * Math.exp(-Math.pow((hb - 275) / 25, 2)) * rad) * RC;
    const SL = 1 + 0.015 * Math.pow(Lb - 50, 2) / Math.sqrt(20 + Math.pow(Lb - 50, 2));
    const SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
    const x = dL / SL, y = dC / SC, z = dH / SH;
    return Math.sqrt(x * x + y * y + z * z + RT * y * z);
  }
  function isWhiteish(h) {
    const c = rgb(h);
    return !!c && Math.min(...c) >= 230;
  }
  // Too light to read as text on white (cream, gold, pale yellow) — such a
  // colour is drawn with a stroke and its text uses the school's main colour.
  function isLight(h) {
    const c = rgb(h);
    return !!c && (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 170;
  }

  async function load(names) {
    const need = [...new Set(names.filter(n => n && !(n in cache)))];
    if (need.length) {
      const list = need.map(n => '"' + String(n).replace(/"/g, '\\"') + '"').join(',');
      try {
        const r = await fetch(`${SB_URL}/rest/v1/schools?select=school_name,display_color,alt_color` +
          `&school_name=in.(${encodeURIComponent(list)})`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
        const rows = r.ok ? await r.json() : [];
        need.forEach(n => { cache[n] = null; });
        (rows || []).forEach(s => { cache[s.school_name] = { display: s.display_color, alt: s.alt_color }; });
      } catch (e) {
        console.warn('[MBRColors] lookup failed', e);
      }
    }
    const out = {};
    names.forEach(n => { out[n] = cache[n] || null; });
    return out;
  }

  function side(fill, stroke) {
    return { fill, stroke: stroke || null, text: stroke || fill };
  }

  async function matchup(homeName, awayName) {
    const m = await load([homeName, awayName]);
    const h = m[homeName], a = m[awayName];
    const away = side(a?.display || DEFAULT.away);
    let homeFill = h?.display || DEFAULT.home;
    let home = side(homeFill);

    if (distance(homeFill, away.fill) < CLASH) {
      const alt = h?.alt;
      if (alt && !isWhiteish(alt) && distance(alt, away.fill) >= CLASH) {
        home = isLight(alt) ? side(alt, homeFill) : side(alt);
      } else {
        home = side('#FFFFFF', homeFill);      // white with a stroke of the real colour
      }
    }
    return { home, away };
  }

  window.MBRColors = { load, matchup, distance, DEFAULT };
})();
