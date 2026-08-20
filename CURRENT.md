# Current Handoff

## NEVER DELETE — Update delivery rule

Every modification intended for owner review must be delivered as an in-place patch/update to the last TFTTool version the owner installed. Do not provide a separate replacement installation, parallel copy, or unrelated standalone build for review unless the owner explicitly changes this rule.

## NEVER DELETE — QA isolation rule

All development and testing must run in the repository-owned isolated QA sandbox and data store. Do not modify, relaunch, stop, or otherwise disturb the owner's currently installed TFTTool while implementation or QA is in progress. Apply one in-place update to the last installed version only after the complete product specification is ready for owner testing. Routine implementation and QA must continue autonomously without interrupting the owner.

## NEVER DELETE — First-update data rule

The first owner-facing in-place update must include the complete, freshly validated six-region real-data snapshot collected during QA so the product is ready for immediate use without another same-day refresh. Never discard that retrieved dataset. Import it only when newer than the owner's latest local snapshot, while preserving every existing historical snapshot, setting, and encrypted Riot key.

- Phase: TFTTool 0.4.0 portable data, champion UX, Team Planner export, and Team Interactions remediation is complete, installed, and ready for owner testing.
- Branch: `main`.
- Published release: TFTTool `0.4.0` on `main`; use Git history for the immutable commit identifier.
- GitHub: private `Gabriel-Vasquez/TFTTool`.
- Implemented and installed: official multi-region Riot ingestion, protected local key storage and invalid-key replacement, full baseline plus incremental diff refresh, deterministic current-set archetypes, real trait breakpoints, exact prevalence/raw-placement weighting, TFTactics-style champion/item presentation, flagship-relative variant diffs, Team Planner export codes, shared-lobby matchup and opponent-conditioned Counter Item analytics, evidence drill-downs, snapshot history/trends, portable `.tftpack` transfer, complete EN/ES UX, bounded rendering/search, default-browser launcher, local shutdown control, bundled snapshot import, and NSIS in-place updating.
- Installed baseline: TFTTool `0.4.0` is applied in place at `C:\Program Files\TFTTool`; the owner data directory, encrypted key availability, Spanish preference, snapshot identity, history, and all 12,000 observations were preserved through schema migration.
- Refinement evidence: raw inspection of the preserved 12,000 observations found 7,457 repeated-item slot occurrences across 5,745 boards, including 441 Lulu and 129 Zoe cases. The implementation now keeps global item prevalence board-normalized while preserving repeated slots for composition-specific champion builds.
- Current-set/current-patch selection is a reusable analysis boundary: when a new TFT set is observed, it is isolated and clustered again through the same deterministic archetype pipeline instead of inheriting old-set boards.
- Portable `.tftpack` export/import, offline bilingual metadata, a full item-free flagship plus exactly three itemized CORE champions, composition-context champion analysis, symmetric variant diffs, and corrected slider direction are installed.
- Riot Team Planner metadata and the v1 ten-slot hexadecimal code layout are integrated. The main card exposes Copy Team beneath Power Index; the expanded flagship and every variant expose their own full-lineup export while variants remain flagship-relative add/remove diffs.
- Team Interactions is installed with complete 24-opponent matchup matrices, region-aware baseline adjustment, reciprocal scores, shrinkage/support thresholds, and opponent-conditioned Counter Items with official item imagery and expandable evidence.

## Next actions

1. Owner may test TFTTool 0.4.0 normally from the existing desktop or Start menu shortcut; the verified installed service is running on its preferred local port.
2. Future explicit refreshes reuse the rolling five-day/current-patch sample and request only post-baseline match IDs plus unseen match details.

## Blockers

- No current blocker. A future Riot-key expiration is handled by the in-app replacement flow.

## Validation

- All 63 domain, clustering, scoring, interaction, Team Planner, metadata, localization, history, security, Riot-key, persistence, incremental-refresh, portable-data, UI-contract, and isolated service end-to-end tests pass on 0.4.0.
- The final analysis completed against patch `16.16` / Set 17 with exactly 12,000 ranked observations and assignments: 2,000 each for EUW, NA, KR, BR, LAN, and LAS. It produces 25 deterministic archetypes ranging from 185 to 953 observations; archetype prevalence sums to 100% and champion/item prevalence never exceeds 100%.
- The observation payload SHA-256 remained `dd3db003e06c1c4663d460a34504cbde5412d30191a72bf7b8140d65f5c14388` across the analysis rebuild, proving that historical source payloads, including stored augment evidence, were not altered.
- The 41,342,920-byte bundled seed has SHA-256 `2AC914C88C28453767EFC736826AEFC51FCDB91AC24CA1E3930A97B6DF705CBC` and contains the complete validated dataset, analysis version 3, interaction analysis version 1, and EN/ES portable metadata.
- Shared-lobby QA found 1,558 eligible lobbies and 12,000 unique participant boards. All 25 archetypes have all 24 ordered opponents; all 300 unordered pairs meet support, reciprocity error is zero, and Counter Item support ranges from 67 to 102 items per target archetype.
- Source, unpacked-package, and installed browser QA verified the item-free flagship, exactly three itemized CORE champions, repeated item slots, full expanded champion items, add/remove-only variants, working flagship and variant export buttons, complete EN/ES interaction cards, 24-row matchup and 20-row item expansions, search/region filtering, official images, and no blocking dialogs or visible layout regressions.
- Installed migration advanced schema 7 to 8 while preserving snapshot ID `fefaeb0a-9e39-419c-832a-96c26e6808d7`, its creation timestamp, all 12,000 observations and their SHA-256, Spanish preference, one-snapshot history, and protected Riot-key availability. No credential value was printed or committed.
- Incremental refresh tests verify time-bounded post-baseline match discovery, unseen-detail-only fetching, rolling newest observations, patch/five-day filtering, no-detail-fetch when all matches are already represented, and resumable regional checkpoints.
- Windows NSIS in-place update built, package-tested, and installed successfully: `dist/TFTTool Setup 0.4.0.exe` (95,987,607 bytes, SHA-256 `9DE3F95FF858671E499CB8BBCE43E419E3CA27DE3F8F25B085F008F1A160A497`). Installed health, analysis version 3, and interaction analysis version 1 are live on the preferred local port.
