# TFTTool Mission

Build a polished local TFT meta analytics product using official Riot TFT data, with Spanish-first UX, local persistence, weighted analytics, evidence drill-down, history, and Windows packaging.

## Guardrails

- Keep Riot integration real and never commit secrets.
- Detect the current patch and set from Riot metadata; do not hardcode gameplay entities.
- Separate ingestion, normalization, aggregation/scoring, persistence, service, and UI layers.
- Refresh only on explicit user action and preserve the last completed dataset while refreshing.
- Do not claim final acceptance until real-data refresh, critical tests, installer, and UI checks pass.
