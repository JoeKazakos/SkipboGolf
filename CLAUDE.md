# CLAUDE.md

This file provides project context and working rules for Claude-based agents.

## Project Scope

- Repository purpose: define and implement the Skip-Bo Golf card game.
- Canonical rules document: game-description.md at repo root.
- Frontend app: skipbo-golf-app/skipbo-golf.

## Source of Truth

- Treat game-description.md as the primary gameplay specification.
- If implementation conflicts with game-description.md, align implementation to the rules unless explicitly told to change rules.
- Do not silently change gameplay rules. Propose rule updates explicitly and request confirmation first.

## Development Commands

Run commands from skipbo-golf-app/skipbo-golf:

- Install: npm install
- Dev server: npm start
- Build: npm run build
- Unit tests: npm test

## Coding Conventions

- Keep changes small and focused.
- Preserve existing project structure and naming.
- Prefer explicit logic over clever shortcuts in game-rule code.
- Add tests when changing scoring, wave logic, turn order, or round-end behavior.

## High-Risk Rule Areas

Double-check these areas before finalizing any change:

- Wave legality and placement (same column, opposite row, visible match requirement)
- Wave chaining and optional stop/discard behavior
- Draw-source legality (center card, draw pile, other players' discard top card)
- End-of-round trigger and final-turn sequencing
- Scoring algorithm (column scoring, special ranks, square bonuses, overlap handling)

## Recommended Agent Workflow

1. Read game-description.md fully before making gameplay changes.
2. Identify impacted rule area and matching code paths.
3. Implement minimal code changes.
4. Add or update tests for the changed rule behavior.
5. Summarize exactly which rule statements were implemented.
