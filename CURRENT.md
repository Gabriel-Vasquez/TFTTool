# Current Handoff

## NEVER DELETE — Update delivery rule

Every modification intended for owner review must be delivered as an in-place patch/update to the last TFTTool version the owner installed. Do not provide a separate replacement installation, parallel copy, or unrelated standalone build for review unless the owner explicitly changes this rule.

## NEVER DELETE — QA isolation rule

All development and testing must run in the repository-owned isolated QA sandbox and data store. Do not modify, relaunch, stop, or otherwise disturb the owner's currently installed TFTTool while implementation or QA is in progress. Apply one in-place update to the last installed version only after the complete product specification is ready for owner testing. Routine implementation and QA must continue autonomously without interrupting the owner.

## NEVER DELETE — First-update data rule

The first owner-facing in-place update must include the complete, freshly validated six-region real-data snapshot collected during QA so the product is ready for immediate use without another same-day refresh. Never discard that retrieved dataset. Import it only when newer than the owner's latest local snapshot, while preserving every existing historical snapshot, setting, and encrypted Riot key.

- Phase: TFTTool 0.6.2 production-BETA correction is complete, package-validated, and ready for the one required manual installer update.
- Branch: `main`.
- Published release: TFTTool `0.6.2` on public `main`, with installer asset tag `v0.6.2` and `updates/stable.json` as the controlled stable channel.
- GitHub: public `Gabriel-Vasquez/TFTTool`.
- Implemented and installed: official multi-region Riot ingestion, protected local key storage and invalid-key replacement, full baseline plus incremental diff refresh, deterministic current-set archetypes, real trait breakpoints, exact prevalence/raw-placement weighting, TFTactics-style champion/item presentation, flagship-relative variant diffs, Team Planner export codes, shared-lobby matchup and opponent-conditioned Counter Item analytics, evidence drill-downs, snapshot history/trends, portable `.tftpack` transfer, complete EN/ES UX, bounded rendering/search, secured standalone Electron window, local shutdown control, compressed bundled snapshot import, and NSIS in-place updating.
- Owner-data baseline: TFTTool 0.6.1 is installed at `C:\Program Files\TFTTool`. The data directory, encrypted key availability, Spanish preference, snapshot identity, history, and all 12,000 observations remain preserved after the in-place migration.
- Refinement evidence: raw inspection of the preserved 12,000 observations found 7,457 repeated-item slot occurrences across 5,745 boards, including 441 Lulu and 129 Zoe cases. The implementation now keeps global item prevalence board-normalized while preserving repeated slots for composition-specific champion builds.
- Current-set/current-patch selection is a reusable analysis boundary: when a new TFT set is observed, it is isolated and clustered again through the same deterministic archetype pipeline instead of inheriting old-set boards.
- Portable `.tftpack` export/import, offline bilingual metadata, a full item-free flagship plus exactly three itemized CORE champions, composition-context champion analysis, symmetric variant diffs, and corrected slider direction are installed.
- Riot Team Planner metadata and the v1 ten-slot hexadecimal code layout are integrated. The main card exposes Copy Team beneath Power Index; the expanded flagship and every variant expose their own full-lineup export while variants remain flagship-relative add/remove diffs.
- Team Interactions is installed with complete 24-opponent matchup matrices, region-aware baseline adjustment, reciprocal scores, shrinkage/support thresholds, and opponent-conditioned Counter Items with official item imagery and expandable evidence.
- The Settings data-update buttons export one credential-free `.tftpack` and atomically import only unseen snapshots; receiving installations preserve existing history and preferences without an application update.
- Version 0.6.1 exposes the 12 most-supported exact variants per archetype. The audited Miss Fortune + Lulu + Nami Replicador lineup is now visible at rank 10 while remaining expressed as a flagship-relative add/remove diff.
- Version 0.6.2 verifies the canonical bundled snapshot identity before trusting a prior import and reconciles a partial local copy of that same snapshot. A 11,778-observation reproduction is restored to the exact 12,000-observation canonical payload without changing settings, keys, or unrelated history.
- Anima Squad progression items matching `AnimaSquadItem_Tier*` and Riot's non-obtainable `TFT_Item_EmptyBag` placeholder remain in raw observations but are excluded from global item rankings, composition/champion builds, loadouts, combinations, and Counter Items. The normal Anima emblem remains eligible.
- Settings is a floating modal. One- and two-star badges are muted; three-star badges retain the gold emphasis.
- The Settings application-update button fetches the public stable manifest from `main`, accepts only this repository's HTTPS release assets, verifies exact byte size and SHA-256, then launches the NSIS in-place update. Version 0.6.2 is the final release requiring manual installer distribution.

## Next actions

1. Owner and existing 0.6.1 users install `dist/TFTTool Setup 0.6.2.exe` once. Future application patches are applied from Settings > Update TFTTool.
2. Continue production-BETA use and report any changes required before version 1.0; avoid speculative feature work until that feedback arrives.
3. Future explicit data refreshes reuse the rolling five-day/current-patch sample and request only post-baseline match IDs plus unseen match details.

## Blockers

- No current blocker. A future Riot-key expiration is handled by the in-app replacement flow.

## Owner acceptance

- On 2026-08-20, the owner accepted TFTTool 0.6.1 as finished and placed it in production with BETA status.
- Version 1.0 scope is intentionally deferred until the owner provides findings from production-BETA use.

## Validation

- All 74 domain, clustering, scoring, interaction, Team Planner, metadata, localization, history, security, Riot-key, persistence, incremental-refresh, compressed-seed reconciliation, portable-data, updater, standalone-window, UI-contract, and isolated service end-to-end tests pass on 0.6.2.
- The final analysis completed against patch `16.16` / Set 17 with exactly 12,000 ranked observations and assignments: 2,000 each for EUW, NA, KR, BR, LAN, and LAS. It produces 25 deterministic archetypes ranging from 185 to 953 observations; archetype prevalence sums to 100% and champion/item prevalence never exceeds 100%.
- The observation payload SHA-256 remained `dd3db003e06c1c4663d460a34504cbde5412d30191a72bf7b8140d65f5c14388` across the analysis rebuild, proving that historical source payloads, including stored augment evidence, were not altered.
- The complete bundled seed is the standard `.tftpack` format: 3,739,032 bytes, SHA-256 `40C9169C42B70E4D60F7E577C4BA7D59B76C3B237CDB4550ED650AC4FAFD8774`, analysis version 5, interaction analysis version 1, and EN/ES portable metadata. Its 12,000-observation payload SHA-256 remains unchanged.
- Shared-lobby QA found 1,558 eligible lobbies and 12,000 unique participant boards. All 25 archetypes have all 24 ordered opponents; all 300 unordered pairs meet support, reciprocity error is zero, and Counter Item support ranges from 67 to 102 items per target archetype.
- Source, unpacked-package, and installed browser QA verified the item-free flagship, exactly three itemized CORE champions, repeated item slots, full expanded champion items, add/remove-only variants, working flagship and variant export buttons, complete EN/ES interaction cards, 24-row matchup and 20-row item expansions, search/region filtering, official images, and no blocking dialogs or visible layout regressions.
- Installed 0.6.0 verification preserved the complete owner state file SHA-256 `95C6C48C1A8B0FC6C945F46BEC570BE6042DC16D6F3AE68E251B2C1C9E1F7A57`, snapshot ID `fefaeb0a-9e39-419c-832a-96c26e6808d7`, creation timestamp, all 12,000 observations, Spanish preference, one-snapshot history, and protected Riot-key availability. No credential value was printed or committed.
- Incremental refresh tests verify time-bounded post-baseline match discovery, unseen-detail-only fetching, rolling newest observations, patch/five-day filtering, no-detail-fetch when all matches are already represented, and resumable regional checkpoints.
- Windows NSIS in-place update built, package-tested, and installed successfully: `dist/TFTTool Setup 0.6.0.exe` (89,428,733 bytes, SHA-256 `1ADE4C5B54C8EFAAFD45986B8E01CE6F15E28A3785F1E3E5B5D8B0AE8BA74564`). The unpacked footprint fell from 383,077,408 to 300,293,183 bytes, and repeat packaged startup fell from 1,905 ms to 650 ms in the same health-check benchmark. Installed standalone QA verified 25 cards, Update/Import/Export controls, no horizontal overflow, and no external browser.
- The self-contained 0.6.1 NSIS installer passed isolated packaged standalone QA and owner-performed in-place installation: `dist/TFTTool Setup 0.6.1.exe` (89,507,333 bytes, SHA-256 `055718E04542FB8BA41EB4D6939D3706195108C0FAAC679D64483E9B4BDB7E54`). Installed QA verified app version 0.6.1, analysis version 4, 25 cards, 12 visible Miss Fortune variants, the Replicador lineup at rank 10, Update/Import/Export controls, and no visible layout regression. Migration preserved snapshot `fefaeb0a-9e39-419c-832a-96c26e6808d7`, its `2026-08-20T10:05:57.203Z` timestamp, all 12,000 observations with SHA-256 `dd3db003e06c1c4663d460a34504cbde5412d30191a72bf7b8140d65f5c14388`, Spanish preference, one-snapshot history, and protected Riot-key availability. The hidden QA instance was shut down after validation.
- The self-contained 0.6.2 NSIS installer passed isolated packaged standalone QA: `dist/TFTTool Setup 0.6.2.exe` (89,467,900 bytes, SHA-256 `A34C9C4D6901726C879716907B0B7A63A3205436468E3B16C439316559F62B70`). QA verified app version 0.6.2, exactly 12,000 observations, 25 cards, 12 Miss Fortune variants, zero Anima progression/EmptyBag analytic rows, 230 muted 1/2-star badges versus 51 prominent 3-star badges in the initial view, floating Settings, application-update/import/export controls, and no horizontal overflow. The isolated QA instance was shut down after validation.
