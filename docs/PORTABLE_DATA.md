# Portable analytical data

TFTTool separates the installed application, local preferences and Windows-protected Riot credential, and portable analytical data.

## TFTTool Data Pack

A `.tftpack` is one gzip-compressed, versioned JSON document. Its payload contains saved analytical snapshots and both `es-ES` and `en-US` display metadata. Its manifest records the schema, analysis version, application version, snapshot and observation counts, export time, and a SHA-256 checksum of the complete payload.

Exports are constructed from an allowlist of analytical fields. Local settings, Riot credentials, encrypted secret files, machine paths, refresh checkpoints, and launcher state are not included. Export also rejects credential-like content defensively.

Import fully decompresses and validates the archive, format version, schema compatibility, snapshots, manifest counts, credential exclusion, and checksum before changing local state. The validated snapshots and metadata are merged through the store's atomic temporary-file rename. Existing snapshot IDs are skipped, new snapshot IDs are added chronologically, and no existing history is deleted. Language and other local preferences remain local. A validation or write failure retains the previous in-memory and on-disk dataset.

Team Interaction aggregates are persisted inside each analysis result. If an imported snapshot uses an older analysis version, TFTTool deterministically regenerates archetypes, shared-lobby matchup ordering, and opponent-conditioned Counter Items from the normalized observations before the atomic replacement. The receiving installation therefore opens Interactions immediately without a Riot key, AI, or internet request.

## Installer seed

The installer bundles the current publishable snapshot plus Spanish and English display metadata as the same checksummed, gzip-compressed `.tftpack` format used by data-only distribution. A small manifest lets repeat launches skip decompression when that exact seed was already seen. A clean teammate installation imports the seed once and is immediately useful without a Riot key or network metadata request. Future application launches do not overwrite a newer local or imported snapshot.

A Riot key is requested only when the user explicitly selects Update and no local key exists, or after Riot confirms that the locally protected key is invalid or expired.
