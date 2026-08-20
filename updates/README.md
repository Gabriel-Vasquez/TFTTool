# Stable application update channel

`stable.json` is the single update pointer consumed by installed TFTTool clients. Each release installer is stored as an immutable asset on the matching GitHub release tag.

Release order:

1. Build and fully validate the self-contained NSIS installer.
2. Publish it on tag `vX.Y.Z` using the exact filename referenced by the manifest.
3. Record the exact byte size and SHA-256 in `stable.json` and publish that manifest to `main` only after the release asset exists.
4. Verify the public manifest, installer download, byte size, and SHA-256 before declaring the update available.

Data publication is part of the same release path:

1. **Export data** downloads the credential-free `.tftpack` and atomically stages the identical bytes at the local TFTTool publisher inbox.
2. `npm run build:win` runs `scripts/sync-release-data.mjs` first. A staged export must contain the complete six-region sample, both locales, and the current item-taxonomy schema before it can replace the committed bundled seed.
3. If no staged export exists (for example on GitHub runners), the already validated committed seed is used. The installer always contains that seed, so the verified GitHub Update button transfers application code and the published data together.

No Riot key, GitHub credential, local preference, or machine path is included in the staged or bundled data pack.

The application accepts only HTTPS release assets under `Gabriel-Vasquez/TFTTool`, verifies both size and SHA-256, and launches the installer only after validation succeeds.
