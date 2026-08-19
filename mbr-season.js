/* mbr-season.js — single source of truth for MBR's season_year convention.
 *
 * season_year is the SCHOOL-YEAR-ENDING year, for every sport:
 *   Fall 2026 (Aug 2026)  -> 2027
 *   Winter    (Jan 2027)  -> 2027
 *   Spring    (May 2027)  -> 2027
 * Display is always "26-27", never "2027".
 *
 * The rollover is July 1. Anything from July onward belongs to the school year
 * that ends the following June.
 *
 * Load this in <head>, BEFORE any inline script that needs it.
 */
(function () {
  'use strict';

  // July. Fall practice/scrimmages start in August, so July is a safe, quiet
  // boundary — no sanctioned game has ever fallen on the wrong side of it.
  var ROLLOVER_MONTH = 7;

  function yearFor(d) {
    d = d || new Date();
    return (d.getMonth() + 1) >= ROLLOVER_MONTH ? d.getFullYear() + 1 : d.getFullYear();
  }

  function current() {
    return yearFor(new Date());
  }

  // 2027 -> "26-27"
  function label(y) {
    y = parseInt(y, 10);
    if (!y) return '';
    var end = String(y % 100).padStart(2, '0');
    var start = String((y - 1) % 100).padStart(2, '0');
    return start + '-' + end;
  }

  function currentLabel() {
    return label(current());
  }

  // Accepts 2027, "2027", "2026-27", "26-27" -> 2027
  function parse(val) {
    if (val === null || val === undefined || val === '') return null;
    var s = String(val).trim();
    var m = s.match(/(\d{2,4})[-\u2013](\d{2,4})/);
    if (m) {
      var end = m[2];
      return end.length === 2 ? 2000 + parseInt(end, 10) : parseInt(end, 10);
    }
    var n = parseInt(s, 10);
    return n || null;
  }

  // For VIEWING pages only. Lets ?season=2026 pull up a prior season.
  // Deliberately NOT used by anything that writes: a stray query param must
  // never be able to file a roster under the wrong year.
  function fromUrl(defaultYear) {
    var fallback = defaultYear || current();
    try {
      var q = new URLSearchParams(window.location.search);
      var raw = q.get('season_year') || q.get('season');
      var y = parse(raw);
      if (y && y >= 2000 && y <= 2100) return y;
    } catch (e) { /* no-op */ }
    return fallback;
  }

  window.MBR_SEASON = {
    current: current,
    yearFor: yearFor,
    label: label,
    currentLabel: currentLabel,
    parse: parse,
    fromUrl: fromUrl,
    ROLLOVER_MONTH: ROLLOVER_MONTH
  };
})();
