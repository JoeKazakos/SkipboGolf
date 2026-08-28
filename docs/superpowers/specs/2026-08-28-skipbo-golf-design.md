# Skip-Bo Golf: Playable React App with ISMCTS Opponents

**Date:** 2026-08-28
**Status:** Approved for implementation

## Goal

A fully playable browser version of Skip-Bo Golf: one human against five computer
opponents, six players, one round, lowest score wins. The opponents must play genuinely
well, and that claim must be backed by measurement rather than assertion.

## Scope

In scope: rules engine, AI, React UI, test suites, removal of the superseded Angular app.

Out of scope: multiplayer over a network, persistence between sessions, multi-round
matches, mobile-specific layout work beyond ordinary responsiveness.

## Prior Art

Neither linked repository is directly reusable: `open_spiel` is C++/Python with no browser
build, and `ludometer` is Python. Both contribute design ideas rather than code.

- **open_spiel** contributes its `State` interface shape. Modelling the game as
  `legalActions` / `applyAction` / `returns` with explicit chance nodes is what makes tree
  search attach cleanly instead of being tangled into UI state.
- **ludometer** contributes its evaluation methodology: measure agent quality by Elo from
  self-play rather than by inspection. Adapted here as the arena described below.

## Architecture

Three layers with strictly one-directional dependencies: `ui -> ai -> engine`.

The engine imports neither React nor any DOM API, so it runs unmodified in Node for tests
and inside a Web Worker for search.

```
src/engine/   cards, rng, state, actions, apply, scoring, observation
src/ai/       random, heuristic, ismcts, worker, arena
src/ui/       React components
```

### Engine interface

```ts
currentPlayer(): number
legalActions(): Action[]
applyAction(a: Action): GameState   // immutable; returns a new state
isTerminal(): boolean
returns(): number[]                 // final scores, lower is better
observationFor(p: number): Observation
informationStateKey(p: number): string
```

### Action space

A turn decomposes into atomic actions rather than one compound move. This is what makes
the branching factor tractable for search.

1. `Draw{ source: 'center' | 'pile' | { discardOf: playerId } }`. Drawing from `pile`
   resolves through an explicit chance node.
2. `Place{ row, col }`. The first placement of a turn may target any unlocked spot; every
   later placement must be a legal wave.
3. `Discard`. Always legal while holding a card. Ends the turn.

### Invariants

These are enforced in the engine and asserted by property tests:

- Exactly 162 cards exist across all zones at all times.
- Every play area holds exactly 10 cards at all times.
- A spot may be placed into at most once per turn, so a turn is at most 10 placements.
- Every turn ends with exactly one discard.

### Hidden information

Hidden from a given player: face-down grid cards including their own, the draw pile
contents, and discard cards below the visible top three. Determinization samples a
consistent assignment from the unseen multiset. Because the engine tracks every revealed
card, that multiset shrinks over the round, so opponents sharpen as the round progresses.

## AI

**Chosen: Information Set MCTS with per-iteration re-determinization.**

Rejected alternatives: Perfect Information Monte Carlo suffers strategy fusion, assuming
knowledge it will not have at decision time. A pure heuristic plateaus and becomes readable.

The heuristic is still built, for two reasons: it is the rollout policy inside ISMCTS, and
it is the benchmark opponent in the arena.

Scoring is not zero-sum across six players, so tree nodes store a value vector and each
player maximises their own component (max^n backup) rather than a single scalar.

Search runs in a Web Worker with a 2 to 5 second budget per turn, so the UI never blocks.

## Verification

- The three worked scoring examples in section 12 of the rules become verbatim fixtures.
- The rewritten wave example in section 9 becomes a step-by-step fixture, so the rules
  document and the engine cannot silently drift apart.
- Property tests assert every invariant listed above.
- **Arena:** an Elo ladder over roughly 500 self-play games establishing
  `ISMCTS > heuristic > random` by a margin outside statistical noise.
- A full six-player game is played end to end in a real browser.

## Delivery

Branches merge to local `main` only once their tests pass:

`feat/rules-and-spec` -> `feat/engine-core` -> `feat/ai` and `feat/react-ui` in parallel
-> `chore/remove-angular`.

The engine is the dependency bottleneck and is built first. AI and UI parallelise against
the frozen engine interface. The Angular app is deleted only after its scoring logic is
ported and covered by the new suite, so it remains available as a reference until it is
provably redundant.
