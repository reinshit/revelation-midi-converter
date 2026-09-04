# Status Checkpoint Refactor Web

> Superseded by `docs/web-refactor-status.md`. This historical work log is kept
> only for traceability and must not be used as the current release status.

Dokumen ini mencatat evidence aktual. Sebuah checkpoint hanya berstatus selesai
jika seluruh kriteria lulus dalam `web-refactor-plan.md` telah dibuktikan.

## C0 — Bekukan baseline

Status: **in progress**

Evidence yang sudah tersedia:

- Tujuh source MIDI tercantum dalam `docs/python-port-contract.json`.
- Tujuh golden fixture default tersedia di `fixtures/parity/`.
- Fixture mencakup 37 track dan 72.156 final MML events.
- `scripts/verify-parity-fixtures.ps1` memvalidasi inventory, ukuran dan SHA-256
  source, metadata schema, bridge ordering, normalized positions, chord
  structure, positive duration, note length, dan MML tanpa whitespace.
- Verifier lulus pada 2026-09-04:

  ```text
  Parity fixtures verified: 7 files, 37 tracks, 72156 MML events.
  ```
- Test core Rust lulus pada 2026-09-04: 49 unit test dan 2 e2e test.
- Regenerasi ketujuh fixture dengan exporter resmi menghasilkan hash fixture
  identik, kemudian verifier kembali lulus.

Evidence yang masih diperlukan:

- Lengkapi parity matrix non-default: smallest unit, velocity range, chord gap,
  auto velocity, repeated option update, malformed/edge MIDI, serta operasi
  split/merge/equalize/rename/keymap.
- Rekam versi parser dan hasil invariant langsung dari exporter.

## C1 — Siapkan workspace web

Status: **complete**

Evidence yang sudah tersedia:

- Workspace React 19 + TypeScript + Vite tersedia di `web/`.
- First product slice menggantikan placeholder dan menampilkan alur import,
  track selection, MML editor, options, dan player controls.
- Development route merespons HTTP 200.
- Development route merespons HTTP 200 dan production output tersedia di `dist/`.
- Lint untuk source aplikasi dan TypeScript typecheck lulus.
- Workspace disederhanakan menjadi Vite React SPA murni; production build lulus
  tanpa runtime server dan menghasilkan output `dist/` untuk Vercel.
- GitHub Actions menjalankan test core, fixture verification, build WASM,
  parity WASM, lint, typecheck, dan static production build.
- Static build verifier memastikan HTML entry, JS, CSS, dan hashed WASM tersedia;
  hasil terbaru mencatat WASM production berukuran 268.290 byte.

## C2 — Jadikan core Rust kompatibel dengan WASM

Status: **complete**

Evidence yang sudah tersedia:

- Paralelisme eksplisit `rayon`/`num_cpus` pada core diganti iterator sekuensial.
- Default feature `parallel` Midly dinonaktifkan untuk core.
- Seluruh 49 unit test dan 2 e2e test tetap lulus setelah perubahan.
- Crate `reve-midi-wasm` menyediakan facade stateful untuk load, snapshot,
  options, split, merge, equalize, rename, dan keymap.
- `cargo check -p reve-midi-wasm --target wasm32-unknown-unknown` lulus.
- Package browser berhasil digenerate; binary release WASM berukuran 268.290
  byte sebelum hashing/bundling.
- Runtime WASM diverifikasi terhadap tujuh fixture: seluruh 37 track cocok pada
  PPQ, options, metadata instrumen, note length, dan final MML.

## C3 — Buat API WASM yang stabil

Status: **complete**

Evidence yang sudah tersedia:

- Facade stateful dan TypeScript adapter sudah tersedia untuk semua operasi
  `SongActor` yang direncanakan.
- Input options divalidasi pada boundary dan merge track yang sama ditolak.
- Default snapshot seluruh fixture lolos parity.
- Golden operation fixture membuktikan native/WASM parity untuk update options,
  split, merge, equalize, rename, dan keymap.
- Error lintas boundary berupa `ReveMidiError` dengan kode stabil; invalid
  options, self-merge, dan invalid track index diuji.

## C4 — Pindahkan converter ke Web Worker

Status: **in progress**

Evidence yang sudah tersedia:

- UI mengirim byte MIDI sebagai transferable `ArrayBuffer` ke dedicated worker.
- Protocol request/response memiliki request ID dan schema TypeScript.
- Client memiliki timeout 30 detik, pending-request cleanup, structured error,
  disposal, dan worker recreation setelah crash.
- Setelah crash/timeout, worker pengganti memuat ulang source MIDI dan replay
  mutation history terakhir yang sudah berhasil sebelum menerima operasi baru.
- Unit test dengan worker simulasi membuktikan urutan recovery
  `load -> replay mutation -> next operation`.
- Production build memuat worker sebagai chunk terpisah dan static build
  verifier memastikan chunk tersebut tersedia.

Evidence yang masih diperlukan:

- Browser integration test untuk load, operasi berurutan, invalid MIDI, timeout,
  serta recovery menggunakan Worker dan WASM sesungguhnya.

## C5 — Port UI converter dan editor

Status: **in progress**

Evidence yang sudah tersedia:

- File picker membaca MIDI lokal dan menjalankan converter worker.
- Snapshot nyata menggantikan data demo setelah konversi.
- Pemilihan track, copy MML, rename, split, merge-nearest, equalize-nearest, dan
  update options sudah terhubung ke WASM.
- Drag-and-drop, keymap JSON tervalidasi, serta export MML dan project sudah
  tersedia.

Evidence yang masih diperlukan:

- Explicit two-track selection, shortcut, empty/loading/success polish, dan
  responsive acceptance test.

## C6 — Storage lokal dan format project

Status: **in progress**

Evidence yang sudah tersedia:

- Format project JSON menyimpan source MIDI, options awal, dan mutation history,
  sehingga state editable dapat direkonstruksi lewat WASM.
- Preferences disimpan di LocalStorage dan recent editable project disimpan di
  IndexedDB.
- Verifier format project membuktikan round-trip byte/options/mutation serta
  penolakan JSON rusak, schema asing, options invalid, dan payload MIDI rusak.

Evidence yang masih diperlukan:

- Version migration, corrupted-data recovery test, quota handling, dan browser
  integration test untuk round-trip project.

## C7 — Player browser dan highlighting

Status: **in progress**

Evidence yang sudah tersedia:

- Snapshot WASM sekarang memuat timeline note dan tempo terstruktur; operation
  parity memastikan timeline native dan WASM identik.
- Player AudioWorklet + SoundFont GM menjadwalkan seluruh track menggunakan audio clock,
  mengintegrasikan perubahan tempo, velocity, pause/resume, stop, progress, dan
  cleanup note aktif.
- Asset SoundFont dan processor disertakan dalam output statis; fallback
  oscillator tetap tersedia jika inisialisasi synthesizer gagal.
- Rust/WASM mengirim range karakter setiap note; parity verifier memastikan
  seluruh range terurut, tidak kosong, berada di dalam MML, dan menunjuk token
  note. UI menyorot range aktif mengikuti audio clock.
- Slider volume mengendalikan gain SoundFont dan fallback player.
- Kontrol play/pause/stop dan indikator waktu terhubung di UI.

Evidence yang masih diperlukan:

- Tambahkan program-change event di tengah timeline; program dan channel awal
  setiap track sudah diterapkan dari snapshot.
- Uji drift, tempo change, hanging notes, autoplay, dan fixture playback di
  browser yang didukung.

## C8–C11

Status: **not started**

Checkpoint berikutnya mengikuti dependency dan quality gate pada rencana utama.

Evidence hardening awal:

- Dependency CLI `shadcn` yang tidak digunakan dibuang dari deployment graph.
- Vite dan Vitest dinaikkan ke versi yang menutup advisory high/critical;
  `npm audit` kini melaporkan 0 vulnerability production maupun development.
- Vercel config menerapkan CSP yang mengizinkan WASM/Worker secara terbatas,
  memblokir plugin/frame embedding, serta mengaktifkan nosniff, restrictive
  permissions policy, no-referrer, dan cache policy aset audio.
- Static build verifier memvalidasi security header wajib agar perubahan config
  yang memutus WASM atau Worker terdeteksi di CI.
