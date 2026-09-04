# Arah Refactor Versi Web

Status: catatan keputusan awal; implementasi belum dimulai.

## Sasaran

Membangun ulang Revelation MIDI-to-MML sebagai aplikasi web. Dukungan aplikasi
native lintas platform tidak menjadi persyaratan utama.

## Keputusan teknologi

- Hosting menggunakan Vercel dengan alamat bawaan `.vercel.app`.
- Frontend menggunakan React + TypeScript + Vite.
- Core converter Rust yang sudah ada dipertahankan dan dikompilasi menjadi
  WebAssembly (WASM). API filesystem dan paralelisme native diganti dengan API
  berbasis byte dan eksekusi sekuensial yang kompatibel dengan browser.
- Playback menggunakan Web Audio API dan berjalan sepenuhnya di browser.
- File MIDI, keymap, dan konfigurasi diproses secara lokal di browser; backend
  tidak diperlukan untuk versi pertama.
- Pengaturan pengguna disimpan di LocalStorage atau IndexedDB.

## Catatan penting

Arsitektur ini dipilih untuk meminimalkan risiko refactor. Menulis ulang core ke
Python atau TypeScript akan menggandakan risiko perbedaan hasil konversi,
sedangkan WASM memungkinkan mayoritas implementasi dan test Rust dipertahankan.
React/TypeScript digunakan hanya untuk lapisan UI dan integrasi browser.

`rayon`, `num_cpus`, pembacaan path, dan bagian audio native tidak dibawa ke
browser. Core menerima MIDI sebagai `Uint8Array`, lalu mengembalikan data yang
aman diserialisasi. Fixture parity yang sudah tersedia menjadi gerbang sebelum
UI lama diganti. Flutter dan native player baru dihapus setelah converter,
operasi track, player web, dan UI mencapai feature parity.

## Alasan keputusan

- Tidak ada server Python, database, atau proses upload yang perlu dirawat.
- Tidak terkena batas payload dan cold start Vercel Functions.
- File pengguna tidak meninggalkan browser.
- Logika converter Rust yang sudah teruji tidak perlu ditulis ulang sekaligus.
- Hasil build berupa aset statis yang sederhana untuk di-host di Vercel.
