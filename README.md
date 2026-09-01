# Skip-Bo Golf

**[Play it in your browser](https://joekazakos.github.io/SkipboGolf/)**

A browser implementation of Skip-Bo Golf: you against one to six computer
opponents, one round, lowest score wins. Nothing to install, and it runs
entirely on your machine - no server, no accounts, no data leaves the page.

Pick your opponents from a roster of seven, each with a measured rating from
random play at 961 Elo up to 1706. The searching tiers run an Information Set
Monte Carlo Tree Search in a Web Worker, so they think without freezing the
page.

The canonical rules live in [game-description.md](game-description.md). Section 15 of that
document records every ambiguity that was resolved during implementation, including the two
deliberate changes to the game as originally written.

## Running it

```sh
npm install
npm run dev      # development server
npm run build    # production build
npm test         # unit and property tests
npm run arena    # AI self-play Elo ladder
```

## Layout

```
src/engine/   the rules, as pure TypeScript with no React or DOM dependency
src/ai/       opponents: heuristic evaluation and Information Set MCTS
src/ui/       React components
```

The dependency direction is strictly `ui -> ai -> engine`. The engine imports nothing from
the other two layers, which is what lets it run unchanged in Node for tests and inside a Web
Worker for search.

## Design notes

The engine follows an [OpenSpiel](https://github.com/google-deepmind/open_spiel)-style
interface: `legalActions` / `applyAction` / `returns` / `informationStateKey`. A turn is
modelled as a sequence of atomic actions rather than one compound move, which is what keeps
the branching factor small enough for tree search.

Opponent strength is measured rather than asserted, an idea taken from
[ludometer](https://github.com/RemiFabre/ludometer): `npm run arena` plays the agent tiers
against each other and reports Elo, so a claim that the AI is strong has evidence behind it.

The full design is in [docs/superpowers/specs/](docs/superpowers/specs/).
