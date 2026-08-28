# AGENTS

Repository-level agent guidance for Skip-Bo Golf.

## Primary Rule Source

- The canonical gameplay spec is game-description.md.
- If code conflicts with game-description.md, update code to match the rules unless explicitly instructed to change the rules.
- Do not silently change gameplay behavior.

## Recommended Development Workflow

1. Clarify the exact rule or behavior being implemented.
2. Identify the smallest code surface that needs change.
3. Add or update tests first for the intended behavior.
4. Implement minimal code changes.
5. Re-run tests and summarize rule-to-code mapping.

## Quality Gates

- Any change touching wave logic must include wave-path tests.
- Any change touching scoring must include at least one worked-case test and one edge-case test.
- Any change touching round-end or draw-source logic must include turn-sequencing tests.

## Scope Guardrails

- Keep behavior deterministic.
- Avoid introducing implied rules not present in game-description.md.
- Keep code changes focused and small.
