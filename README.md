# IDX EOD MCP Server

MCP server ini membungkus file `EOD 2023-2026.txt` supaya data end-of-day IDX bisa dipanggil dari client MCP seperti Codex Desktop, Claude Desktop, atau ChatGPT yang mendukung custom MCP/app.

## Yang sudah disiapkan

- Loader dataset dari file TXT/CSV lokal
- HTTP transport untuk remote MCP
- Stdio transport untuk local MCP client
- Tool domain khusus:
  - `get_latest_available_date`
  - `get_eod_record`
  - `get_eod_history`
  - `list_tickers`
  - `get_market_day_summary`
- Tool kompatibilitas read-only:
  - `search`
  - `fetch`

## Penting untuk ChatGPT

Per 19 April 2026, dokumentasi resmi OpenAI menyebut:

- ChatGPT tidak bisa connect ke MCP lokal; hanya remote server yang didukung.
- Untuk deep research/company knowledge, pola `search` dan `fetch` tetap yang paling kompatibel.
- Pro users hanya mendapat akses read/fetch di developer mode, sedangkan full MCP tersedia untuk Business dan Enterprise/Edu.

Referensi resmi:

- [Building MCP servers for ChatGPT Apps and API integrations](https://developers.openai.com/api/docs/mcp)
- [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta)

Karena itu server ini tetap punya tool domain khusus, tapi juga mengimplementasikan `search` dan `fetch`.

## Instalasi

```bash
npm install
```

Secara default server akan membaca file:

```text
./EOD 2023-2026.txt
```

Kalau file dipindah, set environment variable:

```powershell
$env:EOD_FILE_PATH="C:\path\to\EOD 2023-2026.txt"
```

## Menjalankan server

Mode HTTP untuk deployment/remote MCP:

```bash
npm run start:http
```

Mode stdio untuk client lokal yang spawn process:

```bash
npm run start:stdio
```

Environment variable yang tersedia:

- `EOD_FILE_PATH`: path ke file dataset
- `HOST`: default `127.0.0.1`
- `PORT`: default `3000`
- `PUBLIC_BASE_URL`: URL publik server, misalnya `https://eod-mcp.example.com`
- `MCP_TRANSPORT`: `http` atau `stdio`

## Endpoint HTTP

- `POST /mcp` -> endpoint MCP utama
- `GET /health` -> status dan statistik dataset
- `GET /openapi.json` -> schema OpenAPI untuk Custom GPT Actions
- `GET /privacy` -> privacy policy sederhana untuk Actions/public GPT
- `GET /api/eod/latest-date`
- `GET /api/eod/record`
- `GET /api/eod/history`
- `GET /api/eod/tickers`
- `GET /api/eod/market-summary`
- `GET /documents/dataset/metadata`
- `GET /documents/ticker/:ticker`
- `GET /documents/date/:date`
- `GET /documents/record/:ticker/:date`

## Contoh pemakaian tool

- `get_eod_record` dengan `ticker=BBCA` dan `date=2026-04-17`
- `get_eod_history` dengan `ticker=BBCA`, `startDate=2026-01-01`, `endDate=2026-04-17`
- `get_market_day_summary` dengan `date=2026-04-17`
- `search` dengan query `BBCA 2026-04-17`
- `fetch` dengan id `record:BBCA:2026-04-17`

## Koneksi ke ChatGPT

1. Deploy server ini ke host publik.
2. Pastikan endpoint MCP tersedia di `https://domain-kamu/mcp`.
3. Buka ChatGPT Settings.
4. Masuk ke Apps/Connectors atau Developer Mode.
5. Tambahkan custom MCP/app dengan URL server kamu.
6. Setelah terhubung, minta ChatGPT mengambil data EOD, misalnya:
   - `Ambil EOD BBCA tanggal 2026-04-17`
   - `Tampilkan history TLKM dari 2026-01-01 sampai 2026-04-17`
   - `Cari market summary tanggal 2026-04-17`

## Koneksi ke Custom GPT Actions

Kalau yang kamu pakai adalah layar `Add actions`, pakai jalur REST/OpenAPI, bukan MCP.

1. Deploy server ini ke host publik, misalnya `https://eod-api.domainkamu.com`
2. Pastikan endpoint ini bisa diakses:
   - `https://eod-api.domainkamu.com/openapi.json`
   - `https://eod-api.domainkamu.com/privacy`
3. Di editor Custom GPT:
   - `Authentication` -> pilih `None` jika API kamu read-only dan memang dibuka publik
   - klik `Import from URL`
   - masukkan `https://eod-api.domainkamu.com/openapi.json`
   - isi `Privacy policy` dengan `https://eod-api.domainkamu.com/privacy`
4. Simpan lalu test prompt seperti:
   - `Ambil data EOD BBCA tanggal 2026-04-17`
   - `Tampilkan history BBRI 30 hari terakhir`
   - `Ringkas market summary tanggal 2026-04-17`

Kalau kamu ingin paste manual schema-nya ke kotak `Schema`, ambil isi JSON dari `/openapi.json`.

## Koneksi ke client lokal berbasis stdio

Kalau client MCP kamu memakai stdio, command yang dipakai:

```bash
node C:\Users\ASUS\Desktop\MCP EOD\src\index.js --transport=stdio
```

## Deploy cepat dengan Docker

Build image:

```bash
docker build -t idx-eod-mcp .
```

Run container:

```bash
docker run -p 3000:3000 -e HOST=0.0.0.0 -e PORT=3000 -e PUBLIC_BASE_URL=http://localhost:3000 idx-eod-mcp
```

## Deploy ke VPS paling mudah

Kalau kamu sewa VPS sendiri, jalur paling gampang adalah:

1. Point domain ke IP VPS
2. Install Docker + Docker Compose
3. Copy project ini ke VPS
4. Buat file `.env` dari contoh `.env.vps.example`
5. Jalankan `docker compose -f docker-compose.vps.yml up -d --build`

File yang sudah disiapkan:

- `docker-compose.vps.yml`
- `deploy/Caddyfile`
- `.env.vps.example`

Contoh isi `.env` di VPS:

```env
DOMAIN=eod.domainkamu.com
```

Lalu jalankan:

```bash
docker compose -f docker-compose.vps.yml up -d --build
```

Arsitektur deploy ini:

- container `app` menjalankan API EOD pada port internal `3000`
- container `caddy` membuka port `80/443`
- `caddy` otomatis mengurus HTTPS/SSL untuk domain kamu lalu me-reverse-proxy ke `app`

Sesudah deploy, endpoint yang harus kamu cek:

- `https://eod.domainkamu.com/health`
- `https://eod.domainkamu.com/openapi.json`
- `https://eod.domainkamu.com/privacy`

Kalau tiga URL itu hidup, berarti URL tersebut sudah bisa dipasang ke `Custom GPT Actions`.

## Catatan implementasi

- Dataset dibaca sekali saat startup lalu diindeks per ticker dan per tanggal.
- Tanggal dataset sumber dibaca dari format `MM/DD/YYYY` lalu dinormalisasi menjadi `YYYY-MM-DD`.
- Untuk input tool, format tanggal yang paling aman adalah `YYYY-MM-DD`.
- Server ini sekarang melayani dua integrasi sekaligus: `MCP` dan `Custom GPT Actions`.
