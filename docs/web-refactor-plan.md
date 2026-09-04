# Rencana Refactor ke Web

## Goal utama

Menghasilkan aplikasi Revelation MIDI-to-MML berbasis web yang berjalan
sepenuhnya di browser, mempertahankan perilaku converter lama, dapat memainkan
dan menyorot MML, serta dapat dideploy sebagai static site ke Vercel tanpa
backend wajib.

## Prinsip migrasi

- Pertahankan core Rust dan compile ke WebAssembly (WASM).
- Gunakan React, TypeScript, dan Vite untuk UI.
- Proses MIDI, keymap, project, dan playback di browser pengguna.
- Jangan hapus aplikasi lama sebelum seluruh checkpoint parity selesai.
- Setiap checkpoint harus menghasilkan build yang dapat dijalankan atau artefak
  verifikasi yang dapat diulang.
- Bug kompatibilitas lama tidak diperbaiki bersamaan dengan port. Catat dan
  perbaiki setelah parity agar sumber regresi mudah ditemukan.

## Struktur target

```text
web/
  src/
    app/                 # routing, shell, error boundary
    components/          # komponen UI reusable
    features/
      import-midi/
      song-editor/
      track-editor/
      keymaps/
      player/
      settings/
    lib/
      wasm/              # adapter WASM bertipe
      audio/             # Web Audio + scheduler
      storage/           # LocalStorage/IndexedDB
    workers/             # Web Worker untuk converter
  public/
    soundfonts/
  tests/
wasm/
  Cargo.toml
  src/lib.rs             # facade wasm-bindgen
```

Core domain tetap berada di crate `lib`; crate `wasm` hanya menjadi adapter.

## Checkpoint 0 — Bekukan baseline

**Goal:** mempunyai oracle yang dapat membuktikan bahwa hasil web tidak berubah.

Pekerjaan:

- Pastikan tujuh MIDI di `assets/` mempunyai golden fixture lengkap.
- Jalankan seluruh unit test dan e2e Rust pada toolchain yang dipin.
- Simpan output tiap track, metadata instrumen, options, dan note length.
- Dokumentasikan bug legacy yang sengaja dipertahankan.
- Tambahkan checksum fixture dan perintah reproduksi.

Kriteria lulus:

- Baseline dapat dibuat ulang dengan satu command.
- Semua fixture memiliki output deterministik.
- Tidak ada perubahan algoritma converter pada checkpoint ini.

## Checkpoint 1 — Siapkan workspace web

**Goal:** memperoleh skeleton React yang dapat dibangun dan diuji secara lokal.

Pekerjaan:

- Buat React + TypeScript + Vite di `web/`.
- Pasang linting, formatting, unit test, dan browser test.
- Tambahkan CI untuk build Rust, WASM, dan web.
- Tetapkan supported browser dan batas ukuran bundle.
- Tambahkan halaman shell, loading, dan error boundary.

Kriteria lulus:

- Type-check, lint, test, dan production build lulus.
- Preview production dapat dibuka tanpa backend.
- Tidak ada perubahan pada aplikasi lama.

## Checkpoint 2 — Jadikan core Rust kompatibel dengan WASM

**Goal:** core converter dapat dikompilasi untuk native dan `wasm32` tanpa
mengubah output.

Pekerjaan:

- Pisahkan `from_bytes` dari pembacaan filesystem `from_path`.
- Buat fallback sekuensial untuk penggunaan `rayon` dan `num_cpus` di WASM.
- Isolasi audio/native dependencies dari crate converter.
- Tambahkan target WASM ke CI.
- Pertahankan jalur native untuk menjalankan oracle parity.

Kriteria lulus:

- Native test lama tetap lulus.
- Core berhasil dibangun untuk target WASM.
- Golden output sebelum dan sesudah perubahan identik.

## Checkpoint 3 — Buat API WASM yang stabil

**Goal:** frontend mempunyai kontrak bertipe untuk seluruh operasi song.

API minimal:

- `loadSong(bytes, options)`
- `updateOptions(options)`
- `splitTrack(index)`
- `mergeTracks(indexA, indexB)`
- `equalizeTracks(indexA, indexB)`
- `renameTrack(index, name)`
- `applyKeymap(trackIndex, mapping)`
- `getSongSnapshot()`

Pekerjaan:

- Tambahkan facade `wasm-bindgen` yang tipis.
- Definisikan schema response dan error yang versioned.
- Validasi semua integer dan indeks di boundary.
- Hasilkan atau tulis definisi TypeScript untuk kontrak publik.
- Jangan mengekspos pointer/struktur internal Rust ke UI.

Kriteria lulus:

- Seluruh operasi dapat dipanggil dari test browser headless.
- Invalid input menghasilkan error terstruktur, bukan panic.
- Snapshot WASM identik dengan golden fixture native.

## Checkpoint 4 — Pindahkan converter ke Web Worker

**Goal:** file MIDI besar tidak membuat UI browser macet.

Pekerjaan:

- Muat WASM di dedicated Web Worker.
- Buat typed request/response protocol dengan request ID.
- Implementasikan loading, cancellation semu, timeout UI, dan recovery worker.
- Hindari menyalin byte berulang; gunakan transferable `ArrayBuffer`.

Kriteria lulus:

- Import dan operasi track tidak memblokir interaksi UI.
- Worker dapat pulih setelah input invalid/panic.
- Semua parity test tetap lulus melalui worker boundary.

## Checkpoint 5 — Port UI converter dan editor

**Goal:** seluruh workflow editing non-audio tersedia di web.

Pekerjaan:

- Import lewat file picker dan drag-and-drop.
- Port daftar/tab track, nama, instrumen, note length, dan MML.
- Port song options, split, merge, equalize, rename, dan keymap.
- Tambahkan copy serta export MML/project.
- Buat state UI terpisah dari state domain milik WASM.
- Pertahankan shortcut keyboard yang relevan.

Kriteria lulus:

- Semua operasi dari kontrak `SongActor` lama tersedia.
- Hasil operasi UI sama dengan aplikasi lama untuk fixture yang sama.
- Refresh tidak menyebabkan state setengah tersimpan atau corrupt.
- UI dasar responsif pada desktop dan mobile browser.

## Checkpoint 6 — Storage lokal dan format project

**Goal:** pengguna dapat melanjutkan pekerjaan tanpa akun/backend.

Pekerjaan:

- LocalStorage untuk preferensi kecil.
- IndexedDB untuk project dan keymap.
- Format file project versioned untuk import/export dan backup manual.
- Migrasi schema lokal dan penanganan data rusak.
- Tombol clear data dengan konfirmasi dan informasi dampaknya.

Kriteria lulus:

- Project dapat dipulihkan setelah browser ditutup/dibuka.
- Export lalu import menghasilkan snapshot identik.
- Versi schema lama dapat dimigrasikan atau ditolak dengan pesan yang jelas.

## Checkpoint 7 — Player browser dan highlighting

**Goal:** playback menggantikan `lib_player` untuk kebutuhan web.

Pekerjaan:

- Tentukan apakah player membaca event terstruktur dari Rust atau MML hasil
  parser; utamakan event terstruktur agar tidak parse dua kali.
- Implementasikan scheduler berbasis Web Audio clock.
- Muat SoundFont secara lazy dan tampilkan progress/error.
- Port play, pause, stop, tempo change, pergantian instrumen, dan multi-track.
- Emit posisi karakter untuk highlighted MML.
- Tangani aturan autoplay browser dan suspend/resume audio context.

Kriteria lulus:

- Ketujuh fixture dapat dimainkan hingga selesai tanpa drift yang terlihat.
- Play/pause/stop deterministik dan tidak meninggalkan note menggantung.
- Highlight sesuai note yang sedang berbunyi.
- Pergantian tempo dan instrumen terdengar pada posisi yang benar.

## Checkpoint 8 — Hardening dan quality gate

**Goal:** aplikasi siap digunakan publik tanpa regresi kritis.

Pekerjaan:

- Tambahkan unit, integration, browser, dan accessibility test.
- Uji MIDI kosong, rusak, besar, SMPTE, note tanpa note-off, dan channel drum.
- Ukur waktu load, convert, memory, ukuran JS/WASM/SoundFont, dan audio drift.
- Tambahkan Content Security Policy dan dependency audit.
- Pastikan error tidak menyertakan isi MIDI pengguna.
- Uji Chrome, Edge, Firefox, dan Safari versi yang ditetapkan.

Kriteria lulus:

- Seluruh test dan parity matrix lulus di CI.
- Tidak ada panic, UI freeze, atau unhandled rejection pada corpus uji.
- Accessibility dan performance budget yang disepakati terpenuhi.
- Aplikasi tetap berfungsi tanpa network setelah aset PWA tersimpan, bila mode
  offline dipilih.

## Checkpoint 9 — Preview Vercel

**Goal:** build production tervalidasi di lingkungan hosting sebenarnya.

Pekerjaan:

- Hubungkan repository ke Vercel.
- Konfigurasikan build Vite dan artifact WASM.
- Atur MIME WASM, cache headers, SPA fallback, security headers, dan asset paths.
- Deploy preview, lalu jalankan smoke test terhadap URL preview.
- Verifikasi ukuran serta caching SoundFont.

Kriteria lulus:

- Import, convert, edit, playback, save, dan export lulus di preview URL.
- Reload deep link dan update versi tidak merusak cache WASM.
- Tidak ada Vercel Function; deployment merupakan static assets.

## Checkpoint 10 — Cutover produksi

**Goal:** versi web menjadi implementasi utama yang dapat dirilis dengan aman.

Pekerjaan:

- Bekukan release candidate dan lakukan acceptance test manual.
- Deploy production ke subdomain `.vercel.app`.
- Dokumentasikan penggunaan, privasi lokal, browser support, dan known issues.
- Tandai aplikasi Flutter/Rust native sebagai legacy, tetapi jangan langsung
  hapus sampai masa observasi selesai.
- Buat rollback procedure ke deployment Vercel sebelumnya.

Kriteria lulus:

- Production smoke test lulus.
- Versi, changelog, dan source commit dapat dilacak.
- Rollback pernah diuji.
- Tidak ada blocker parity P0/P1 yang terbuka.

## Checkpoint 11 — Cleanup pasca-stabilisasi

**Goal:** mengurangi beban maintenance setelah web terbukti stabil.

Pekerjaan:

- Putuskan masa dukungan aplikasi native lama.
- Arsipkan atau hapus Flutter, native hub, dan native player hanya melalui PR
  terpisah yang mudah di-rollback.
- Rapikan CI, dokumentasi, fixture, dan dependency yang tidak digunakan.
- Pertahankan native test harness Rust jika masih berguna sebagai oracle.

Kriteria lulus:

- Web telah stabil selama periode observasi yang disepakati.
- Tidak ada fitur aktif yang hanya tersedia di aplikasi lama.
- Repository bersih dari dependency mati dan build tetap reproducible.

## Urutan dependency checkpoint

```text
C0 Baseline
  -> C1 Web skeleton
  -> C2 WASM-compatible core
  -> C3 Stable WASM API
  -> C4 Web Worker
  -> C5 Editor UI
       -> C6 Local storage
       -> C7 Player + highlighting
  -> C8 Hardening
  -> C9 Vercel preview
  -> C10 Production cutover
  -> C11 Legacy cleanup
```

C6 dan C7 boleh dikerjakan paralel setelah C5, tetapi keduanya wajib selesai
sebelum C8.

## Definition of done keseluruhan

- Output converter dan operasi track lolos seluruh fixture parity.
- Feature set GUI lama yang masih relevan tersedia di web.
- Playback dan highlighting berfungsi di browser yang didukung.
- Data diproses lokal dan aplikasi tidak membutuhkan backend.
- Production tersedia di URL `.vercel.app` dengan build reproducible.
- Dokumentasi penggunaan, pengembangan, deployment, known issues, dan rollback
  tersedia.

