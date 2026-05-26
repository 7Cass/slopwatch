# Slopwatch

Slopwatch is a local observability context for understanding Codex agent activity across projects.

## Language

**Source**:
A local origin that Slopwatch observes for Codex activity. A Source yields observable signals but is not modified by Slopwatch.
_Avoid_: Provider, integration, connector

**Slopwatch-owned state**:
Data and configuration created by Slopwatch for its own operation. Slopwatch may create, update, migrate, or purge this state without modifying any Source.
_Avoid_: Source data, Codex data

**Purge**:
Removal of Slopwatch-owned indexed data. Purge never removes or changes Source data, and local configuration is only included when explicitly requested.
_Avoid_: Delete source, clean Codex, reset Codex

**Collect**:
The act of reading Sources and recording Events in Slopwatch-owned state. Collect is idempotent and safe to repeat for the same Source.
_Avoid_: Import once, sync, scrape destructively

**Project**:
The local workspace a Session or WorkUnit belongs to. A Project is identified by Git root when available, otherwise by the observed starting working directory.
_Avoid_: Repository, folder, workspace

**Session**:
A Codex conversation or run history observed from a Source. A Session may have zero or more Forks.
_Avoid_: Chat, thread

**Fork**:
A branch of work derived from a Session or another Fork. A Fork preserves its origin relationship but can be observed as its own active unit of work.
_Avoid_: Branch, child session

**WorkUnit**:
The operational unit of Codex work that Slopwatch observes as currently or recently active. A Session without active Forks can produce one WorkUnit; each active Fork can produce its own WorkUnit linked to its origin.
_Avoid_: Agent, task, job

**Active**:
A WorkUnit state inferred from recent activity when no stronger Blocked, Failed, or Finished evidence applies. Process liveness may improve confidence but is not required for v0.
_Avoid_: Running process, online

**Blocked**:
A WorkUnit state inferred only from explicit signs that work is waiting for outside action, such as user input, approval, permission, or credentials. Inactivity alone is not Blocked.
_Avoid_: Idle, inactive, paused

**Failed**:
A WorkUnit state inferred from terminal failure evidence, or from a final relevant error with no later continuation. A failed command or test during ongoing work is an Event, not automatically a Failed WorkUnit.
_Avoid_: Error event, failing test

**Finished**:
A WorkUnit state inferred when work has explicit completion evidence or has ended according to Source signals. Recently finished is a UI grouping for Finished WorkUnits still visible on the Now screen.
_Avoid_: Recently finished, done card

**Activity Window**:
A period of WorkUnit activity made from nearby Events. Active time is estimated from Activity Windows rather than total Session duration.
_Avoid_: Session duration, wall-clock time

**Inference**:
A derived interpretation of Events for a WorkUnit, such as state, confidence, and explanation. An Inference is versioned and can be recalculated from Events.
_Avoid_: Source truth, raw state

**Agent**:
The UI label for exactly one WorkUnit. Agent is presentation language and does not aggregate multiple WorkUnits.
_Avoid_: Worker, bot, assistant

**Event**:
A normalized signal of Codex activity derived from a Source. Events are the central records Slopwatch uses to infer WorkUnit state.
_Avoid_: Observation, raw event, log entry

**Event metadata**:
The default stored description of an Event, such as time, type, references, command metadata, file path metadata, counts, and state-relevant attributes. Event metadata excludes full prompts, responses, and file contents.
_Avoid_: Content, transcript

**Raw payload**:
Optional full source text associated with an Event, such as prompt or response content. Raw payload is stored only when content collection is explicitly enabled and does not include file contents in v0.
_Avoid_: Event metadata, file contents

**Source locator**:
A stable reference to where an Event came from within a Source. A Source locator identifies origin position or identity without relying on event content.
_Avoid_: Content hash, text fingerprint

## Example Dialogue

Developer: "Which Source produced this activity?"
Domain expert: "The Codex local Source produced it; Slopwatch only observed it."

Developer: "Does read-only mean Slopwatch cannot migrate its database?"
Domain expert: "No. Read-only applies to Sources; Slopwatch can change Slopwatch-owned state."

Developer: "Will purge clean up my Codex logs?"
Domain expert: "No. Purge only removes Slopwatch-owned indexed data unless local Slopwatch configuration is explicitly included."

Developer: "Can I run collect twice over the same Source?"
Domain expert: "Yes. Collect is idempotent; repeated collection should not duplicate Events or WorkUnits."

Developer: "The agent edited a file outside the repo; did the Project change?"
Domain expert: "No. The Project is the WorkUnit's local workspace; the external file is file metadata on Events."

Developer: "Why are there two agents for one conversation?"
Domain expert: "The original Session has an active Fork, so Slopwatch shows separate WorkUnits linked by origin."

Developer: "Should this Agent include both forks?"
Domain expert: "No. Each Agent represents one WorkUnit; linkage shows their relationship."

Developer: "Is a WorkUnit Active only if Slopwatch sees a live process?"
Domain expert: "No. Recent activity can infer Active unless stronger Blocked, Failed, or Finished evidence applies."

Developer: "The WorkUnit has been quiet for ten minutes; is it Blocked?"
Domain expert: "Not without an explicit waiting signal. Inactivity alone is not Blocked."

Developer: "A test failed; should the Agent be Failed?"
Domain expert: "Not automatically. A failed test is an Event unless the WorkUnit has terminal failure evidence or no continuation after the error."

Developer: "Should Recently finished be stored as a state?"
Domain expert: "No. Store Finished; Recently finished is a UI grouping based on recency."

Developer: "Has this Agent been working for six hours?"
Domain expert: "Maybe not. Active time comes from Activity Windows, not wall-clock Session duration."

Developer: "Is Failed stored directly from the Source?"
Domain expert: "No. Failed is part of an Inference derived from Events and can be recalculated."

Developer: "Should we create Observations and Events?"
Domain expert: "No. Use Event for the normalized activity record; do not introduce Observation in v0."

Developer: "Why is there no prompt text on this Event?"
Domain expert: "The default is Event metadata only; Raw payload exists only when content collection was explicitly enabled."

Developer: "Can we deduplicate Events by matching text?"
Domain expert: "No. Use Source locators so deduplication follows origin identity, not content."
