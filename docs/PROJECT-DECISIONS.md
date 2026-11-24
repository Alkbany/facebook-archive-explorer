# Project Decisions — Facebook Archive Explorer

> This is the authoritative product-decision record. It captures decisions explicitly approved by the owner. Implementation status must remain separate from intended scope: a decision in this document is not evidence that the feature is already implemented.

## 1. Product goal

Build a complete, modern Windows desktop application for exploring personal Facebook exports locally. The product has three equal goals:

1. A comprehensive personal archive for preserving and browsing the available export content.
2. An advanced data explorer for searching, filtering, comparing, and analyzing archive records.
3. A connected local social-archive experience across people, conversations, posts, media, groups, and activity.

The beta releases are intermediate milestones. The goal is a complete, usable 1.0 product, not merely a successful installer or a code-complete shell.

## 2. Required archive areas

The target product scope includes all of the following areas:

- Friends
- Messages
- Posts
- Comments
- Photos
- Videos
- Groups
- Events
- Marketplace
- Saved Items and Collections
- Reactions

A section is not complete merely because its files are discovered or preserved by a generic fallback. A section is marked supported only after its actual export structure has been reviewed, its parser preserves source provenance, and representative non-personal fixtures and tests cover the observed structure. Unsupported variants must remain visible as unsupported or fallback-preserved rather than being described as fully parsed.

## 3. Desktop UI and UX

- Windows desktop application using Electron, React, and TypeScript.
- The interface must be a genuinely modern desktop application. Do not reproduce Facebook's exported HTML appearance or treat a sidebar/color refresh as a complete redesign.
- Workspaces should be cohesive and interconnected, with consistent navigation, search, filters, pagination, detail views, and source references.
- Do not remove useful existing functionality merely to simplify a redesign.
- Beta UI is a review milestone; usability and visual quality remain part of the 1.0 acceptance criteria.

## 4. Accounts, backups, and local data

- Support multiple Facebook accounts.
- Each account can have multiple independent backup snapshots.
- Keep snapshots separate; importing a new backup must not silently merge it into or overwrite another snapshot.
- Original export files and ZIP archives are read-only inputs. Read them from their selected local locations; do not upload, copy wholesale, or commit them to the source repository.
- Imported records and indexes belong in the application's local SQLite database. Media bytes remain in the original backup and are read/streamed locally.
- Preserve source paths, file/card positions, raw values, and provenance so results can be traced back to the original archive.
- Within a message card, collapse repeated attachment references that resolve to the same archive-relative file. When an `<a href>` wraps an image/audio/video element, preserve the actual media element's kind rather than inferring it from the filename or counting the wrapper link as another attachment.

## 5. Four-level search system

Search is a core product feature and has four distinct levels. These levels solve different problems and must not be conflated.

### Level 1 — Exact Search (no AI)

- Reliable literal/text search for words and exact phrases.
- Search eligible names, record titles and bodies, post/comment text, and supported metadata.
- Search file names and archive paths where appropriate.
- Support section, account/snapshot, and UTC date-range filters where the underlying date is reliable. Exclude records with missing or ambiguous `event_time_utc` values while a date filter is active; never guess a timezone.
- For legacy HTML exports, a localized date may be normalized only when the same source file contains an explicit UTC offset in its Facebook export footer and the date matches a reviewed locale format. The original date text must remain unchanged. Unsupported formats, missing/conflicting offsets, and ambiguous dates must keep `event_time_utc` null; do not infer historical daylight-saving rules from the computer's current timezone.
- Preserve the existing fast local SQLite FTS5 search as the baseline.
- Exact search remains available whether or not optional AI features are installed or enabled.

### Level 2 — Fuzzy Search (no LLM)

- Tolerate likely typing mistakes: missing, extra, substituted, or transposed characters.
- Include Arabic-aware normalization, including alef variants (أ, إ, آ, ا), removal of diacritics and tatweel, and other carefully tested normalization rules.
- Allow the user to tune the similarity/strictness threshold.
- Rank likely matches and distinguish fuzzy matches from exact matches in the results.
- Do not rely on an LLM or embeddings for typo tolerance.
- Avoid silently merging distinct words through overly aggressive normalization.

Example: a query such as `Alexandrea` can suggest or find `Alexandria`.

### Level 3 — Semantic Search (optional local embeddings)

- Search by meaning and context, including natural-language queries whose wording differs from the archived text.
- Use a multilingual embedding model that runs locally. The embedding model is distinct from an LLM.
- When Semantic Search is enabled, generate and persist embeddings incrementally during the import pipeline as eligible records are saved; do not require a separate full archive re-import or an all-at-once post-import pass.
- If the user enables Semantic Search after records have already been imported, backfill the semantic index for existing eligible records without re-importing the original archive.
- Process embeddings in bounded batches and expose index/model progress and failure state.
- Persist checkpoints so indexing can resume after the app closes or an error occurs.
- If embedding generation fails, preserve successfully imported archive records and the other search levels. Semantic indexing errors must not turn an otherwise successful source-file import into an archive-import failure.
- Track the embedding model/version. When it changes, support a controlled rebuild of the semantic index.
- Semantic indexing is disabled by default and consumes no model resources until enabled. Model files may be downloaded only after the user enables the feature; after installation, embedding generation and search run locally.
- Do not send archive content to an external embedding service.

### Level 4 — AI Assistant (optional LLM)

- Accept multi-part natural-language questions and tasks over the local archive.
- Retrieve relevant records, apply appropriate filters, and assemble evidence-grounded summaries or answers.
- Support tasks such as summarizing a topic over a date range, identifying conversation participants, finding when a subject was discussed, and comparing relevant archive records or snapshots.
- Every substantive answer must include navigable references to the source records/files and their account/snapshot context.
- The assistant must say when evidence is incomplete or unavailable; it must not invent conversations, people, dates, or facts.
- The LLM is a separate component from the embedding model. AI Assistant is optional and disabled by default. Local model execution is the default; archive content must not be transmitted to an external AI provider automatically.
- If a model is unavailable or disabled, Exact, Fuzzy, and any enabled Semantic Search must continue to function independently.

### Unified search experience

- Provide one coherent search workspace that exposes the four levels without making them appear to be the same algorithm.
- Let users see why a result matched (exact, fuzzy, or semantic) and inspect the source context.
- Keep section and snapshot filters consistent across levels wherever technically applicable.
- Search exports must retain source provenance and match type/rank where available.

## 6. Message-search privacy

- Message content remains excluded from global search by default.
- Provide a separate, explicit user-controlled setting for including message content in global search.
- When enabled, messages may be indexed locally and may appear in global Exact, Fuzzy, and enabled Semantic Search according to the selected search level.
- The message-search setting is independent of the general Semantic Search and AI Assistant settings.
- Keep the Messages workspace usable for direct conversation browsing and section-scoped filtering without enabling global message search.
- Provide all-word text search inside the selected conversation through a bounded local SQL query; this does not persist message text in either global FTS index and remains available when the global message-search preference is off.
- Never include sensitive message content in the global indexes unless the user has explicitly enabled the message-search setting.
- Explain the privacy impact clearly in the setting before the user enables it.

## 7. Import and indexing behavior

- Import supported sections sequentially and safely, with per-file progress, diagnostics, retries, and durable checkpoints.
- Keep per-file database writes atomic; a failed retry must not erase the last successful imported records.
- Build the standard full-text search index as eligible records are imported.
- Build fuzzy-search support from eligible normalized searchable text without requiring a cloud service or LLM.
- If Semantic Search is enabled, generate embeddings during import in bounded batches. Also backfill older imported records when enabled later.
- Indexing must obey each record's sensitivity and the message-search setting.
- Search-index/embedding failures must be reported separately and recoverably, without discarding imported records or preventing non-AI search.
- The app must not fetch external URLs from the archive or transmit archive contents as part of import.
- External references may open in the operating system's default browser only after an explicit user action. Route the request through a narrow main-process IPC method that validates HTTP/HTTPS schemes and rejects malformed URLs and embedded credentials; never enable arbitrary renderer navigation or automatic URL fetching.
- Marketplace imports may merge matching listing/detail files to fill fields such as description, price, category, and identifiers while retaining all source references. Seller and raw source fields stay in the local provenance payload unless a separately reviewed product decision explicitly approves displaying them; they are not global-search fields.

## 8. Media library

- Default to 100 items per page.
- Let the user choose 50, 100, or 250 items per page.
- Provide Grid and List views.
- Filtering and search must happen before pagination. Do not use a fixed first-N query limit that silently hides the rest of the library.
- Keep media linked to its local original source and supported archive context. Do not copy media bytes unnecessarily.

## 9. Optional AI configuration

- AI features are optional and must not be required for core archive browsing, import, Exact Search, or Fuzzy Search.
- Semantic Search and AI Assistant can be independently enabled/disabled.
- Provide clear model state, configuration, local resource controls, and recovery/re-index actions.
- Do not download large model files without the user's explicit enablement.
- No automatic cloud processing, analytics, telemetry, remote crash reporting, or archive uploads.

## 10. Development and delivery rules

- The combined **Import All** orchestration must have regression coverage that exercises supported section importers together against one synthetic snapshot, checks the resulting database records, and verifies source-file processing states. Individual importer tests remain necessary and do not replace cross-section integration coverage.

- Work directly on `main` unless a separate branch is explicitly agreed.
- Work in coherent batches and complete connected tasks without asking the owner to approve every small technical step.
- Do not silently change approved product decisions. Discuss material scope or privacy changes first.
- Keep the decision record, roadmap, README, and implementation status aligned.
- Add tests and update documentation for meaningful features.
- Protect existing functionality; do not remove features simply to reduce implementation effort.
- Avoid repeated installer builds for tiny changes. Batch work, run relevant tests/type checks/builds, then verify the resulting CI run.
- Stop to ask only when a genuine product-level decision, conflict with an approved decision, or indispensable missing source sample blocks progress.
- Never ask the owner to upload a personal Facebook backup to GitHub or another external service. Use synthetic, non-personal fixtures in the repository.
- Code signing is not a substitute for finishing core product functionality and is not the priority ahead of the 1.0 feature and quality gates.

## 11. Completion and evidence rules

A feature is complete only when its implementation, tests, user-facing behavior, and documentation agree. For parser coverage, evidence must come from reviewed export structures and representative fixtures. For search quality, tests must cover Arabic and English, exact phrases, missing/extra/substituted/transposed characters, similarity thresholds, semantic paraphrases, privacy exclusions, indexing recovery, and source references. Performance and privacy checks are required before 1.0. Synthetic 50,000-record Exact/Fuzzy search measurements are useful regression evidence, but must not be presented as a substitute for timing real directory and ZIP imports, media indexing/streaming, semantic indexing, or a complete real backup. Do not use universal millisecond thresholds across different hardware; record corpus size, machine context, and observed timings.

---

## Implementation status snapshot

This section is deliberately a status snapshot, not a promise that every feature has passed real-archive validation.

- Implemented Exact Search: local SQLite FTS5, quoted phrase matching, Arabic normalization, section filters, metadata lookup for file paths/file names/source dates, and inclusive UTC date-range filters.
- Implemented Fuzzy Search: typo-tolerant token expansion and edit-distance scoring for insertion, deletion, substitution, and adjacent transposition, with a configurable threshold and the same reliable UTC date-range filter.
- Implemented message privacy control: message content is excluded from global search by default, stored in a separate index only after explicit opt-in, and removed from that index when disabled. Direct Messages-section exact scan remains available without persistent indexing.
- Implemented Semantic Search foundation: optional multilingual local embeddings, persisted versioned vectors, incremental import-time jobs, backfill, restart recovery, retry, and UTC date-range filtering. Actual model inference and semantic relevance still require clean-device validation.
- Implemented AI Assistant foundation: independently optional local Qwen2.5-0.5B-Instruct, local evidence retrieval, citation-ID validation, conversation context, and source-file navigation. Real model output quality and citation completeness remain validation tasks.
- Implemented hybrid AI Assistant evidence ranking: bounded lexical BM25 and optional semantic results are merged with reciprocal-rank fusion; matching records gain a combined rank contribution, and lexical retrieval remains the fallback when semantic search is unavailable.
- Implemented Events workspace for reviewed RSVP/invitation/hosted JSON formats, Marketplace listings workspace for the reviewed `items_selling_v2` + label-value pair, and Saved Items workspace for `saves_v2`. Unsupported files stay in generic fallback.
- Implemented media library pagination: 100 items by default, selectable 50/100/250, Grid/List views, and filtering before pagination.
- Message content is eligible for assistant evidence only when the independent message-search privacy setting is enabled; neither AI feature uploads archive content to an external inference endpoint.
