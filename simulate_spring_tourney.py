#!/usr/bin/env python3
"""
MBR Spring Sports Tournament Simulation
Sports: Baseball (Boys), Softball (Girls), Boys LAX, Girls LAX

Bracket structure:
- 16-slot single elimination bracket (same mental model as basketball)
- Field size = ceil(2/3 * teams_in_region) — teams with 0 games excluded
- Missing slots = automatic byes (top seeds get byes when field < 16)
- Standard bracket pairs: 1v16, 8v9, 4v13, 5v12, 2v15, 7v10, 3v14, 6v11
- Baseball/Softball: regions (e.g. "A North", "B South") — North winner vs South winner for gold ball
- LAX: class only, no regions — regional final IS the gold ball
- Neutral site: Regional Final and gold ball only (unlike basketball which goes neutral at quarters)

Win probability uses Bradley-Terry model with %Lead normalization:
  %Lead = dirigo / (max_dirigo_in_state * 1.1), floor 0.01
  p(A beats B) = (pctA * (1-pctB) * HCA) /
                 (pctA * (1-pctB) * HCA + (1-pctA) * pctB * (1-HCA))
  HCA = 0.53 (lower seed is home until neutral site)

Seeds derived from Heal Points rank within region at end of regular season.
Tournament results detected from games table (is_tournament=True, date >= TOURNEY_START_DATE).

Usage:
  python simulate_spring_tourney.py [--push] [--dry-run] [--sims 10000]
  python simulate_spring_tourney.py --sports Baseball --push
"""

import os
import math
import random
import argparse
from collections import defaultdict
from datetime import date
from tqdm import tqdm
from supabase import create_client

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL = "https://vtwupenqieesoktonbzg.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
SEASON_YEAR  = 2026
NUM_SIMS     = 10_000
HCA          = 0.53

# Tournament start dates — update each season
# Script will look for is_tournament=True games on or after this date
TOURNEY_START_DATES = {
    "Baseball": "2026-06-09",
    "Softball": "2026-06-09",
    "Boys LAX": "2026-06-09",
    "Girls LAX": "2026-06-09",
}

SPORTS = {
    "Baseball": {
        "sport_id": "c87a4d6c-a471-47e1-b6a0-d1643d942bf0",
        "gender":   "Boys",
        "grouping": "region",   # seeded within North/South regions
    },
    "Softball": {
        "sport_id": "095c9841-7261-4cb1-824e-6304792b53d0",
        "gender":   "Girls",
        "grouping": "region",
    },
    "Boys LAX": {
        "sport_id": "9c34ec5c-81b4-4e2e-9f60-740bb30fee4d",
        "gender":   "Boys",
        "grouping": "class",    # no regions — class bracket only, regional final = gold ball
    },
    "Girls LAX": {
        "sport_id": "9c34ec5c-81b4-4e2e-9f60-740bb30fee4d",
        "gender":   "Girls",
        "grouping": "class",
    },
}

# Standard 16-slot bracket pairs in order
# Grouped into 4 quarter-sections: [[1v16,8v9], [4v13,5v12], [2v15,7v10], [3v14,6v11]]
BRACKET_PAIRS = [
    (1, 16), (8, 9),
    (4, 13), (5, 12),
    (2, 15), (7, 10),
    (3, 14), (6, 11),
]

# ── Win probability ───────────────────────────────────────────────────────────
def make_pct_lead(dirigo_dict):
    """Normalize DIRIGO to %Lead scale (0.01–~0.91) within this pool."""
    if not dirigo_dict:
        return {}
    max_d = max(dirigo_dict.values()) * 1.1
    if max_d <= 0:
        return {t: 0.01 for t in dirigo_dict}
    return {t: max(d / max_d, 0.01) for t, d in dirigo_dict.items()}

def win_prob(pct_a, pct_b, home=False):
    """
    Bradley-Terry win probability.
    home=True means team A has home court advantage.
    """
    h = HCA if home else 0.5
    denom = pct_a * (1 - pct_b) * h + (1 - pct_a) * pct_b * (1 - h)
    if denom == 0:
        return 0.5
    return (pct_a * (1 - pct_b) * h) / denom

# ── Bracket simulation (single run, one region) ───────────────────────────────
def simulate_bracket(seeds, pct_lead, locked_results, neutral_from_round):
    """
    Simulate one bracket from current state.

    Args:
        seeds: dict {seed_num (1-16): team_id} — only seeds in the tournament
        pct_lead: dict {team_id: float} — normalized DIRIGO
        locked_results: dict {(team_a_id, team_b_id): winner_id} — completed games
        neutral_from_round: int — 1=play-in, 2=quarters, 3=semis, 4=regional
                            Spring = 4 (only regional final and beyond are neutral)

    Returns:
        round_reached: dict {team_id: {"play_in","quarters","semis","regional"} → bool}
        regional_winner: team_id
    """
    slots = {s: seeds.get(s) for s in range(1, 17)}
    round_reached = defaultdict(lambda: {
        "play_in": False, "quarters": False,
        "semis": False, "regional": False
    })

    def play_game(team_a, team_b, round_num):
        if team_a is None:
            return team_b
        if team_b is None:
            return team_a

        key1, key2 = (team_a, team_b), (team_b, team_a)
        if key1 in locked_results:
            return locked_results[key1]
        if key2 in locked_results:
            return locked_results[key2]

        neutral = (round_num >= neutral_from_round)
        seed_a = next((s for s, t in seeds.items() if t == team_a), 99)
        seed_b = next((s for s, t in seeds.items() if t == team_b), 99)
        home_adv = (not neutral) and (seed_a < seed_b)

        p = win_prob(
            pct_lead.get(team_a, 0.01),
            pct_lead.get(team_b, 0.01),
            home=home_adv
        )
        return team_a if random.random() < p else team_b

    # Every column = WON that round and advanced.
    # play_in:  won play-in game
    # quarters: won quarterfinal
    # semis:    won semifinal
    # regional: won regional final (advanced to gold ball)
    # gold_ball: won gold ball (handled in run_simulation)

    # Round 1: play-in → winners advance to quarters
    quarter_seeds = []
    for seed_a, seed_b in BRACKET_PAIRS:
        winner = play_game(slots[seed_a], slots[seed_b], round_num=1)
        quarter_seeds.append(winner)
        if winner:
            round_reached[winner]["play_in"] = True

    # Quarterfinals → winners advance to semis
    semi_seeds = []
    for i in range(0, 8, 2):
        winner = play_game(quarter_seeds[i], quarter_seeds[i+1], round_num=2)
        semi_seeds.append(winner)
        if winner:
            round_reached[winner]["quarters"] = True

    # Semifinals → winners advance to regional final
    regional_seeds = []
    for i in range(0, 4, 2):
        winner = play_game(semi_seeds[i], semi_seeds[i+1], round_num=3)
        regional_seeds.append(winner)
        if winner:
            round_reached[winner]["semis"] = True

    # Regional final → winner advances to gold ball
    regional_winner = play_game(regional_seeds[0], regional_seeds[1], round_num=4)
    if regional_winner:
        round_reached[regional_winner]["regional"] = True

    return round_reached, regional_winner

# ── Load data from Supabase ───────────────────────────────────────────────────
# Win point values by class (matches heals.html)
WIN_PTS = {"A": 40, "B": 38, "C": 36, "D": 34, "S": 32}

def calculate_heal_points(all_teams, reg_games):
    """
    Replicate heals.html Heal Points calculation from raw games.
    PI  = sum(win_pts) / max(scheduled_games, 12)  [0 wins → 1.0]
    Heal = sum(beaten_opp_PI + 0.5*tied_opp_PI) / max(scheduled, 12) * 10
    Uses regular season games only (is_tournament=False).
    """
    # Index games by team
    games_by_team = defaultdict(list)
    sched_count   = defaultdict(int)
    seen = set()
    for g in reg_games:
        if g["id"] in seen:
            continue
        seen.add(g["id"])
        games_by_team[g["home_team_id"]].append(g)
        games_by_team[g["away_team_id"]].append(g)
        sched_count[g["home_team_id"]] += 1
        sched_count[g["away_team_id"]] += 1

    def get_denom(tid):
        return max(sched_count.get(tid, 0), 12)

    def get_class(tid):
        t = all_teams.get(tid)
        return t["team_class"] if t else "A"

    # Step 1: PI for every team
    pi_map = {}
    def calc_pi(tid):
        if tid in pi_map:
            return pi_map[tid]
        sum_win_pts = 0
        wins = 0
        for g in games_by_team.get(tid, []):
            if g["status"] != "final":
                continue
            is_home  = g["home_team_id"] == tid
            my_score = g["home_score"] if is_home else g["away_score"]
            op_score = g["away_score"] if is_home else g["home_score"]
            if my_score is None or op_score is None:
                continue
            opp_id   = g["away_team_id"] if is_home else g["home_team_id"]
            opp_cls  = get_class(opp_id)
            pts      = WIN_PTS.get(opp_cls, 36)
            if my_score > op_score:
                wins += 1
                sum_win_pts += pts
            elif my_score == op_score:
                sum_win_pts += pts / 2
        denom = get_denom(tid)
        pi_map[tid] = 1.0 if (wins == 0 and sum_win_pts == 0) else sum_win_pts / denom
        return pi_map[tid]

    for tid in all_teams:
        calc_pi(tid)

    # Step 2: Heal Points per team
    heal_map = {}
    dirigo_map = {}
    for tid in all_teams:
        sum_opp_pi = 0
        for g in games_by_team.get(tid, []):
            if g["status"] != "final":
                continue
            is_home  = g["home_team_id"] == tid
            my_score = g["home_score"] if is_home else g["away_score"]
            op_score = g["away_score"] if is_home else g["home_score"]
            if my_score is None or op_score is None:
                continue
            opp_id  = g["away_team_id"] if is_home else g["home_team_id"]
            opp_pi  = calc_pi(opp_id)
            if my_score > op_score:
                sum_opp_pi += opp_pi
            elif my_score == op_score:
                sum_opp_pi += opp_pi / 2
        denom = get_denom(tid)
        heal_map[tid] = (sum_opp_pi / denom) * 10

    return heal_map, pi_map


def load_data(sb, sport_name, cfg):
    sport_id = cfg["sport_id"]
    gender   = cfg["gender"]
    tourney_start = TOURNEY_START_DATES[sport_name]

    print(f"  Loading teams...")
    # team_class and team_region live directly on the teams table for spring sports
    teams_resp = sb.table("teams").select(
        "id,school_name,gender,team_class,team_region"
    ).eq("sport_id", sport_id).eq("gender", gender).eq("active", True).execute()
    all_teams = {t["id"]: t for t in teams_resp.data}

    # Also load ALL teams in sport (both genders) for PI calculation cross-class
    all_sport_teams_resp = sb.table("teams").select(
        "id,school_name,team_class,team_region"
    ).eq("sport_id", sport_id).eq("active", True).execute()
    all_sport_teams = {t["id"]: t for t in all_sport_teams_resp.data}

    print(f"  Loading regular season games...")
    # Fetch final regular season games only (both genders for cross-class PI)
    reg_resp = sb.table("games").select(
        "id,home_team_id,away_team_id,home_score,away_score,status"
    ).eq("sport_id", sport_id).eq("season_year", SEASON_YEAR).eq(
        "is_tournament", False
    ).eq("status", "final").lt("game_date", tourney_start).execute()
    reg_games = reg_resp.data

    # For Heal Points: only count games where BOTH teams are same-gender
    # (LAX shares sport_id between Boys/Girls — must not mix)
    gender_team_ids = set(all_teams.keys())
    gender_games = [g for g in reg_games
                    if g["home_team_id"] in gender_team_ids
                    or g["away_team_id"] in gender_team_ids]

    print(f"  Calculating Heal Points from games...")
    heal_map, pi_map = calculate_heal_points(all_sport_teams, gender_games)

    active_teams = set()
    for g in gender_games:
        if g["status"] == "final":
            active_teams.add(g["home_team_id"])
            active_teams.add(g["away_team_id"])

    print(f"  Loading snapshots (for DIRIGO)...")
    snap_resp = sb.table("rankings_snapshots").select(
        "team_id,snapshot_date,dirigo"
    ).eq("season_year", SEASON_YEAR).lt(
        "snapshot_date", tourney_start
    ).order("snapshot_date", desc=True).execute()

    latest_snap = {}
    for row in snap_resp.data:
        tid = row["team_id"]
        if tid not in latest_snap and tid in all_teams:
            latest_snap[tid] = row

    print(f"  Loading tournament games...")
    tourney_resp = sb.table("games").select(
        "id,home_team_id,away_team_id,home_score,away_score,status"
    ).eq("sport_id", sport_id).eq("season_year", SEASON_YEAR).eq(
        "is_tournament", True
    ).gte("game_date", tourney_start).execute()
    tourney_games = tourney_resp.data

    print(f"  Teams: {len(all_teams)}, Active (played games): {len(active_teams & set(all_teams.keys()))}")
    print(f"  Tournament games: {len(tourney_games)}")

    return all_teams, heal_map, latest_snap, tourney_games, active_teams

# ── Build brackets ────────────────────────────────────────────────────────────
def build_brackets(all_teams, heal_map, latest_snap, tourney_games, active_teams, cfg):
    grouping = cfg["grouping"]

    # Build locked results from completed tourney games
    locked_results = {}
    eliminated = set()
    for g in tourney_games:
        if g["status"] != "final":
            continue
        if g["home_score"] is None or g["away_score"] is None:
            continue
        home, away = g["home_team_id"], g["away_team_id"]
        if g["home_score"] > g["away_score"]:
            winner, loser = home, away
        else:
            winner, loser = away, home
        locked_results[(home, away)] = winner
        eliminated.add(loser)

    # Group teams by bracket key using team_class/team_region on teams table
    # Baseball/Softball: (class, region) e.g. ("A", "North")
    # LAX: (class, "") — single bracket per class
    groups = defaultdict(list)

    for team_id, team in all_teams.items():
        if team_id not in active_teams:
            continue  # skip teams with no games played

        class_name  = team.get("team_class")
        region_name = team.get("team_region") or ""

        if not class_name or class_name not in ("A", "B", "C", "D", "S"):
            continue

        if grouping == "class":
            bracket_key = (class_name, "")
        else:
            if not region_name:
                continue  # baseball/softball requires a region
            bracket_key = (class_name, region_name)

        dirigo = latest_snap.get(team_id, {}).get("dirigo") or 1.0
        groups[bracket_key].append({
            "team_id":     team_id,
            "heal_points": heal_map.get(team_id, 0),
            "dirigo":      dirigo,
        })

    # Build brackets: determine field size, assign seeds
    brackets = {}
    for bracket_key, teams in groups.items():
        n_total = len(teams)
        if n_total < 2:
            continue

        # Field size = ceil(2/3 * total teams)
        field_size = math.ceil(2 / 3 * n_total)
        field_size = max(field_size, 2)

        # Sort by Heal Points descending → seed order
        sorted_teams = sorted(teams, key=lambda x: x["heal_points"], reverse=True)

        # Only top field_size teams make it
        field = sorted_teams[:field_size]

        # Assign seeds 1..field_size, fill 16-slot bracket
        # Seeds beyond field_size are empty (bye slots)
        seeds = {}
        dirigo = {}
        seed_num = {}   # team_id -> seed number
        seed_status = {}  # team_id -> "bye" | "in"
        for i, t in enumerate(field, start=1):
            seeds[i] = t["team_id"]
            dirigo[t["team_id"]] = t["dirigo"]
            seed_num[t["team_id"]] = i

        # Determine BYE vs IN for each seed using standard bracket pairs
        # BYE = paired opponent slot is empty
        pair_map = dict(BRACKET_PAIRS)  # seed_a -> seed_b
        pair_map.update({v: k for k, v in BRACKET_PAIRS})  # seed_b -> seed_a
        for seed, team_id in seeds.items():
            opponent_seed = pair_map.get(seed)
            if opponent_seed and seeds.get(opponent_seed):
                seed_status[team_id] = "in"
            else:
                seed_status[team_id] = "bye"

        class_name, region_name = bracket_key
        print(f"    {class_name} {region_name}: {n_total} teams total, "
              f"{field_size} in field, "
              f"{sum(1 for tid in seeds.values() if tid in eliminated)} eliminated")

        brackets[bracket_key] = {
            "seeds":          seeds,
            "dirigo":         dirigo,
            "seed_num":       seed_num,
            "seed_status":    seed_status,
            "locked_results": locked_results,
            "eliminated":     eliminated,
        }

    return brackets

# ── Run simulation ────────────────────────────────────────────────────────────
def run_simulation(brackets, cfg, num_sims):
    grouping = cfg["grouping"]

    # For spring: neutral starts at regional final (round 4)
    NEUTRAL_FROM_ROUND = 4

    # Determine which classes have 2 regions (baseball/softball)
    # LAX always has 1 "region" (the class itself)
    class_regions = defaultdict(set)
    for (class_name, region_name) in brackets:
        class_regions[class_name].add(region_name)

    # Compute pct_lead globally across ALL teams in the sport.
    # Matches Excel: %Lead = dirigo / (MAX(all teams in sport) * 1.1)
    # Must NOT normalize per-bracket — that inflates weaker brackets.
    all_dirigo = {}
    for b in brackets.values():
        all_dirigo.update(b["dirigo"])
    global_pct_lead = make_pct_lead(all_dirigo)
    bracket_pct_lead = {k: global_pct_lead for k in brackets}

    # Accumulators
    counts = defaultdict(lambda: defaultdict(int))

    print(f"\n  Running {num_sims:,} simulations...")
    for _ in tqdm(range(num_sims)):
        regional_winners = defaultdict(dict)  # class_name → {region_name: winner_id}

        for bracket_key, b in brackets.items():
            class_name, region_name = bracket_key
            pct_lead = bracket_pct_lead[bracket_key]

            round_reached, regional_winner = simulate_bracket(
                b["seeds"], pct_lead, b["locked_results"],
                neutral_from_round=NEUTRAL_FROM_ROUND
            )

            for team_id, rounds in round_reached.items():
                for round_name, reached in rounds.items():
                    if reached:
                        counts[team_id][round_name] += 1

            if regional_winner:
                regional_winners[class_name][region_name] = regional_winner

        # Gold ball
        for class_name, region_winners in regional_winners.items():
            regions = list(region_winners.keys())
            if len(regions) == 1:
                # LAX or single-region class: regional final = gold ball
                winner = region_winners[regions[0]]
                if winner:
                    counts[winner]["gold_ball"] += 1
            elif len(regions) == 2:
                team_a = region_winners[regions[0]]
                team_b = region_winners[regions[1]]
                if team_a and team_b:
                    p = win_prob(
                        global_pct_lead.get(team_a, 0.01),
                        global_pct_lead.get(team_b, 0.01),
                        home=False  # neutral
                    )
                    winner = team_a if random.random() < p else team_b
                    if winner:
                        counts[winner]["gold_ball"] += 1

    # Build seed and status lookup from brackets
    team_seed = {}
    team_status = {}
    for b in brackets.values():
        team_seed.update(b.get("seed_num", {}))
        team_status.update(b.get("seed_status", {}))

    # Convert to probabilities
    odds = {}
    for team_id, round_counts in counts.items():
        odds[team_id] = {
            "seed":     team_seed.get(team_id, 99),
            "status":   team_status.get(team_id, "out"),
            "play_in":  round(round_counts["play_in"]  / num_sims, 4),
            "quarters": round(round_counts["quarters"] / num_sims, 4),
            "semis":    round(round_counts["semis"]    / num_sims, 4),
            "regional": round(round_counts["regional"] / num_sims, 4),
            "gold_ball":round(round_counts["gold_ball"]/ num_sims, 4),
        }

    return odds

# ── Push to Supabase ──────────────────────────────────────────────────────────
def push_to_supabase(sb, odds, all_teams):
    print(f"  Pushing odds for {len(odds)} teams...")
    pushed = 0
    skipped = 0

    # Build set of team_ids that have odds (made the field)
    field_team_ids = set(odds.keys())

    # For teams not in the field, write a zeroed-out entry with seed=99
    # so the frontend sort works correctly
    empty_odds = {
        "seed": 99, "status": "out", "play_in": 0, "quarters": 0,
        "semis": 0, "regional": 0, "gold_ball": 0
    }
    all_odds = {tid: odds.get(tid, empty_odds) for tid in all_teams}

    for team_id, team_odds in all_odds.items():
        snap = sb.table("rankings_snapshots").select("id").eq(
            "team_id", team_id
        ).eq("season_year", SEASON_YEAR).order(
            "snapshot_date", desc=True
        ).limit(1).execute()

        if not snap.data:
            skipped += 1
            continue

        sb.table("rankings_snapshots").update({
            "tournament_odds": team_odds
        }).eq("id", snap.data[0]["id"]).execute()
        pushed += 1

    print(f"  ✓ Pushed: {pushed}  Skipped (no snapshot): {skipped}")

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="MBR Spring Tournament Simulator")
    parser.add_argument("--sims",    type=int, default=NUM_SIMS)
    parser.add_argument("--push",    action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sports",  nargs="+",
                        default=["Baseball","Softball","Boys LAX","Girls LAX"],
                        choices=list(SPORTS.keys()))
    parser.add_argument("--debug-bracket", type=str, default=None,
                        help='Show bracket internals, e.g. "D South" or "A North"')
    args = parser.parse_args()

    if not SUPABASE_KEY:
        print("ERROR: SUPABASE_KEY not set in environment")
        return

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    for sport_name in args.sports:
        cfg = SPORTS[sport_name]
        print(f"\n{'='*60}")
        print(f"  {sport_name}")
        print(f"{'='*60}")

        all_teams, heal_map, latest_snap, tourney_games, active_teams = load_data(sb, sport_name, cfg)
        active_teams = active_teams & set(all_teams.keys())

        print(f"\n  Building brackets...")
        brackets = build_brackets(
            all_teams, heal_map, latest_snap, tourney_games, active_teams, cfg
        )

        if not brackets:
            print(f"  No brackets found for {sport_name} — check TOURNEY_START_DATES")
            continue

        # Build global pct_lead (same logic as run_simulation)
        all_dirigo = {}
        for b in brackets.values():
            all_dirigo.update(b["dirigo"])
        global_pct_lead = make_pct_lead(all_dirigo)
        id_to_name = {tid: t["school_name"] for tid, t in all_teams.items()}

        # Debug a specific bracket if requested
        if args.debug_bracket:
            parts = args.debug_bracket.split()
            debug_class = parts[0] if parts else ""
            debug_region = parts[1] if len(parts) > 1 else ""
            debug_key = (debug_class, debug_region)
            b = brackets.get(debug_key)
            if not b:
                print(f"  Bracket '{args.debug_bracket}' not found. Available:")
                for k in sorted(brackets.keys()):
                    print(f"    {k[0]} {k[1]}")
            else:
                max_d = max(all_dirigo.values()) * 1.1
                print(f"\n  ── Bracket: {debug_class} {debug_region} ──────────────────")
                print(f"  Global max DIRIGO * 1.1 = {max_d:.2f}")
                seeds = b["seeds"]

                # Run 50k sims of just this bracket to get per-round odds
                from collections import defaultdict as _dd
                debug_counts = _dd(lambda: _dd(int))
                DEBUG_SIMS = 50000
                for _ in range(DEBUG_SIMS):
                    rr, rw = simulate_bracket(
                        seeds, global_pct_lead, b["locked_results"],
                        neutral_from_round=4
                    )
                    for tid, rounds in rr.items():
                        for rnd, reached in rounds.items():
                            if reached:
                                debug_counts[tid][rnd] += 1

                print(f"\n  {'Seed':>4}  {'Team':<25} {'DIRIGO':>8} {'%Lead':>7}  {'Play-In':>8}  {'Quarters':>9}  {'Semis':>7}  {'Regional':>9}")
                print(f"  {'----':>4}  {'-'*25} {'------':>8} {'-----':>7}  {'-------':>8}  {'-'*9}  {'-----':>7}  {'-'*9}")
                for s, tid in sorted(seeds.items()):
                    name = id_to_name.get(tid, tid[:8])
                    dirigo_val = b["dirigo"].get(tid, 0)
                    pct = global_pct_lead.get(tid, 0.01)
                    dc = debug_counts[tid]
                    print(f"  {s:>4}  {name:<25} {dirigo_val:>8.2f} {pct*100:>6.1f}%"
                          f"  {dc['play_in']/DEBUG_SIMS*100:>7.1f}%"
                          f"  {dc['quarters']/DEBUG_SIMS*100:>8.1f}%"
                          f"  {dc['semis']/DEBUG_SIMS*100:>6.1f}%"
                          f"  {dc['regional']/DEBUG_SIMS*100:>8.1f}%")
            continue  # skip sim when debugging

        odds = run_simulation(brackets, cfg, args.sims)

        sorted_odds = sorted(odds.items(),
                             key=lambda x: x[1].get("gold_ball", 0), reverse=True)
        print(f"\n  {'Team':<25} {'Play-In':>8} {'Quarters':>9} "
              f"{'Semis':>7} {'Regional':>9} {'Gold Ball':>10}")
        print(f"  {'-'*25} {'-'*8} {'-'*9} {'-'*7} {'-'*9} {'-'*10}")
        for team_id, o in sorted_odds[:20]:
            name = id_to_name.get(team_id, team_id[:8])
            print(f"  {name:<25} {o['play_in']*100:>7.1f}% "
                  f"{o['quarters']*100:>8.1f}% {o['semis']*100:>6.1f}% "
                  f"{o['regional']*100:>8.1f}% {o['gold_ball']*100:>9.1f}%")

        if args.push and not args.dry_run:
            push_to_supabase(sb, odds, all_teams)
        else:
            print(f"\n  (dry run — use --push to write to Supabase)")

    print("\n=== Done ===")

if __name__ == "__main__":
    main()