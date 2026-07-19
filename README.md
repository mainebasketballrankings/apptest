# Scorer tests

Automated checks for the Maine Basketball Rankings scorers. They catch the kind of
bug that only shows up mid-game — a penalty that doesn't wipe the play, a fumble
into the end zone scored as the wrong thing, overtime handing the ball to the
wrong team.

## Running them

From this folder, once:

    npm install

Then any time you change a scorer:

    node run-all.js

You get one line per area. Green check = fine, red X = something broke, and the
line tells you which check failed. That's the whole workflow — you don't need to
read the test code.

## Layout

Put this `tests/` folder next to the scorers:

    football_scorer.html
    field_scorer.html
    mbr-core.js
    tests/

The tests find the scorers by looking one folder up.

## What's covered

**Football** (18 suites) — penalties, fumbles including all four end-zone
outcomes, overtime, onside kicks, kickoffs out of bounds, timeouts, two-point
conversions, sacks and passing yards, the gain buttons, team stats, the PDF
report, unscheduled game creation, and the field-position math.

**Field** (1 suite) — soccer, field hockey and lacrosse: setup, rosters,
goalkeepers, period lengths, and each sport's rules config.

## Adding to them

Each file is plain Node. Copy the closest existing one, change the checks. The
pattern is always: start a game, do some plays, assert the state is right.
