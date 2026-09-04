# Revelation MIDI to MML Web

Static React application with the existing Rust converter compiled to
WebAssembly. MIDI conversion runs locally in a Web Worker; no backend is used.

## Development

Requirements: Node.js 22+, Rust nightly with the `wasm32-unknown-unknown`
target, and `wasm-bindgen-cli` 0.2.100.

From the repository root, rebuild the browser package after changing Rust:

```powershell
./scripts/build-wasm.ps1
```

Then run the web application:

```powershell
cd web
npm install
npm run dev
```

## Verification

```powershell
npm run lint
npm run typecheck
npm run test:wasm
npm run build
npm run test:build
```

The WASM parity test compares the test MIDI fixture and six mutation operations
against outputs exported by the native Rust implementation.

## Vercel

Create a Vercel project from this repository and select `web` as its Root
Directory. The included configuration builds with Vite and publishes `dist`.
The generated WASM package is committed, so Vercel does not need a Rust
toolchain during deployment.

## Browser support and privacy

The supported production browsers are current Chrome and Edge on Windows.
MIDI conversion, project storage, and playback happen locally in the browser;
the application has no backend and does not upload MIDI files.

## SoundFont attribution

Playback uses GeneralUser GS by S. Christian Collins. The bank is distributed
for use in software projects under its included custom license. See
`public/soundfonts/GENERALUSER-GS-LICENSE.txt` and
https://schristiancollins.com/generaluser.php.

The former `gm.sf2` was removed because its embedded metadata identified it as
copyrighted Roland content without a redistribution license.
