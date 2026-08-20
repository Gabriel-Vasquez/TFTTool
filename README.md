# TFTTool

TFTTool is a Windows-local elite Teamfight Tactics meta dashboard built from official Riot TFT APIs and Data Dragon metadata. It combines EUW, NA, KR, BR, LAN, and LAS while preserving inexpensive per-region filtering.

## Normal use

1. Install with `TFTTool Setup <version>.exe`.
2. Launch **TFTTool** from the desktop or Start menu shortcut. It starts its local service and opens the correct localhost address in the default browser.
3. The update includes the latest fully validated six-region snapshot, so current data is available immediately without a same-day refresh.
4. Open **Ajustes**, paste a Riot development or production API key, and choose **Guardar y actualizar** only when a later snapshot is wanted.
5. Use **Actualizar datos** whenever a new snapshot is wanted. TFTTool does not refresh automatically. Later refreshes reuse the latest five-day/current-patch sample, ask Riot only for matches after that baseline, fetch details only for unseen match IDs, and roll the newest observations into the regional target.
6. Use **Ajustes → Cerrar TFTTool** to stop the local service cleanly.

The preferred port is `18473`. If another application owns it, TFTTool automatically chooses a free high port. Launching TFTTool again reuses the running instance.

## Local data and privacy

- The Riot key is protected for the current Windows account and is never stored in this repository.
- Normal product data and snapshot history live under `%LOCALAPPDATA%\TFTTool`.
- Historical snapshots remain until the user explicitly deletes one or confirms **Eliminar todo el historial**.
- A bundled snapshot is imported only when it is newer than local data; it is never allowed to replace or delete existing history.
- Installing an update over the existing TFTTool installation preserves local settings, key protection, and history.

## Analytics

See [docs/ANALYTICS.md](docs/ANALYTICS.md) for composition dominance, prevalence, score, and snapshot-sufficiency methods.

## Maintainer validation

```powershell
npm test
npm run desktop
npm run build:win
```

Real-data, browser, launcher, installer, and in-place-update acceptance remain required in addition to automated tests. Development and QA use repository-owned `.qa-*` stores; the owner's installed application is not modified until the complete update is ready.
