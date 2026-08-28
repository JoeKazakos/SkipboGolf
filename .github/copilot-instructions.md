# Copilot Instructions for Skip-Bo Golf

## Project Ground Rules

- Treat game-description.md as the single source of truth for gameplay behavior.
- If implementation differs from game-description.md, align implementation to the document unless explicitly asked to change rules.
- Never introduce rule changes without calling them out clearly.

## Implementation Priorities

- Prefer explicit and testable logic over compact or clever logic.
- Keep changes small and localized.
- Preserve existing structure and naming unless there is a clear reason to refactor.

## Required Verification

- For rule changes, add or update tests in the same change.
- Validate edge cases for wave placement, draw-source legality, round-end flow, and scoring.
- Report exactly which rule statements were implemented.

## Suggested Workflow

1. Read the relevant sections of game-description.md.
2. Write or update failing tests for the intended behavior.
3. Implement the minimal code to pass tests.
4. Re-check that no unrelated behavior changed.
