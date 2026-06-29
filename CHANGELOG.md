# Changelog

## 0.2.2 - Native release artifacts

- Publish the macOS release artifact as a universal DMG instead of a compressed app bundle.
- Publish the Windows NSIS installer and Linux AppImage directly as release assets.
- Keep checksums for the native release assets in the draft prerelease.

## 0.2.1 - macOS release packaging fix

- Rebuilt the macOS release artifact as a universal app for Intel and Apple Silicon Macs.
- Added ad-hoc signing and verification before packaging macOS release artifacts.
- Made the release workflow update existing draft release assets safely.

## 0.2.0 - Language and release gate refresh

- Added language settings with local persistence.
- Defaulted the UI to English.
- Hardened Linux dependencies for release and CI gates.

## 0.1.1 - Text-only scope refresh

- Fixed Phase 1 scope to text-file comparison, folder comparison, and deterministic 3-way merge.
- Removed non-text comparison planning and related UI wording from the starter baseline.
- Kept non-text detection only as a safe rejection path.

## 0.1.0 - Starter

- Added Tauri/React/Monaco scaffold.
- Added file read, folder scan, three-way merge, and safe-write command prototypes.
- Added browser demos and conflict-resolution UI.
- Added product, architecture, testing, release, and AI-coding documentation.
