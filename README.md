# IDX EOD History Server

Server ini membungkus file `EOD 2023-2026.txt` agar bisa dipakai dari ChatGPT Actions atau client MCP untuk satu kebutuhan utama:

- mengambil **raw history lengkap** per ticker
- default dari **tanggal paling awal yang tersedia** sampai **tanggal terbaru yang tersedia**
- atau memakai **custom date range**

Kolom data yang dikembalikan:

- `open`
- `high`
- `low`
- `close`
- `volume`
- `tradeFrequency`
- `tradeValue`
- `nbsa`

## Instalasi

```bash
npm install
```

Secara default server membaca file:

```text
./EOD 2023-2026.txt
```

Kalau file dipindah, set:

```powershell
$env:EOD_FILE_PATH="C:\path\to\EOD 2023-2026.txt"
```

## Menjalankan server

HTTP:

```bash
npm run start:http
```

stdio:

```bash
npm run start:stdio
```

Environment variable:

- `EOD_FILE_PATH`
- `OWNERSHIP_DATA_DIR`
- `HOST`
- `PORT`
- `PUBLIC_BASE_URL`
- `MCP_TRANSPORT`

## Endpoint HTTP

- `GET /health`
- `GET /openapi.json`
- `GET /privacy`
- `GET /api/eod/history`
- `GET /api/eod/ihsg`
- `GET /api/screener/max`
- `GET /api/ownership/holders`
- `GET /api/ownership/history`
- `GET /api/ownership/compare`
- `GET /api/ownership/investor-holdings`
- `GET /api/ownership/holder-compare`
- `GET /api/ownership/investor-compare`
- `GET /api/ownership/network`
- `POST /mcp`

## Endpoint screner MAX untuk Custom GPT

Endpoint:

```text
GET /api/screener/max
```

Endpoint ini membaca file export terbaru dengan pola:

```text
./screner MAX/max-screener-*.csv
```

Kalau folder hasil screener ada di lokasi lain, set:

```powershell
$env:SCREENER_MAX_RESULTS_DIR="C:\path\to\screner MAX"
```

Untuk membatasi akses endpoint screener dengan API key:

```powershell
$env:SCREENER_API_KEY="isi_api_key_rahasia"
```

Custom GPT Actions dapat memakai authentication mode API Key/Bearer dengan value yang sama.

Parameter:

- `ticker` opsional: satu ticker atau beberapa ticker dipisah koma
- `tickers` opsional: alias untuk watchlist beberapa ticker
- `filter` opsional: `all`, `signals`, `reversal`, `momentum`, `breakout`, `passive`, atau `risk`
- `signal` opsional: contoh `SMART SNIPER`, `SMART GAMMA`, `G ACC`
- `regime` opsional: contoh `EXPLOSIVE BULL`
- `quadrant` opsional: `LEADING`, `IMPROVING`, `WEAKENING`, `LAGGING`, atau `N/A`
- `minScore` opsional
- `limit` opsional, default `50`, maksimal `1000`
- `sort` opsional: `score_desc`, `score_asc`, `change_desc`, `change_asc`, atau `ticker_asc`
- `format` opsional: `json`, `csv`, atau `file_url`, default `json`

Contoh untuk Custom GPT:

```text
/api/screener/max?filter=signals&limit=20
```

Contoh mencari ticker tertentu:

```text
/api/screener/max?ticker=BBCA,BRPT&format=json
```

Untuk GPT Action, masukkan schema dari:

```text
https://domain-kamu.com/openapi.json
```

## Cara kerja endpoint history

Endpoint:

```text
GET /api/eod/history
```

Parameter:

- `ticker` wajib
- `startDate` opsional
- `endDate` opsional
- `order` opsional: `asc` atau `desc`, default `asc`
- `format` opsional: `file_url`, `json`, atau `csv`, default `file_url`

Perilaku:

- jika `startDate` dan `endDate` tidak diisi, server mengembalikan **full history** dari tanggal paling awal yang tersedia sampai tanggal terbaru yang tersedia
- jika tanggal diisi, server mengembalikan **full history** dalam range itu
- default `file_url` mengembalikan URL file CSV melalui `openaiFileResponse`, paling cocok untuk ChatGPT Actions

Untuk IHSG, bisa pakai endpoint khusus tanpa parameter ticker:

```text
GET /api/eod/ihsg
```

Parameter yang tersedia sama, kecuali `ticker` tidak perlu diisi:

- `startDate` opsional
- `endDate` opsional
- `order` opsional: `asc` atau `desc`, default `asc`
- `format` opsional: `file_url`, `json`, atau `csv`, default `file_url`

## Contoh JSON

Full history:

```text
/api/eod/history?ticker=BBCA
```

Custom range:

```text
/api/eod/history?ticker=BBCA&startDate=2025-01-01&endDate=2026-04-17&order=asc&format=json
```

IHSG:

```text
/api/eod/ihsg?startDate=2023-01-01&endDate=2026-04-24
```

## Contoh CSV

```text
/api/eod/history?ticker=BBCA&startDate=2023-01-01&endDate=2026-04-17&order=asc&format=csv
```

## Contoh File URL untuk ChatGPT

```text
/api/eod/history?ticker=BBCA
```

Respons JSON kecil:

```json
{
  "ticker": "BBCA",
  "startDate": "2023-01-02",
  "endDate": "2026-04-17",
  "latestAvailableDate": "2026-04-17",
  "returned": 772,
  "downloadUrl": "https://eod.maxlong.my.id/files/eod-history.csv?...",
  "openaiFileResponse": [
    "https://eod.maxlong.my.id/files/eod-history.csv?..."
  ]
}
```

Header CSV mengikuti file sumber:

- `<date>`
- `<ticker>`
- `<open>`
- `<high>`
- `<low>`
- `<close>`
- `<volume>`
- `<freq>`
- `<valuasi>`
- `<nbsa>`

## Endpoint ownership

Data ownership membaca folder:

```text
./data/ownership
```

Isi awalnya:

- `db_balance_history.js` untuk histori bulanan lokal/asing per ticker
- `data_27_februari_2026.js` untuk daftar pemegang saham per 27 Februari 2026
- `data_31_maret_2026.js` untuk daftar pemegang saham per 31 Maret 2026

Ambil pemegang saham terbaru atau periode tertentu:

```text
/api/ownership/holders?ticker=PGAS&period=2026-03&limit=10
```

Ambil histori kepemilikan bulanan:

```text
/api/ownership/history?ticker=PGAS&startDate=2026-02&endDate=2026-03
```

Bandingkan metric antar periode:

```text
/api/ownership/compare?ticker=PGAS&from=2026-02&to=2026-03&metric=local_total
```

Lihat saham apa saja yang dipegang satu holder:

```text
/api/ownership/investor-holdings?holder=PANIN&period=2026-03&limit=50
```

Cek apakah satu holder akumulasi atau distribusi di satu saham:

```text
/api/ownership/holder-compare?ticker=PGAS&holder=PANIN&from=2026-02&to=2026-03
```

Bandingkan seluruh portofolio holder antar periode:

```text
/api/ownership/investor-compare?holder=PANIN&from=2026-02&to=2026-03&status=increased
```

Ambil node network ownership untuk saham atau holder:

```text
/api/ownership/network?ticker=PGAS&period=2026-03&limit=10&neighborLimit=5
/api/ownership/network?holder=PANIN&period=2026-03&limit=10&neighborLimit=5
```

Metric yang umum:

- `local_total`
- `foreign_total`
- `price`
- `local_is`, `local_cp`, `local_pf`, `local_ib`, `local_id`, `local_mf`, `local_sc`, `local_fd`, `local_ot`
- `foreign_is`, `foreign_cp`, `foreign_pf`, `foreign_ib`, `foreign_id`, `foreign_mf`, `foreign_sc`, `foreign_fd`, `foreign_ot`

Endpoint `holders` dan `history` mendukung:

- `format=file_url` default untuk Custom GPT
- `format=json` untuk data inline
- `format=csv` untuk CSV inline

## Custom GPT Actions

Import schema dari:

```text
https://eod.maxlong.my.id/openapi.json
```

Privacy policy:

```text
https://eod.maxlong.my.id/privacy
```

Kalau schema berubah, lakukan `Import from URL` lagi di Actions.

## Deploy ke VPS

Di VPS:

```bash
git pull origin main
sudo docker compose -f docker-compose.vps.yml up -d --build
```

## Update dataset dengan file lanjutan

Kalau ada file lanjutan baru, misalnya `fms260420.txt`, jalankan:

```bash
npm run eod:update -- fms260420.txt
```

Script ini akan:

- membaca file update
- skip header
- mendeteksi duplikat berdasarkan kombinasi `date + ticker`
- append hanya baris baru ke `EOD 2023-2026.txt`

Kalau file update berisi koreksi untuk baris lama, gunakan:

```bash
node scripts/apply-eod-update.js fms260427.txt IHSG20260427.txt --replace-existing
```

Dengan opsi ini, baris lama yang key `date + ticker`-nya sama akan diganti jika isi datanya berbeda.

Setelah update, cek cepat:

```bash
npm run start:http
```

atau baca statistik dengan script internal/server health untuk memastikan `latestDate` sudah naik.

Kalau server berjalan di VPS, setelah dataset utama diperbarui lakukan rebuild:

```bash
sudo docker compose -f docker-compose.vps.yml up -d --build
```
