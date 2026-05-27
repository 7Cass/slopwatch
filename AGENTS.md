# Slopwatch Agent Notes

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `7Cass/slopwatch`. See `docs/agents/issue-tracker.md`.

### Triage labels

This repo uses the default mattpocock/skills triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo with `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## GitHub CLI Notes for Agents

Use the GitHub CLI (`gh`) for all GitHub issue, PR, repository, Actions, and API work.

Do not use the `github:github` skill or GitHub connector tools unless `gh` cannot perform the requested operation. If a fallback is required, explain why `gh` is insufficient before using another GitHub tool.

Use focused `gh` commands with explicit `--json`, `--jq`, `--limit`, and state filters to keep command output and token usage small.

`gh` is already authenticated in the developer environment.

Do not attempt to reauthenticate with `gh auth login`.

If a `gh` command reports an authentication or token problem while running inside a sandbox, verify whether the command had network access. In this environment, blocked network access can make `gh auth status` report misleading token or authentication errors.

When GitHub API access is required, run `gh` commands with network-enabled or elevated execution if the sandbox blocks them.

Never expose, print, or commit tokens.
