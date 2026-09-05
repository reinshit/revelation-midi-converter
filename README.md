# Revelation MIDI Converter

Revelation MIDI Converter is a browser-based MIDI to MML converter. Conversion,
project storage, and playback run locally in the browser. The application does
not require a backend and does not upload MIDI files.

## Features

- Convert MIDI files to MML in the browser
- Preview tracks with SoundFont playback
- Split, merge, rename, equalize, and remap tracks
- Configure velocity, chord gap, and note resolution
- Save and restore local project files
- Export generated MML
- Run on current Chrome and Edge versions for Windows

## Architecture

- React and TypeScript user interface
- Vite production build
- Rust conversion core compiled to WebAssembly
- Web Worker conversion pipeline
- IndexedDB and local storage for browser persistence
- Web Audio and GeneralUser GS for playback
- Static deployment on Vercel

## Development

Requirements:

- Node.js 22 or newer
- Rust nightly
- The `wasm32-unknown-unknown` Rust target
- `wasm-bindgen-cli` version 0.2.100

Rebuild the WebAssembly package from the repository root:

```powershell
./scripts/build-wasm.ps1
```

Start the web application:

```powershell
cd web
npm install
npm run dev
```

## Verification

Run the Rust and web checks before publishing:

```powershell
cargo test -p midi-to-mml --lib --tests
./scripts/verify-parity-fixtures.ps1
cd web
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:wasm
npm run test:project
npm run build
npm run test:build
npm run test:browser
```

## Deployment

Import this repository into Vercel and set the Root Directory to `web`. The
included Vercel configuration builds the Vite application and publishes the
`dist` directory. Pushes to `main` trigger production deployments.

## Privacy

MIDI files and saved projects remain on the user's device. See `PRIVACY.md` for
details.

## SoundFont

Playback uses GeneralUser GS by S. Christian Collins. Its license is included
at `web/public/soundfonts/GENERALUSER-GS-LICENSE.txt`.

## License

The project source is provided under the MIT License. See `LICENSE`.
