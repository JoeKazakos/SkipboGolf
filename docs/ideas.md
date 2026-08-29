# Ideas and backlog

Things worth building, parked deliberately rather than forgotten. Each entry
records enough context to pick it up cold: what it is, why it is wanted, what
was already worked out, and what is still open.

Delete an entry when it ships or when it is decided against.

---

## Rate the human player

**Status:** wanted, not started. Raised 2026-08-29; deferred deliberately, not
blocked on anything.

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
