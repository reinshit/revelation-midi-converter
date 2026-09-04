# Web release guide

## Architecture

The web application is a static React and TypeScript build. The Rust converter
runs as WebAssembly inside a dedicated Web Worker. MIDI files, projects,
preferences, keymaps, and playback remain in the browser. No backend or Vercel
Function is required.

## Supported environment

- Windows 10 or newer
- Current stable Google Chrome or Microsoft Edge
- JavaScript, WebAssembly, Web Workers, IndexedDB, Web Audio, and AudioWorklet
  enabled

Firefox and Safari are not release-blocking targets for this Windows-focused
version.

## Production verification

From `web/`:

```powershell
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:wasm
npm run test:project
npm run build
npm run test:build
npm run test:browser
npm audit
```

The native Rust oracle must also pass from the repository root:

```powershell
cargo test -p midi-to-mml --lib --tests
./scripts/verify-parity-fixtures.ps1
```

## Vercel preview and production

1. Import the GitHub repository into Vercel.
2. Set the project Root Directory to `web`.
3. Keep the detected Vite build command (`npm run build`) and `dist` output.
4. Deploy a preview and run the browser suite against the preview URL.
5. Promote the verified deployment to production. A custom domain is optional;
   the generated `.vercel.app` domain is sufficient.

The committed `vercel.json` supplies security and caching headers. There must
be no Functions entry in the deployment output.

## Privacy

The application does not upload MIDI or project data. Local browser storage is
used only for preferences, the latest project, and the latest keymap. Clearing
site data or using the in-app clear action removes persisted local data.

## SoundFont

GeneralUser GS by S. Christian Collins is bundled for playback. Its license is
stored beside the SoundFont at
`web/public/soundfonts/GENERALUSER-GS-LICENSE.txt`. The first playback may fetch
approximately 32 MB; subsequent playback uses browser caching.

## Known compatibility behavior

- SMPTE-timed MIDI uses the legacy 480 PPQ fallback to preserve native output.
- A note without note-off is dropped to prevent a hanging browser voice.
- If AudioWorklet or the SoundFont cannot initialize, playback uses a basic
  oscillator fallback and displays that status.
- Projects are local to a browser profile unless exported manually.

## Rollback

Vercel keeps immutable deployments. If a production smoke test fails, use the
Vercel deployment list to promote the last verified deployment, then reproduce
the failure locally. Do not delete the prior deployment until the replacement
has passed import, conversion, playback, storage restore, and export checks.
