# Rental Kamping — Website + Panel Admin + REST API

Website penyewaan peralatan kamping dengan sisi **pelanggan**, **panel admin pemilik**, dan **REST API** yang sama-sama dipakai website dan bisa langsung dipakai **aplikasi mobile** (Android/iOS/Flutter/React Native).

## Fitur

**Pelanggan** (`/`)
- Katalog barang: foto, harga sewa per hari, jumlah stok & **stok tersedia sesuai tanggal sewa**
- Filter kategori & pencarian
- Daftar / login akun, edit data diri (nama, HP, No. KTP, alamat), ganti password
- Keranjang + **form sewa** (tanggal ambil/kembali, ambil di toko / diantar, catatan), total otomatis
- "Pesanan saya": status booking, status pembayaran, sisa tagihan, batalkan pesanan
- Ulasan & testimoni (tampil setelah disetujui admin)
- Kontak (WhatsApp, telepon, email, Instagram), form kirim pesan, **lokasi Google Maps**
- **Chatbot** bantuan: cek stok & harga, cara sewa, pembayaran, lokasi, jam buka

**Admin / pemilik** (`/admin`)
- Dashboard: uang masuk hari ini/bulan ini, grafik 6 bulan, total tunggakan, booking menunggu, barang sedang disewa & terlambat, jadwal ambil/kembali hari ini
- **Daftar booking**: konfirmasi → barang diambil → dikembalikan / batal, denda telat otomatis, catat pembayaran (DP/lunas), buat booking untuk pelanggan offline/WhatsApp
- **Uang masuk**: per periode & metode bayar, unduh CSV
- **Pembayaran nunggak**: sisa tagihan, lama tunggakan, tombol pengingat WhatsApp
- **Database peralatan**: tambah/edit/arsip barang, upload foto, harga, stok
- **Keluar / masuk barang**: otomatis tercatat saat barang disewa & kembali; catat manual pembelian, rusak, hilang
- **Maintenance**: unit yang dirawat otomatis tidak bisa disewa sampai selesai, catat biaya
- **Database pelanggan**: data diri, riwayat sewa, total bayar, tunggakan, catatan internal
- Moderasi ulasan, kotak pesan, dan **pengaturan** (nama usaha, alamat, peta, WA, rekening, denda, minimal hari sewa)

## Menjalankan

Butuh **Node.js 22.5+** (memakai SQLite bawaan Node, tanpa instal database terpisah).

```bash
npm install
npm start            # http://localhost:3000  dan  http://localhost:3000/admin
npm test             # tes otomatis alur utama
```

Akun awal:

| Peran | Email | Password |
|---|---|---|
| Admin | `admin@rental.local` | `admin123` |
| Pelanggan demo | `budi@contoh.com` | `pelanggan123` |

> **Ganti password admin sebelum dipakai sungguhan.** Atur lewat variabel `ADMIN_EMAIL` & `ADMIN_PASSWORD` *sebelum* pertama kali dijalankan (akun dibuat sekali saat database kosong).

Data demo (2 pelanggan, 4 booking) dibuat pada run pertama agar dashboard langsung terisi. Untuk mulai dengan katalog saja tanpa transaksi demo: `SEED_DEMO=0 npm run seed`. Untuk mengosongkan & mengisi ulang database: `npm run seed`.

### Variabel lingkungan

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port server |
| `DB_FILE` | `data/rental.db` | Lokasi file database |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@rental.local` / `admin123` | Akun admin awal |
| `SEED_DEMO` | `1` | `0` = tanpa transaksi demo |
| `CORS_ORIGIN` | `*` | Batasi domain yang boleh memanggil API |
| `ANTHROPIC_API_KEY` | – | Opsional. Jika diisi, chatbot memakai AI Claude |
| `CHATBOT_MODEL` | `claude-opus-5-5` | Model AI untuk chatbot |

### Chatbot

Tanpa API key, chatbot tetap berfungsi dengan jawaban otomatis yang membaca **stok & harga langsung dari database** (contoh: "tenda 4 orang ada?", "cara sewa", "bayar ke mana?").
Jika `ANTHROPIC_API_KEY` diisi, chatbot memakai Claude (effort rendah agar cepat & hemat) dengan konteks katalog, harga, stok hari ini, dan info usaha terbaru dari Pengaturan. Bila AI menolak atau sedang error, otomatis kembali ke jawaban aturan.

## Struktur

```
server.js            Server Express (website + API)
src/db.js            Skema database SQLite
src/services.js      Logika stok, booking, denda, pembayaran
src/routes.js        Semua endpoint REST API
src/chatbot.js       Chatbot (aturan + Claude opsional)
src/seed.js          Data awal
public/              Website pelanggan (index.html) & admin (admin/)
test/                Tes otomatis
```

## Integrasi aplikasi mobile (REST API)

Basis URL: `https://domain-anda/api`. Semua request/response JSON. Untuk endpoint yang butuh login, kirim header
`Authorization: Bearer <token>` (token didapat dari login/daftar, berlaku 30 hari). Error selalu berbentuk `{ "error": "pesan" }`.

### Publik
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/info` | Info usaha, kontak, rating rata-rata |
| GET | `/equipment?start=YYYY-MM-DD&end=YYYY-MM-DD&category=&q=` | Katalog + `available` untuk rentang tanggal |
| GET | `/equipment/:id?start=&end=` | Detail barang |
| GET | `/categories` | Daftar kategori |
| GET | `/reviews` | Ulasan yang disetujui |
| POST | `/contact` | `{ name, contact, message }` |
| POST | `/chat` | `{ message, history?: [{role, content}] }` → `{ reply, source }` |
| POST | `/quote` | `{ start_date, end_date, items:[{equipment_id, qty}] }` → estimasi biaya & cek stok |

### Akun pelanggan
| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/auth/register` | `{ name, email, phone, password, id_number?, address? }` → `{ token, user }` |
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` |
| POST | `/auth/logout` | 🔒 |
| GET / PUT | `/me` | 🔒 Lihat / ubah data diri (`current_password` + `new_password` untuk ganti password) |
| POST | `/bookings` | 🔒 `{ start_date, end_date, items:[{equipment_id, qty}], pickup_method: "ambil"\|"antar", notes? }` |
| GET | `/bookings`, `/bookings/:id` | 🔒 Pesanan saya (termasuk `paid`, `balance`, `payment_status`) |
| POST | `/bookings/:id/cancel` | 🔒 Batalkan (selama belum diambil) |
| POST | `/reviews` | 🔒 `{ rating: 1-5, comment }` |

### Admin (🔒 akun role admin), prefix `/admin`
`GET /dashboard` ·
`GET|POST /equipment`, `PUT|DELETE /equipment/:id` (multipart, field foto `image`) ·
`GET|POST /stock-movements` (`{ equipment_id, direction: "masuk"|"keluar", qty, reason }`) ·
`GET|POST /maintenance`, `PUT|DELETE /maintenance/:id` ·
`GET|POST /bookings`, `GET /bookings/:id`, `POST /bookings/:id/status` (`{ status, late_fee? }`), `POST /bookings/:id/payments` (`{ amount, method, note }`) ·
`GET /payments?from=&to=`, `DELETE /payments/:id` · `GET /outstanding` ·
`GET|POST /customers`, `GET|PUT /customers/:id` ·
`GET /reviews`, `PUT|DELETE /reviews/:id` · `GET /messages`, `PUT /messages/:id` · `GET|PUT /settings`

Alur status booking: `menunggu → dikonfirmasi → diambil → dikembalikan` (atau `dibatalkan` sebelum diambil). Saat **diambil** dan **dikembalikan**, catatan keluar/masuk barang dibuat otomatis. Denda telat = hari terlambat × tarif harian × `late_fee_percent`%.

## Hosting

Bisa dijalankan di VPS / server apa pun yang mendukung Node.js (mis. dengan `pm2 start server.js`) di belakang Nginx + HTTPS. Simpan folder `data/` (database) dan `public/uploads/` (foto produk) secara permanen dan backup berkala.
