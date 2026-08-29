# Ideas and backlog

Things worth building, parked deliberately rather than forgotten. Each entry
records enough context to pick it up cold: what it is, why it is wanted, what
was already worked out, and what is still open.

Delete an entry when it ships or when it is decided against.

## At a glance

| Priority | Item |
| -------- | ---- |
| High | Undo the current turn |
| High | Show what an opponent is holding |
| Medium | Opponent seats stretch when there are few of them *(bug)* |
| Medium | Rate the human player |
| Medium | A stronger opponent above Sage |
| Medium | An in-app rules reference |
| Medium | Revisit the multi-round match |
| Low | Survive a page refresh |
| Low | Animate cards moving |
| Low | Explain the final score |
| Low | Tighten the error bars on the CPU ratings |
| Low | Position setup and analysis mode |

Keep this table in step with the Status lines below when priorities change.

**No settings surface exists yet.** "Explain the final score" is to be
toggleable, and "Animate cards moving" plausibly wants a toggle too. Whichever
is built first should create one place for preferences rather than scattering
switches into the top bar, which already carries the speed control.

---

## Rate the human player

**Status:** wanted, not started. **Priority: medium.** Raised 2026-08-29;
deferred deliberately, not blocked on anything.

**What:** track the player's own results across rounds and give them a rating on
the same scale as the AI roster, so "am I getting better?" has an answer.

**Why:** the opponents already carry measured ratings, so the player has a
strength ladder to be placed against but no place on it.

### Already worked out

Nothing exists yet: the app has no persistence at all (no `localStorage`, no
match history). Every round is standalone.

The precision question was answered, so do not re-derive it. The AI ladder is
the empirical noise floor: about 103 games per agent produced bootstrap error
bars of +/-26 to +/-48 Elo, mean about +/-35. Error falls as 1/sqrt(games):

| games | precision |
| ----- | --------- |
| 10    | +/-110    |
| 20    | +/-79     |
| 30    | +/-65     |
| 50    | +/-50     |
| 100   | +/-36     |
| 200   | +/-25     |

Against the gaps that actually need resolving - Pip to Dot is 303 Elo, Dot to
Nel 278, Nel to Vin 88, Vin to Sage 89 - that gives:

- about 20 games to place someone confidently in a strength band
- about 50 games for a number worth quoting
- about 100 games to match the precision of the AI ratings themselves
- separating yourself *within* the Strong/Expert tier is not realistically
  achievable, because those tiers are only about 90 Elo apart and the ladder
  could not separate Rook from Ada either

A six-player round yields five pairwise results, not one, which is why these
counts are lower than chess intuition suggests.

### Design sketch

- Persist round results to `localStorage`.
- Fit the player's rating against the AI ratings as **fixed anchors**, rather
  than refitting everyone jointly. Far more stable, and the anchors are already
  measured.
- Show progress honestly: "12 games in, +/-95, provisional".
- Show a **band** rather than a number until the error bar is tight enough to
  justify one, matching how the setup screen already leads with strength rather
  than Elo.

### Named local profiles

Several people share one browser, and they must not pollute each other's
rating. Keep it as light as possible: **a name, and nothing else.** No
passwords, no accounts.

- Pick or create a profile on the setup screen; the chosen name becomes the
  seat name for player 0. `names[0]` is already data rather than the constant
  `'You'`, so the table needs no change to display it.
- Each profile owns its own rating and its own game history.
- Handle the dull cases: renaming, deleting, and two profiles given the same
  name. A name is an identifier here, so either forbid duplicates or key on a
  generated id and treat the name as a label. The second is less annoying.
- Make the active profile visible on the table, so a game is never
  accidentally recorded against the wrong person.

### History screen

A detailed view, separate from the game itself:

- **Every past game**: date, who was at the table and how strong they were,
  your score, where you finished, and your rating before and after with the
  change.
- **Rating over time**, as a line. Plot the uncertainty band alongside the
  point estimate rather than the point alone - a rating that moved 40 points
  while carrying a +/-90 error bar has not really moved, and a bare line would
  imply it had.
- Mark where a rating stopped being provisional.

**Store raw results, not computed ratings.** Persist the finished games -
opponents, scores, seats, date - and derive the whole rating curve by replaying
the fit whenever it is displayed. Storing the rating after each game is simpler
but goes stale: re-measuring the roster moves the anchors, and then the stored
history disagrees with the current number and neither can be trusted.
Recomputing from raw results keeps the curve coherent, and makes the anchors
question below a non-issue for history even if it still matters for the
headline rating.

### Open questions

- Does a rating reset when the roster is re-measured, or carry over? Re-running
  the ladder moves the anchors.
- Only count games against a varied mix of opponents? Twenty wins over Pip say
  almost nothing, and a naive fit would happily produce a confident wrong number.
- Anything to show when a player deliberately farms a weak table?

### Caveat to keep in view

This is a single-round, high-luck game. A rating here will always be noisier
than in a low-variance game, and no amount of bookkeeping fixes that. Whatever
gets built should be honest about that rather than projecting false precision.

---

## Tighten the error bars on the CPU ratings

**Status:** wanted, not started. **Priority: low.** Raised 2026-08-29. Pairs
with "Rate the human player": that feature fits the player against these
ratings as fixed anchors, so the anchors want to be firm first. Note the
priority mismatch - the dependent feature is medium while this is low, so
either accept looser anchors for a first version of it, or promote this when
that work starts.

**What:** get the roster's Elo error bars well below their current +/-26 to
+/-48, so adjacent tiers are actually separable.

**Why:** at 120 games the four searching tiers sit within about 90 Elo of each
other with error bars near 30. Rook and Ada differ by 4 Elo, which is noise.
The roster currently collapses them into shared strength bands for exactly this
reason. Firmer numbers would either justify separating them or prove they
should be merged outright.

### What it would take

Error falls as 1/sqrt(games), so halving the bars needs four times the games:
roughly 480, which is about five hours serially at current settings. Three ways
to do better than brute force, best first:

1. **Run games in parallel.** The arena is serial today. The engine is pure and
   deterministic given a seed, so games are embarrassingly parallel across
   worker threads or separate node processes. On an 8-core machine this is close
   to an 8x saving in wall time for no statistical cost. Do this one first.
2. **Paired comparisons (common random numbers).** Play the *same* deal seed
   several times with the agents rotated through the seats, so deal luck cancels
   between agents instead of being averaged away. In a high-luck game this is a
   large variance reduction per game played. The arena already rotates seats,
   but across different seeds rather than within one.
3. **Spend the budget where it is informative.** Most of the wall clock goes on
   Sage at 2000ms per decision. Games that do not include the tiers under
   question are comparatively cheap.

### Open question

Re-measuring moves the anchors, which is the same open question already listed
under "Rate the human player". Decide the two together.

---

## A stronger opponent above Sage

**Status:** wanted, not started. **Priority: medium.** Raised 2026-08-29.

**What:** a new roster tier that is genuinely stronger than Sage, not merely
given more time.

### Do not just raise the search budget

The measurement already rules this out. Going from Vin at 40ms to Sage at
2000ms - a fiftyfold increase in thinking time - bought under 90 Elo, and the
top four tiers are not statistically separable at all. That is direct evidence
the search is limited by **evaluation quality, not by iteration count**. Adding
a "Sage at 8000ms" tier would cost eight times the wall clock and land inside
the existing error bars.

### Where the strength actually is, best first

1. **A better evaluation function.** `expectedScore` / `evaluateGrid` drives
   both the rollout policy and the action priors, so it bounds what the search
   can do. This is the bottleneck and the highest-leverage change.
2. **Inference from opponent behaviour.** Determinization currently samples the
   unseen cards uniformly. It ignores what opponents' choices reveal: someone
   who takes a 9 off a discard pile probably has a use for a 9. Weighting the
   sampling by that inference is the classic next step for an ISMCTS agent and
   fits the existing `determinize` seam cleanly.
3. **Re-tune the search hyperparameters.** `explorationC`, `priorWeight` and
   especially `rolloutTurnLimit` were tuned at low budgets; the right values at
   a large budget may differ. Cheap to sweep once the arena runs in parallel.

### Note

Any new tier needs a fresh ladder run to rate it, so schedule this with the
error-bar work rather than separately.

---

## Position setup and analysis mode

**Status:** wanted, low priority. Raised 2026-08-29.

**What:** a custom mode where you build a specific position - your grid, the
centre card, what is showing on the discard piles - and ask the engine for its
recommended move. Explaining the recommendation is wanted but explicitly
optional.

**Why:** the hint button only works in the flow of a live game. Being able to
set up a position you got wrong, or a hypothetical, is how you actually learn a
card game.

### Most of this already exists

- `useGame` takes an `initialState` option, added so tests could start from a
  chosen position. That is exactly the seam this feature needs.
- The hint path is already built end to end: `createHintAgent` runs ISMCTS in a
  worker, and `describeSuggestion` in `format.ts` renders a chosen action as a
  sentence. An analysis mode is largely the hint button pointed at a
  hand-built position instead of a dealt one.
- The retired Angular app had a rank picker per card, which is the shape of the
  editor UI. It is in git history if it is worth a look: see
  `skipbo-golf-app/skipbo-golf/src/app/app.ts` before commit eeb49e0.

### The "why" is feasible, and cheaply

`ismctsSearch` already returns `rootVisits`: `{ key, visits, mean }` for every
root action, best first. That is the search's actual reasoning, so an
explanation can be shown as data rather than invented prose - the top few
candidate moves with their visit share and mean outcome, e.g. "wave the 7 into
R2C3 (62% of visits, mean 3.1) versus discard (21%, mean 5.4)".

Prefer that over generated commentary: it is honest about what the engine
actually computed, and it costs no extra search.

Two small pieces of plumbing needed:

- `createIsmctsAgent` discards everything but `.action`, and the worker
  protocol only passes the action back. Both need to carry `rootVisits`.
- `rootVisits` is empty when only one action is legal, which the UI must handle
  rather than render an empty table.

### The actual work is validation, not analysis

Building a **legal** `GameState` by hand is the hard part. The engine holds real
invariants: exactly 162 cards, ten per grid, and `determinize` throws
`determinization ran out of unseen cards` the moment the unseen multiset does
not add up. A position editor must therefore validate as you build - track the
remaining census of each rank, refuse a thirteenth 12, and refuse to run the
search until the position is consistent. Budget the effort there.

### Open questions

- How much needs specifying? Your own grid and the centre card are the
  minimum. Opponent grids and discard piles affect the search, but demanding
  all of them would make setup tedious. Sensible default: fill anything
  unspecified by random deal from the remaining cards.
- Is this a separate screen, or a "set up a position" button on the setup
  screen?
- Worth allowing a position to be saved or shared as a string?

---

## Show what an opponent is holding

**Status:** wanted, not started. **Priority: high.** Raised 2026-08-29.

**What:** when a computer player picks up a card that everyone saw them take -
from another player's discard pile, or the centre card - show it face up in an
"in hand" slot on their seat, the way the human's own HOLDING slot works, until
they place or discard it.

**Why:** it makes the opponents legible. You can watch someone take the 9 off
your discard pile and follow what they do with it, instead of the board just
changing.

### This is public information

The card came off a visible pile, so everyone at a real table would have seen
it. Showing it face up leaks nothing.

The only case needing a decision is the other one: a card drawn blind from the
face-down pile was seen by nobody and must not be shown. Either render a
face-down card back in the slot, or leave the slot empty. A face-down back is
probably better - it still tells you they are mid-turn and holding something,
which is the point.

### The one piece of engine work

`GameState` tracks `held` but not where it came from. Its fields are players,
drawPile, centerCard, current, held, phase, locked, placements, triggerPlayer,
finalTurnsRemaining, terminal, rngState and turnCount - nothing records the
draw source. So the engine needs a small addition set at draw time, e.g.
`heldIsPublic: boolean`, true for a centre or discard draw and false for a pile
draw.

`describeAction` in `format.ts` already makes exactly this distinction for the
action log, so the rule is written down and can be mirrored rather than
re-derived.

`Observation` also carries a single `held` for the viewer only, so it needs a
per-player notion of "is holding, and here is the card if it was public".

### Notes

- Seats are tight at phone sizes with two per row, so this may want a compact
  treatment - a small card badge beside the name rather than a full slot.
- At Fast speed the pause is short and the card will flash by, so this is
  mostly useful at Normal or Slow.

---

## Opponent seats stretch when there are few of them

**Status:** bug, not started. **Priority: medium.** Raised 2026-08-29.

**What:** with one opponent, that seat spans the whole table and its five cards
are spread across roughly a thousand pixels with large gaps between them, the
discard placeholder stranded in the middle. It reads as broken rather than
sparse. Two opponents show a milder version of the same thing.

There is no need to fill the width just because it is there. Either enlarge the
cards or leave the space empty; both are fine.

### Cause, already traced

A regression from combining two earlier changes, not a new fault:

1. The responsive work made `.grid--sm` fluid - `repeat(5, minmax(0, 1fr))`
   with `.grid--sm .card--sm { max-width: 32px }` - so a card row shrinks with
   its seat instead of overflowing it on a phone.
2. The variable-player-count work made `.opponents` use
   `repeat(var(--seat-count), minmax(0, 1fr))`, so with one seat that column
   takes the full table width.

Together: each of the five card columns becomes about 200px wide, while the
card inside is capped at 32px, so each card sits at the left edge of a very
wide column. The cap that protects phones is what strands the cards on
desktop.

### Suggested fix

Cap how wide a seat may get, rather than removing the card cap:

- `.opponents { grid-template-columns: repeat(var(--seat-count), minmax(0, 230px)); justify-content: center; }`
  so seats keep a sensible size at any count and centre as a group.
- Optionally also let the card row pack rather than spread, with
  `.grid--sm { justify-items: center }` or `max-content` columns, which guards
  against the same thing recurring if a seat is ever wide for another reason.

Keep the phone behaviour intact: the `max-width: 900px` and `max-width: 460px`
rules deliberately switch `.opponents` to `auto-fit`, and that is what makes
seats sit two-up on a phone. Re-check both after changing this - the
responsive audit covers it (`node scripts/responsive-audit.mjs <dir>`), but it
measures overflow, not gaps, so it will not catch this class of problem on its
own. Look at the screenshots too.

### Worth checking at the same time

Whether the human's own seat has the mirror-image problem at large widths - it
is capped at `max-width: 402px`, so probably not, but confirm rather than
assume.

---

## Undo the current turn

**Status:** wanted, not started. **Priority: high.** Raised 2026-08-29.

**What:** let the player take back the placements made this turn, up to the
point the discard commits it.

**Why:** a placement is permanent *and* locks the spot, so one misclick is
unrecoverable. That is sharpest on a phone, where grid cards are around 47px
and sit next to each other.

### Approach

The engine is immutable - `applyAction` returns a new state and never mutates -
so undo is snapshot-and-restore, not an inverse operation. Keep the state as it
was at the start of the turn, and restore it.

Watch three things:

- The reducer in `useGame` holds more than the game: `log`, `seq`, `hint` and
  `nextLogId`. Restoring only `game` would leave log entries describing moves
  that no longer happened. Snapshot what has to roll back together.
- `seq` guards against duplicate dispatches. Rewinding it risks a stale
  in-flight dispatch matching again; safer to keep `seq` monotonic and restore
  only the game and the log.
- Undo must be impossible once the turn has ended, and while an opponent is
  thinking.

### Open question

Undo the whole turn in one step, or one placement at a time? A wave chain can
be several placements, and stepping back through it is friendlier, but the
turn-start snapshot is much simpler. Suggest starting with whole-turn.

---

## Survive a page refresh

**Status:** wanted, not started. **Priority: low.** Raised 2026-08-29.

**What:** reload the page mid-round and still be in the same game.

**Why:** there is no persistence of any kind today, so a refresh, an
accidental back gesture or a phone reclaiming the tab loses the round outright.

### Notes

- `GameState` is plain data - cards are `{ rank, id }`, `rngState` is a number -
  so it serialises to JSON as-is. No custom encoder needed.
- Persist the seating alongside it, or the restored game has opponents that do
  not match the seats.
- Version the stored blob. The shape has already changed once this project
  (seat names became data), and restoring an old blob into new code should be
  discarded rather than crash.
- Distinct from "Rate the human player": that stores finished games, this
  stores the one in progress.

---

## Animate cards moving

**Status:** wanted, not started. **Priority: low.** Raised 2026-08-29.

**What:** show cards travelling between the piles, the hand and the grid,
rather than the board changing instantly.

**Why:** a wave chain currently resolves in one frame, so the most interesting
move in the game is the one you cannot see happen. Today the action log is the
only record of it.

### Notes

- `Card.id` is stable across states, which is what a FLIP-style animation needs
  to match a card before and after. It is already there for this.
- The opponent pacing (`aiDelayMs`, and `ACT_PAUSE_RATIO` for placements) is
  where an animation has to fit. At Fast speed there may not be room, so this
  probably wants to degrade to no animation rather than slow the game down.
- Respect `prefers-reduced-motion`; the stylesheet already has a block for it.

---

## Explain the final score

**Status:** wanted, not started. **Priority: low.** Raised 2026-08-29.

**What:** on the scorecard, show *why* a hand scored what it did - which
columns cancelled as a matching pair, which cards counted zero for being a 7,
11 or Skip-Bo, and which 2x2 squares took off ten.

**Toggleable in settings**, off or on by preference.

**Why:** the scoring rules are the least obvious part of the game, especially
that squares are counted left to right and a column cannot be reused.

### Do not reimplement the scoring

`scoreGrid(grid)` in `engine/scoring.ts` returns a single number. The
explanation must come from the same code path - either have it optionally
return a breakdown, or build the breakdown and derive the total from it.
Writing a second scoring routine for display would drift from the real one,
and then the app would explain a score it did not award.

---

## An in-app rules reference

**Status:** wanted, not started. **Priority: medium.** Raised 2026-08-29.

**What:** somewhere in the app to look up how the game works, above all the
wave rule.

**Why:** the wave is the hard part of Skip-Bo Golf and there is nowhere in the
app that explains it. `game-description.md` is the canonical reference but is
not surfaced anywhere.

### Notes

- The full rules document is long and includes a clarifications section aimed
  at implementers. A player wants a short version: the turn structure, the wave
  rule with a worked example, and how scoring works.
- Section 15.11 already states the turn structure precisely and reads well as
  player-facing text.
- Keep one source of truth. Either render from the markdown, or keep the short
  version short enough that drift is obvious, and note in
  `game-description.md` that it exists.

---

## Revisit the multi-round match

**Status:** wanted, not started. **Priority: medium.** Raised 2026-08-29.

**What:** a match of several rounds - golf's nine or eighteen holes - with a
cumulative scorecard, rather than a single round deciding it.

**Why:** this was considered before the game existed and "exactly as written,
one round" was chosen. Now that it is playable, one round is very short for the
setup it takes. Worth deciding again with the game in hand.

### Notes

- Section 13 of the rules says a full game is one round, so this is another
  **[RULES CHANGE]** to record in section 15 if it is adopted, alongside 15.2,
  15.8 and 15.12.
- The engine needs nothing: a match is a wrapper that deals a fresh round and
  accumulates `returns()` per player. Keep it out of the engine, which should
  stay a single-round rules implementation.
- Decide what carries between rounds. Nothing has to, but the seating should
  obviously stay, and the dealer or start player might rotate.
