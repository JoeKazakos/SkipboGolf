# Ideas and backlog

Things worth building, parked deliberately rather than forgotten. Each entry
records enough context to pick it up cold: what it is, why it is wanted, what
was already worked out, and what is still open.

Delete an entry when it ships or when it is decided against.

## At a glance

| Priority | Item |
| -------- | ---- |
| Medium | Rate the human player |
| Medium | A stronger opponent above Sage |
| Low | Tighten the error bars on the CPU ratings |
| Low | Position setup and analysis mode |

Keep this table in step with the Status lines below when priorities change.

Settings live in one place: `src/ui/settings.tsx`, opened from the top bar.
Add new preferences there rather than to the top bar.

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









