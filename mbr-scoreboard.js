/* ============================================================================
 * mbr-scoreboard.js — shared live-scoreboard rendering for football + field sports
 *
 * Loaded by BOTH scoreboard surfaces:
 *   index.html  → app.mainebasketballrankings.com  (the GitHub Pages app)
 *   embed.html  → mainebasketballrankings.com       (Ghost iframe surface)
 *
 * WHY THIS EXISTS
 * These two files each carried their own copy of the football/field description
 * logic, and they drifted — as of tonight, index showed the tackler's jersey
 * number and embed didn't, from the SAME edit written twice. Every football fix
 * had to be applied by hand in both places, and forgetting one is how a
 * scoreboard silently goes wrong on game night. This file is the one copy.
 *
 * SCOPE — deliberately narrow.
 * Only football + the field sports (soccer / field hockey / lacrosse) live here,
 * because those are the branches that drift. Baseball and basketball stay inline
 * in each file: they're stable, and they depend on file-local lookup tables
 * (EVT_LABEL, BBALL_LABEL) that aren't worth dragging across a file boundary.
 *
 * CONTRACT
 * Each page keeps its own describeEvent()/renderScoreBug(). At the TOP of each,
 * it asks this module first; if the module handles the sport it returns a
 * string (or fills the score bug) and the page returns early. Otherwise the
 * page falls through to its existing baseball/basketball code. If this file
 * fails to load, the page's own inline fallback still covers football/field —
 * so a missing shared file degrades, it doesn't break.
 *
 * Depends on the page providing fmtClock(sec) and periodLabel(period), which
 * both index.html and embed.html already define.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var FIELD_SPORTS = ['soccer', 'field_hockey', 'lacrosse'];

  function parseNotes(e) {
    try {
      return e.notes ? (typeof e.notes === 'string' ? JSON.parse(e.notes) : e.notes) : {};
    } catch (_) { return {}; }
  }

  // ── DESCRIPTION ───────────────────────────────────────────────────────────
  // Returns an HTML string for football events, or null if this module doesn't
  // own the sport (so the caller falls through to its own baseball/basketball).
  function describe(e, sport) {
    if (sport !== 'football') return null;    // field sports have no per-play feed yet

    var n = parseNotes(e);
    var nm = e.player_name || '';
    var g = n.gain;
    var yd = function (v) { return v + ' yard' + (Math.abs(v) === 1 ? '' : 's'); };
    var dd = n.dd ? ' <span style="opacity:.6">— ' + n.dd + '</span>' : '';
    var B = function (s) { return '<strong>' + s + '</strong>'; };
    // tackler, WITH jersey number when we have it — this is the bit that drifted
    var tk = n.tackler
      ? ' (' + (n.tacklerNum ? '#' + n.tacklerNum + ' ' : '') + n.tackler +
        (n.assist ? ', ' + n.assist : '') + ')'
      : '';
    var conv = function (good, kind) {
      return '<span style="color:' + (good ? 'var(--green)' : 'var(--red)') +
        ';font-weight:700">(' + kind + ' ' + (good ? 'GOOD' : 'NO GOOD') + ')</span>';
    };
    var TD = function (s) { return '<span style="color:var(--green);font-weight:700">TD!</span> — ' + s; };

    switch (e.event_type) {
      case 'touchdown':
        return TD(n.scoring || B(nm));
      // A conversion is the tail of the touchdown, not its own play — show the
      // TD it settled, with the result inline, so a TD never reads "6" forever.
      case 'extra_point':
        return n.scoring ? TD(n.scoring + ' ' + conv(n.good, 'PAT'))
                         : 'Extra point ' + (n.good ? 'good' : 'no good') + (nm ? ' — ' + nm : '');
      case 'two_point':
        return n.scoring ? TD(n.scoring + ' ' + conv(n.good, '2-pt'))
                         : '2-pt conversion ' + (n.good ? 'good' : 'failed') + (nm ? ' — ' + nm : '');
      case 'run':
        if (n.fumbleLost) return B(nm) + ' rushes for ' + yd(g || 0) + ', <span style="color:var(--red);font-weight:700">FUMBLE</span>';
        return B(nm) + ' rushes for ' + yd(g || 0) + tk + dd;
      case 'pass_comp':
        return B(nm) + ' ' + yd(g || 0) + ' pass to ' + (n.receiver || '') + tk + dd;
      case 'pass_incomp':
        return B(nm) + ' pass incomplete' + dd;
      case 'sack': {
        // nm is the DEFENDER who made the sack; n.qb is the quarterback.
        var qbName = n.qb || 'QB';
        var by = nm ? ' by ' + B(nm) + (n.with ? ' & ' + n.with : '') : '';
        var lossTxt = (n.loss != null) ? ' for ' + yd(-Math.abs(n.loss)) : (g != null ? ' for ' + yd(g) : '');
        return qbName + ' sacked' + by + lossTxt + dd;
      }
      case 'interception':
        return '<span style="color:var(--red);font-weight:700">INTERCEPTED</span> by ' + B(nm);
      case 'field_goal':
        return B(nm) + ' field goal ' + (n.good ? 'GOOD' : 'no good');
      case 'punt':      return B(nm) + ' punts' + dd;
      case 'kickoff':   return 'Kickoff' + (nm ? ' — ' + nm : '');
      case 'kick_return_td': return TD(B(nm) + ' return');
      case 'penalty': {
        // Name the penalty (scorer sends it as n.name), keep the red flag, no player.
        var pen = n.name || n.type || 'Penalty';
        var on  = n.on ? ' on ' + n.on : '';
        var auto = n.autoFirst ? ', automatic first' : '';
        return '<span style="color:var(--red);font-weight:700">Flag</span> — ' + pen + on +
               (n.yds ? ', ' + n.yds + ' yd' + (Math.abs(n.yds)===1?'':'s') : '') + auto + dd;
      }
      case 'timeout':   return 'Timeout' + (nm ? ' — ' + nm : '');
      case 'game_over': return 'Final';
      default:
        return nm ? B(nm) + ' — ' + String(e.event_type).replace(/_/g, ' ')
                  : String(e.event_type).replace(/_/g, ' ');
    }
  }

  // ── SCORE BUG (top-left of the card) ──────────────────────────────────────
  // Fills topLeftEl for football/field and returns true; returns false if this
  // module doesn't own the sport, so the caller renders baseball/basketball.
  // fmtClock + periodLabel come from the host page.
  function scoreBug(topLeftEl, se, sport, helpers) {
    helpers = helpers || {};
    var fmtClock = helpers.fmtClock || global.fmtClock || function () { return ''; };
    var periodLabel = helpers.periodLabel || global.periodLabel || function (p) { return 'Q' + (p || 1); };
    var n = parseNotes(se);

    if (sport === 'football') {
      var clk = n.clock || fmtClock(se.clock_seconds) || '';
      var qtr = n.qtr || ('Q' + (se.period || 1));
      var d = n.dd || '';
      var spot = n.spot || '';
      topLeftEl.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';
      topLeftEl.innerHTML =
        '<span style="font-weight:700">' + qtr + '</span>' + (clk ? '<span>' + clk + '</span>' : '') +
        (d ? '<span style="opacity:.75">' + d + '</span>' : '') +
        (spot ? '<span style="opacity:.55">' + spot + '</span>' : '');
      return true;
    }
    if (FIELD_SPORTS.indexOf(sport) !== -1) {
      var c = n.clock || fmtClock(se.clock_seconds) || '';
      var per = n.period || periodLabel(se.period);
      topLeftEl.style.cssText = 'display:flex;align-items:center;gap:6px';
      topLeftEl.innerHTML = '<span style="font-weight:700">' + per + '</span>' + (c ? '<span>' + c + '</span>' : '');
      return true;
    }
    return false;
  }

  // Is the meta-prefix (quarter/period) redundant for this sport? It already
  // sits in the score bug for football/field, so the feed line shouldn't repeat it.
  function suppressPrefix(sport) {
    return sport === 'football' || FIELD_SPORTS.indexOf(sport) !== -1;
  }

  global.MBRScoreboard = {
    describe: describe,
    scoreBug: scoreBug,
    suppressPrefix: suppressPrefix,
    FIELD_SPORTS: FIELD_SPORTS
  };
})(window);
