# Local database structure

EchoSpeak uses version 1 of the `echospeak-studio` IndexedDB database. All stores are keyed by `id`. There is no server database, account, tracking identifier, or remote media bucket. IndexedDB is origin-scoped.

| Store | Records | Relations and lifecycle |
| --- | --- | --- |
| `sources` | ID, name, created time, duration, waveform peaks, audio `Blob`, optional speaker, collection, favorite, and transcript | `speakerId → speakers.id`. The bundled reference is an app asset and is inserted into the library at load time if it has no saved edits. Removing an imported reference also removes its saved clips and derived reports; recorded takes remain downloadable. |
| `takes` | ID, name, creation time, audio `Blob`, source ID, clip boundaries, mode, duration, peaks, draft flag, quality notes, optional transcript, shadowing onset offset and category report | `sourceId → sources.id`, optional `drillId → clips.id`. Completed recordings are stored as drafts immediately; retaining a take clears its flag. Removing a take also removes its report. |
| `speakers` | ID, name, avatar `Blob`, description, user-provided language, accent, style, category, notes, favorite | Deletion disassociates its references, preserving their audio. Practice history is derived from takes of the linked references. |
| `clips` | ID, source ID, inclusive start/exclusive end in seconds, text label, kind (`sentence`, `word`, `clip`), creation time | `sourceId → sources.id`. Word attempts/matches in the UI are derived from takes linked to the drill. |
| `preferences` | Fixed `preferences` row with theme, speed, repetitions, language, microphone and audio settings; fixed `session` row with current source, range, mode and optional bookmark | Settings and session load on refresh. A localStorage theme hint is used only to avoid a flash before IndexedDB loads. |

Transcripts store `origin` (`manual`, `sample` or `recognition`), optional language, and cue objects with text, start/end and optional recognized word estimates. Reports have a timestamp, per-category score or unavailable marker, explanation, and measured summaries. There is deliberately no overall mimicry or identity field.

## Future account sync (not implemented)

Keep audio in private object storage and use PostgreSQL rows for ownership, object keys and metadata. A logical schema would include `accounts`, `speaker_profiles`, `reference_audio`, `transcript_cues`, `takes`, `assessments`, `saved_clips`, and `preferences`. Each practice entity must have an owning user, with cross-user references structurally disallowed. Add authentication, row-level access checks, short-lived signed media URLs, and an audited deletion job before enabling any sync. Choose Drizzle or Prisma when implementing this migration; no PostgreSQL credentials are required by EchoSpeak today.
