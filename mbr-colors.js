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
  // How far apart two colours must be (RGB distance) to read as different.
  const CLASH = 80;

  const cache = {};   // school_name -> { display, alt } | null

  function rgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function distance(a, b) {
    const x = rgb(a), y = rgb(b);
    if (!x || !y) return Infinity;
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
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

  window.MBRColors = { load, matchup, DEFAULT };
})();
