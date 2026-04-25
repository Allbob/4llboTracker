# 🤖 4llboTracker Discord Bot

Bot Discord untuk monitoring server FiveM secara real-time, terintegrasi dengan **4llboTracker**.

---

## ✨ Fitur Bot

| Command | Fungsi |
|---|---|
| `/cek [server]` | Cek status & info server FiveM |
| `/pemain [server]` | Lihat daftar pemain yang online |
| `/monitor [server]` | Pantau server otomatis (notif offline/online) |
| `/stopmonitor [server]` | Hentikan pemantauan server |
| `/daftarmonitor` | Lihat semua server yang dipantau |
| `/cariserver [nama]` | Cari server FiveM berdasarkan nama |
| `/help` | Tampilkan bantuan |

---

## 🚀 Cara Setup (Step by Step)

### Step 1 — Install Node.js
Download dan install dari: https://nodejs.org (pilih versi **LTS**)

Setelah install, buka terminal dan cek:
```
node --version
npm --version
```

---

### Step 2 — Buat Bot Discord

1. Buka https://discord.com/developers/applications
2. Klik **"New Application"** → beri nama (contoh: `4llboTracker`)
3. Masuk ke tab **"Bot"** → klik **"Add Bot"**
4. Di bagian **Token** → klik **"Reset Token"** → **Copy token-nya**
5. Di bagian **Privileged Gateway Intents**, aktifkan:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Masuk ke tab **"OAuth2"** → **"URL Generator"**
7. Centang scope: `bot` dan `applications.commands`
8. Centang permission: `Send Messages`, `Embed Links`, `Use Slash Commands`
9. Copy URL yang muncul → buka di browser → tambahkan bot ke server Discord kamu

---

### Step 3 — Siapkan File .env

Salin `.env.example` menjadi `.env`:
```
copy .env.example .env
```

Edit file `.env` dan isi dengan data kamu:
```env
DISCORD_TOKEN=token_bot_discord_kamu
GUILD_ID=id_server_discord_kamu
MONITOR_CHANNEL_ID=id_channel_untuk_notifikasi
MONITOR_INTERVAL_MINUTES=5
```

**Cara dapat Guild ID:**
- Aktifkan Developer Mode di Discord (Settings → Advanced → Developer Mode)
- Klik kanan nama server Discord kamu → **Copy Server ID**

**Cara dapat Channel ID:**
- Klik kanan channel yang ingin dijadikan tempat notifikasi → **Copy Channel ID**

---

### Step 4 — Install Dependencies & Jalankan Bot

Buka terminal di folder `bot/`, lalu:

```bash
# Masuk ke folder bot
cd bot

# Install semua package
npm install

# Jalankan bot
npm start
```

Jika berhasil, terminal akan menampilkan:
```
🚀 Menghidupkan 4llboTracker Bot...
🎮 4llboTracker Bot Online!
👤 Login sebagai: 4llboTracker#1234
📡 Terhubung ke 1 server Discord
✅ Slash commands berhasil didaftarkan
```

---

## 📌 Cara Pakai

### Cek Server
```
/cek cfx.re/join/abc123
/cek 127.0.0.1:30120
```

### Lihat Pemain
```
/pemain cfx.re/join/abc123
```

### Monitor Otomatis
```
/monitor cfx.re/join/abc123
```
Bot akan kirim notifikasi ke channel jika server offline atau kembali online.

---

## 🗂️ Struktur File

```
bot/
├── bot.js          ← File utama bot
├── package.json    ← Daftar dependensi
├── .env.example    ← Contoh konfigurasi
├── .env            ← Konfigurasi kamu (jangan di-share!)
└── README.md       ← Panduan ini
```

---

## ⚠️ Penting

- Jangan pernah share file `.env` atau token bot ke siapapun!
- Tambahkan `.env` ke `.gitignore` jika menggunakan Git
