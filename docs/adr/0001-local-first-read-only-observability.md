# Local-first read-only observability

Slopwatch is local-first observability for Codex activity, not a hosted telemetry product or control plane. It observes local Sources and may modify only Slopwatch-owned state such as its database and configuration; it must not modify Codex-origin logs, history, sessions, files, state, or configuration. This keeps the tool trustworthy for personal Codex usage while leaving hosted sync, multi-user features, and remote control outside the initial product boundary.
