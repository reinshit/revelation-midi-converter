# Web refactor release status

## Complete: C0 through C8

- Baseline: seven deterministic MIDI fixtures, 37 tracks, 72,156 MML events,
  five non-default option cases, repeated updates, six mutations, malformed and
  edge MIDI coverage.
- Core and API: native and WASM builds, structured errors, Worker isolation,
  transferable input, timeout/crash recovery, and confirmed-state replay.
- UI: import, drag-and-drop, track operations, explicit two-track selection,
  keymaps, options, shortcuts, MML/project export, responsive layout, and
  English-only user-facing strings.
- Storage: LocalStorage preferences, IndexedDB v2 projects/keymaps, schema
  validation, quota handling, round-trip restore, and clear-data confirmation.
- Playback: licensed GeneralUser GS, lazy AudioWorklet loading, oscillator
  fallback, tempo/program/channel/drum scheduling, volume, pause/resume/stop,
  natural completion, and Rust-authored MML character highlighting.
- Hardening: 53 native unit tests, two native end-to-end tests, four web unit
  tests, six Chrome acceptance tests, axe accessibility gate, static artifact
  budgets, security headers, and zero npm audit vulnerabilities.

## Ready: C9 Vercel preview

The repository is ready for a static Vercel preview. The only remaining evidence
requires an authorized Vercel project and preview URL. Playwright accepts an
external target through `PLAYWRIGHT_BASE_URL`.

## Waiting: C10 production cutover

Production promotion and rollback rehearsal follow a successful preview smoke
test. The `.vercel.app` domain is sufficient; a custom domain is optional.

## Deferred by design: C11 legacy cleanup

The native application remains the parity oracle and rollback path during the
production observation period. Its removal must be a later reversible change.
