# Domain Docs

How engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This is a single-context repo.

- Read `CONTEXT.md` at the repo root for domain language.
- Read relevant ADRs under `docs/adr/` before changing architecture, persistence, source collection, inference, server behavior, dashboard behavior, or privacy-sensitive data handling.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, implementation plan, test name, or review finding, use the term as defined in `CONTEXT.md`.

Avoid synonyms that the glossary explicitly rejects. In particular, preserve these distinctions:

- Source data is not Slopwatch-owned state.
- Agent is UI language for one WorkUnit.
- Event is the normalized activity record; Observation is avoided in v0.
- Recently finished is a UI grouping, not a persisted state.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.
