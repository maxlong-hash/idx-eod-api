---
name: update-eod
description: "Update IDX EOD from a user-provided FMS file, generate IHSG, update MaX Screener, and publish the API."
version: 1.0.0
platforms: [linux]
metadata:
  hermes:
    tags: [idx, eod, ihsg, fms, telegram]
    related_skills: [update-screner, idx-status]
---

# Update IDX EOD

Use this skill when the user invokes `/update_eod`, `/update-eod`, or sends a new FMS EOD file to update the dataset.

## Working Directory

Always run commands from:

```bash
/home/ubuntu/idx-eod-api
```

## Inputs

- The FMS stock EOD file is manual and must come from the user.
- If Telegram provides the uploaded file as a local attachment path, copy it into:

```bash
/home/ubuntu/idx-eod-api/tmp/telegram-updates/
```

- If there is no usable FMS file path, ask the user to upload the FMS file first.

## Workflow

1. Run the automatic EOD updater with Python 3:

```bash
PYTHON_BIN=python3 npm run eod:update:auto -- /home/ubuntu/idx-eod-api/tmp/telegram-updates/<fms-file>
```

This will:

- infer the trading date from the FMS file
- run `EOD IHSG/IHSG.py --headless`
- update `EOD 2023-2026.txt` with replace-existing semantics for matching date and ticker rows
- regenerate MaX Screener CSV using the same engine as the UI

2. Publish the updated EOD and MaX Screener files to the live API container:

```bash
sudo docker compose -f docker-compose.vps.yml up -d --build
```

3. Verify:

```bash
curl -sS https://eod.maxlong.my.id/health
```

Report `latestDate`, MaX Screener CSV, and any skipped/warning rows.

## Failure Handling

- If Yahoo/yfinance is rate limited while generating IHSG, explain that the IHSG downloader is temporarily blocked and ask the user to either retry later or provide the IHSG file manually.
- Never drop historical EOD rows. Use update/replace-existing only for matching date and ticker corrections.
- Do not print secrets, API keys, Telegram tokens, or Stockbit bearer tokens.
