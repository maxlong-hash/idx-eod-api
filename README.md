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
- `HOST`
- `PORT`
- `PUBLIC_BASE_URL`
- `MCP_TRANSPORT`

## Endpoint HTTP

- `GET /health`
- `GET /openapi.json`
- `GET /privacy`
- `GET /api/eod/history`
- `POST /mcp`

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
- `format` opsional: `json` atau `csv`, default `json`

Perilaku:

- jika `startDate` dan `endDate` tidak diisi, server mengembalikan **full history** dari tanggal paling awal yang tersedia sampai tanggal terbaru yang tersedia
- jika tanggal diisi, server mengembalikan **full history** dalam range itu

## Contoh JSON

Full history:

```text
/api/eod/history?ticker=BBCA
```

Custom range:

```text
/api/eod/history?ticker=BBCA&startDate=2025-01-01&endDate=2026-04-17&order=asc
```

## Contoh CSV

```text
/api/eod/history?ticker=BBCA&startDate=2023-01-01&endDate=2026-04-17&order=asc&format=csv
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
