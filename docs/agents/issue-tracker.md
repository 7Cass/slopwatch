# Issue tracker: GitHub

Issues and PRDs for this repo live in GitHub Issues for `7Cass/slopwatch`.

## Conventions

- Prefer the GitHub connector when it is available in the agent environment.
- If using the GitHub CLI, use the official `gh` CLI inside this clone so it infers the repo from `git remote -v`.
- Create an issue with a clear title, a complete markdown body, and the appropriate triage label from `docs/agents/triage-labels.md`.
- Read an issue with its body, labels, and comments before using it as source material.
- Do not close or modify parent PRD issues when publishing child implementation issues.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `7Cass/slopwatch`.

## When a skill says "fetch the relevant ticket"

Fetch the GitHub issue body, labels, and comments for the referenced issue.
