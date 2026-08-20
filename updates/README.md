# Stable application update channel

`stable.json` is the single update pointer consumed by installed TFTTool clients. Each release installer is stored as an immutable asset on the matching GitHub release tag.

Release order:

1. Build and fully validate the self-contained NSIS installer.
2. Publish it on tag `vX.Y.Z` using the exact filename referenced by the manifest.
3. Record the exact byte size and SHA-256 in `stable.json` and publish that manifest to `main` only after the release asset exists.
4. Verify the public manifest, installer download, byte size, and SHA-256 before declaring the update available.

The application accepts only HTTPS release assets under `Gabriel-Vasquez/TFTTool`, verifies both size and SHA-256, and launches the installer only after validation succeeds.
