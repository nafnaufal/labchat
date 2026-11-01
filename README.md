# LabChat

Aplikasi chat Android pribadi untuk [Surplus Intelligence](https://www.surplusintelligence.ai) — pengganti aplikasi ChatGPT/Claude yang memakai API key Surplus kamu sendiri. Dibuat dengan Expo SDK 58 (React Native), Expo Router, dan SQLite lokal.

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

> **Catatan:** LabChat saat ini **hanya mendukung Surplus Intelligence sebagai penyedia** — tidak ada dukungan untuk OpenAI, Zhipu AI, atau penyedia lain. Masukkan buyer key Surplus (`inf_…`) di Setelan untuk mulai chat. LabChat adalah proyek independen dan **tidak berafiliasi dengan Surplus Intelligence**.

## Fitur

- **Chat streaming** ala ChatGPT — jawaban muncul kata demi kata, bisa dihentikan kapan saja.
- **Navigasi tanpa bottom bar** — semua navigasi ada di drawer kiri (tombol ☰ di tiap layar): tombol **Chat baru** dan riwayat percakapan di atas, item nav **Chat / Cari Model / Setelan** terpasang di bawah drawer. Drawer bisa dibuka lewat **geser kanan dari tepi kiri layar** dan ditutup lewat **geser kiri di panelnya** (ketuk backdrop juga menutup). Tab Chat langsung membuka chat baru (belum ada yang tersimpan sampai pesan pertama terkirim); state tiap section tetap hidup saat berpindah (streaming tetap jalan di belakang).
- **Harga pasar live** — Cari Model mengambil ask termurah `/api/markets` (publik) yang sudah net diskon, **diurut dari diskon terbesar**; estimasi biaya chat & generate gambar juga memakai harga pasar ini (fallback: harga referensi × floor diskon, cache 5 menit).
- **Rewind di tempat** — tekan lama gelembung pesanmu untuk memuat ulang prompt itu ke input (banner rewind muncul), edit sesukamu, lalu kirim: semua pesan sesudahnya dihapus dan jawaban baru ditulis di chat yang sama.
- **Branch dari balasan** — ikon cabang di tiap balasan AI (dengan dialog konfirmasi) menyalin chat sampai balasan itu ke percakapan baru berjudul `branch - Judul Lama`; lanjutkan dari sana, chat asal tidak berubah. Branch dari branch menambah prefix lagi (mis. `branch - branch - ...`).
- **Model per chat dipilih dari daftar** — pilih model tersimpan saat chat; model default bisa diatur di Setelan atau di detail model.
- **Estimasi biaya** per pesan dan total per percakapan — token usage × harga efektif setelah diskon `min{N}` dari Base URL.
- **Lampirkan gambar (vision)** — tombol 📷 muncul hanya untuk model dengan badge VISION (kapabilitas dari `GET /v1/models` publik); pilih beberapa gambar sekaligus (maks 4), otomatis di-resize ke ≤1568px JPEG sebelum dikirim sebagai content part. Konteks riwayat juga dibatasi 4 gambar terakhir.
- **Generate gambar** — model berbadge IMAGE GEN menjawab lewat `POST /v1/images/generations`: tulis prompt, hasilnya tersimpan lokal, ketuk untuk lihat fullscreen. Biaya dihitung per gambar.
- **Custom Instructions** global (seperti AGENTS.md) di Setelan, plus override per percakapan lewat menu di dalam chat.
- **Penyimpanan bisa diatur** — statistik penyimpanan, hapus semua percakapan, reset total data.
- **API key disimpan aman** di SecureStore perangkat; hanya dikirim ke Surplus saat request.

## Menjalankan

```bash
npm install
node_modules\.bin\expo.cmd start
```

Lalu buka aplikasi **Expo Go** di HP (satu jaringan Wi-Fi dengan PC) dan masukkan URL:
`exp://<IP-PC>:8081`

> Catatan: di mesin dengan `allow-scripts` di `~/.npmrc` (npm 12), `npx expo install` gagal dengan `EALLOWSCRIPTS`.
> Pakai `node_modules\.bin\expo.cmd install <paket>` untuk menambah dependensi.

## Setup pertama kali di aplikasi

1. Buka drawer **☰** → **Setelan** → isi **API Key** (buyer key `inf_…` dari surplusintelligence.ai) → **Uji koneksi**. Opsional: atur **Diskon minimum** (mis. min99) — semua request otomatis dikirim lewat `/minN`, berlaku langsung untuk request berikutnya.
2. Tab **Cari Model** → cari model yang mau dipakai → ketuk **+** untuk menambahkannya ke daftar (atau ketuk barisnya untuk buka detail).
3. Di detail model: jadikan default, atau hapus dari daftar kapan saja.
4. Buka **☰** → bagian bawah drawer untuk pindah antar **Chat / Cari Model / Setelan**. Di Chat: ketuk judul untuk ganti model, ☰ untuk riwayat + **Chat baru**.

## Struktur

```
src/
  app/                # Route (Expo Router): index (shell + drawer) model/[id]
  screens/            # Isi layar: chat, browse, model-detail, settings
  components/         # UI: app-shell + app-drawer (navigasi), markdown, chat (bubble, input, modal, picker), ui (icon, header, dialog)
  lib/                # db (SQLite), api (SSE streaming + /v1/prices + /v1/models + image gen), images (picker/resize/simpan), settings, format, types
  constants/theme.ts  # Warna light/dark + font
```
