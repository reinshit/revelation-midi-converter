# Roadmap Aktif: Refactor ke EXE Windows

## Keputusan produk

Target aktif hanya **Windows x64**. Web/WASM telah dikeluarkan dari produk dan
tidak boleh menambah dependency, abstraksi, atau pekerjaan pada jalur kritis.
Core tetap dipisahkan dari UI untuk maintainability dan pengujian.

Stack target:

```text
Slint native UI
       |
Rust application/controller
       |
reve-core + reve-player
       |
MIDI converter + CPAL/OxiSynth
```

Slint dipilih karena UI deklaratifnya cocok untuk editor desktop, dapat memanggil
Rust secara langsung, dan tidak memerlukan Flutter engine, Dart runtime, browser
engine, JavaScript, Rinf, atau IPC command layer. SoundFont dipaketkan sebagai
resource eksternal agar EXE utama tetap kecil dan resource dapat diganti tanpa
rebuild.

## Prinsip checkpoint

- Checkpoint dikerjakan berurutan.
- Setiap checkpoint harus memiliki bukti tes dan pengukuran sebelum ditutup.
- Aplikasi Flutter lama tetap buildable sampai installer baru lolos beta.
- Perubahan algoritma tidak dicampur dengan migrasi UI.
- Jika parity gagal, hentikan port UI dan perbaiki core/fixture terlebih dahulu.
- Ukuran yang dinilai adalah installer, installed footprint, EXE/DLL, dan resource
  SoundFont secara terpisah.

## Checkpoint 0 — Baseline dan golden data

Pekerjaan:

- Siapkan Rust/Flutter toolchain yang reproducible.
- Jalankan seluruh tes `midi-to-mml` dan `lib_player`.
- Tambahkan exporter JSON untuk bridge events, final events, dan MML.
- Export hasil tujuh MIDI fixture beserta seluruh kombinasi opsi penting.
- Bangun Flutter Windows release sebagai baseline.
- Ukur ukuran installer/installed files, cold-start, idle memory, peak memory,
  waktu konversi, dan waktu mulai playback.

Gate:

- Semua tes lama hijau.
- Seluruh fixture memiliki SHA-256 dan golden output.
- Baseline dapat dibuat ulang dengan satu script/command.

Deliverable:

- `fixtures/parity/*.json`
- `docs/metrics/flutter-windows-baseline.json`

## Checkpoint 1 — Prototype Slint Windows

Pekerjaan:

- Scaffold `apps/windows` dengan Rust + Slint tanpa menghapus `gui`.
- Implementasikan pilih file MIDI, convert, dan tampilkan MML satu track.
- Hubungkan callback Slint langsung ke controller Rust.
- Bandingkan renderer Slint yang layak untuk Windows melalui ukuran dan stabilitas.
- Buat release build dan ukur EXE, DLL/resource, startup, serta memory.

Gate:

- Satu fixture menghasilkan MML identik dengan aplikasi lama.
- Release build berjalan pada mesin Windows bersih yang disepakati.
- Tidak ada dependency web/browser pada aplikasi baru.
- Hasil pengukuran membuktikan Slint layak dilanjutkan.

## Checkpoint 2 — Rapikan core tanpa mengubah perilaku

Pekerjaan:

- Ekstrak/rename `lib` menjadi `crates/reve-core`.
- Pertahankan `from_bytes`; tempatkan filesystem helper di adapter native.
- Definisikan error terstruktur dan hilangkan panic pada input pengguna.
- Pisahkan model, MIDI ingestion, bridge transform, quantization, dan renderer.
- Pertahankan algoritma legacy sampai golden parity 100%.
- Dokumentasikan bug B01–B10 dari `python-refactor-analysis.md` sebagai backlog,
  bukan diperbaiki diam-diam.

Gate:

- Golden output seluruh fixture identik.
- Tes unit dan integration core hijau.
- Core tidak bergantung pada Flutter, Rinf, Slint, atau player.

## Checkpoint 3 — Controller dan state Windows

Pekerjaan:

- Buat `SongSession` milik backend sehingga data MIDI tidak bolak-balik ke UI.
- Controller action wajib: load, get status, update options, split, merge,
  equalize, rename, apply keymap, copy/export MML, dan close session.
- Slint hanya menerima view-model sederhana; model domain tidak bocor ke UI.
- Validasi index, range velocity, `smallest_unit`, ukuran file, dan tipe timing.
- Pekerjaan konversi berat dijalankan di luar UI thread.

Gate:

- Contract test seluruh controller action hijau.
- Error pengguna tidak menyebabkan panic/crash.
- Respons operasi dan urutan track cocok dengan aplikasi lama.

## Checkpoint 4 — Port workflow converter

Pekerjaan:

- Import melalui file picker dan drag/drop.
- Track list/tab, rename, split, merge, dan equalize.
- Song options dan apply keymap.
- MML viewer yang efisien untuk string panjang.
- Copy satu track, copy seluruh hasil, dan export ke file.
- Status bar, progress, toast/error detail, dan persistence pengaturan.

Gate:

- Semua workflow non-audio versi Flutter tersedia.
- Tujuh fixture dapat diproses tanpa UI freeze yang terasa.
- Keyboard navigation dan label accessibility dasar tersedia.
- Tidak ada regresi golden parity.

## Checkpoint 5 — Port player native

Pekerjaan:

- Rapikan `lib_player` menjadi `crates/reve-player`.
- Bungkus CPAL/OxiSynth di balik service player native.
- Load/ganti SoundFont, play, pause, stop, dan reset.
- Kirim note-on/track-end events ke frontend untuk highlight.
- Pastikan stop/error selalu mengirim all-notes-off.
- Hindari menyalin SoundFont ke lebih dari satu lokasi bundle.

Gate:

- Ketujuh fixture dapat dimainkan, pause, resume, dan stop.
- Tidak ada stuck note setelah stop, reload, atau error.
- Highlight tetap sinkron dalam toleransi yang ditetapkan.
- Audio callback tidak melakukan alokasi/pekerjaan blocking yang tidak aman.

## Checkpoint 6 — Feature dan visual parity

Pekerjaan:

- Port settings, keymap manager, status detail, soundfont configuration, dialog,
  serta shortcut.
- Petakan seluruh halaman/fitur Flutter ke checklist baru.
- Tambahkan screenshot regression untuk state utama.
- Uji DPI scaling 100/125/150/200%, resize, dark/light mode bila didukung, dan
  nama/path Unicode.

Gate:

- Checklist fitur lama 100% atau pengecualian disetujui dan didokumentasikan.
- Tidak ada clipping pada DPI yang diuji.
- Workflow utama selesai tanpa membuka log/developer tools.

## Checkpoint 7 — Optimasi ukuran dan performa

Pekerjaan:

- Audit Cargo features, frontend packages, gambar, font, dan resource.
- Aktifkan release profile berikut setelah error path teruji:

  ```toml
  [profile.release]
  opt-level = "z"
  lto = true
  codegen-units = 1
  panic = "abort"
  strip = "symbols"
  ```

- Bandingkan renderer/backend Slint berdasarkan hasil build.
- Lazy-load halaman/fitur yang berat.
- Pisahkan ukuran `app`, runtime WebView2 yang diperlukan, dan SoundFont.
- Benchmark converter sebelum dan sesudah setiap optimasi ukuran.

Target sementara, dikunci ulang setelah Checkpoint 0:

- output MML 100% parity;
- startup tidak lebih lambat dari Flutter baseline;
- bundle aplikasi tanpa SoundFont lebih kecil dari baseline;
- konversi fixture terbesar maksimal 2 detik pada mesin baseline;
- UI tidak terblokir lebih dari 100 ms;
- tidak ada optimasi yang memperlambat konversi lebih dari 20% tanpa persetujuan.

Gate:

- Size budget dan performance budget tercapai.
- Semua golden, integration, dan playback test tetap hijau.

## Checkpoint 8 — Hardening dan installer

Pekerjaan:

- Batasi filesystem hanya pada file yang dipilih pengguna dan lokasi ekspor.
- Jangan memuat resource atau kode executable dari jaringan.
- Batasi ukuran MIDI, jumlah event, dan resource consumption.
- Fuzz MIDI parser serta MML parser.
- Buat installer Windows, uninstall flow, upgrade test, dan code signing bila
  certificate tersedia.
- Uji instalasi pada Windows 10/11 x64 dan akun tanpa hak administrator bila
  metode installer mengizinkan.

Gate:

- Input rusak tidak menyebabkan crash atau resource exhaustion yang tidak wajar.
- Install, update, dan uninstall lolos pada matriks mesin target.
- Installer dari tag release dapat direproduksi CI.

## Checkpoint 9 — Beta, cutover, dan cleanup

Pekerjaan:

- Rilis beta berdampingan dengan versi Flutter.
- Bandingkan output fixture dan laporan file pengguna yang gagal secara lokal.
- Pertahankan rollback tag dan installer versi lama.
- Setelah dua rilis stabil, jadikan versi Slint sebagai versi utama.
- Hapus Flutter/Rinf hanya dalam PR terpisah setelah cutover disetujui.
- Arsipkan metrik akhir dan perbandingan sebelum/sesudah.

Gate:

- Tidak ada perbedaan output kritis yang belum dijelaskan.
- Tidak ada crash/blocker rilis yang terbuka.
- Rollback telah diuji.
- Dua rilis stabil selesai sebelum penghapusan stack lama.

## Urutan PR

1. `test: freeze Windows baseline and parity fixtures`
2. `chore: add minimal Slint Windows spike`
3. `refactor: extract reve-core without behavior changes`
4. `feat: add Windows song controller and session API`
5. `feat: port Windows converter workflow`
6. `refactor: extract and integrate native player`
7. `feat: complete Windows feature and visual parity`
8. `perf: enforce Windows size and performance budgets`
9. `release: package and beta-test Windows installer`
10. `chore: retire Flutter after stability window`

## Definition of done

- Tersedia installer EXE/MSI Windows yang reproducible.
- Converter dan player berjalan sepenuhnya offline.
- Hasil MML lolos seluruh golden fixture.
- Semua fitur utama versi lama tersedia.
- Ukuran dan performa memenuhi budget hasil baseline.
- Aplikasi lama masih dapat di-rollback sampai dua rilis baru stabil.

## Di luar scope

Web, WASM, mobile, Python runtime, Tauri, dan frontend JavaScript tidak termasuk
roadmap ini. Dukungan tersebut hanya boleh dibuka kembali melalui keputusan
arsitektur baru setelah produk Windows stabil.
