# TFTTool

TFTTool is a Windows-local elite Teamfight Tactics meta dashboard built from official Riot TFT APIs and Data Dragon metadata. It combines EUW, NA, KR, BR, LAN, and LAS while preserving inexpensive per-region filtering.

## Normal use

1. Install with `TFTTool Setup <version>.exe`.
2. Launch **TFTTool** from the desktop or Start menu shortcut. It opens as a standalone desktop application; no browser is required.
3. The update includes the latest fully validated six-region snapshot, so current data is available immediately without a same-day refresh.
4. Open **Ajustes**, paste a Riot development or production API key, and choose **Guardar y actualizar** only when a later snapshot is wanted.
5. Use **Actualizar datos** whenever a new snapshot is wanted. TFTTool does not refresh automatically. Later refreshes reuse the latest five-day/current-patch sample, ask Riot only for matches after that baseline, fetch details only for unseen match IDs, and roll the newest observations into the regional target. **Cancelar actualización** safely stops the current request, keeps the valid snapshot unchanged, and saves a SHA-256-verified checkpoint so the next refresh resumes its downloaded work.
6. Use **Ajustes → Cerrar TFTTool** to stop the local service cleanly.

The preferred internal port is `18473`. If another application owns it, TFTTool automatically chooses a free high port. Launching TFTTool again focuses the existing desktop window.

## Runtime requirements

- Windows 10 or Windows 11 on a 64-bit PC.
- No Docker, Node.js, npm, database, web server, browser extension, or separate runtime installation is required.
- The installer contains the Electron/Chromium and Node.js runtime used internally by TFTTool.
- The bundled snapshot and bilingual metadata are available immediately. Internet access and an individual Riot API key are required only when the user explicitly refreshes Riot data.

## Local data and privacy

- The Riot key is protected for the current Windows account and is never stored in this repository.
- Normal product data and snapshot history live under `%LOCALAPPDATA%\TFTTool`.
- Historical snapshots remain until the user explicitly deletes one or confirms **Eliminar todo el historial**.
- A bundled snapshot is imported only when it is newer than local data; it is never allowed to replace or delete existing history.
- Installing an update over the existing TFTTool installation preserves local settings, key protection, and history.

## Data-only distribution

The owner can select **Settings → Export data** and distribute the generated `.tftpack` instead of another installer. Teammates select **Settings → Import data** to ingest it. Imports validate the checksum, add only unseen snapshots, preserve all existing history and preferences, and never contain Riot credentials.

## Analytics

See [docs/ANALYTICS.md](docs/ANALYTICS.md) for composition dominance, prevalence, score, and snapshot-sufficiency methods.

The bundled 0.6.25 baseline contains 24,000 ranked observations: 4,000 each from EUW, NA, KR, BR, LAN, and LAS. Challenger and Grandmaster evidence is collected first; Master is used only for any remaining regional deficit, and tier/LP provenance is retained for audit. Routine refreshes fetch only match IDs newer than each regional cursor, merge newly observed boards, and keep the newest 4,000 observations per region; a set/patch change automatically falls back to a complete deterministic collection. Refresh status explains temporary Riot rate limits and retry waits only while they are active, and its container remains hidden when there is no status to show. Windows in-place updates encode the complete elevated helper command so paths under `Program Files` remain intact, and the app does not close until that helper confirms it has started. Updater status is written without a UTF-8 BOM and remains compatible with status files produced by older Windows PowerShell helpers that include one.

Meta and Favorites share an All-first synergy dropdown, champion-name search covers displayed archetypes and variants, and Standard/Compact layouts preserve the same card evidence while Compact renders each collapsed composition as a materially shorter horizontal row. Every exact variant derives and displays its own three itemized CORE champions while remaining expressed as a flagship-relative add/remove diff. `[Emblema]` is additive: it appears when one dominant emblem has universal evidence, when a 30+ observation lineup has at least 95% evidence for that emblem, or whenever one of the three CORE champions visibly carries an emblem in its representative items. The archetype inherits the marker only from its most-played flagship.

Composition-scoped champion details default item recommendations to prevalence and provide a wide, continuously draggable prevalence/performance slider backed by that champion-item pair's observed placement within the archetype. Dialogs close from either their X control or a click on the surrounding backdrop. Inferred level-by-level boards are intentionally absent because final-board match data cannot support them truthfully.

## Maintainer validation

```powershell
npm test
npm run desktop
npm run build:win
```

Real-data, browser, launcher, installer, and in-place-update acceptance remain required in addition to automated tests. Development and QA use repository-owned `.qa-*` stores; the owner's installed application is not modified until the complete update is ready.
