---
name: fetch-broksum
description: "Fetch Stockbit broker summary data for a trading date and make it available to broksum endpoints."
version: 1.0.0
platforms: [linux]
metadata:
  hermes:
    tags: [idx, broksum, stockbit, broker-summary, telegram]
    related_skills: [idx-status]
---

# Fetch Broksum

Use this skill when the user invokes `/fetch_broksum`, `/fetch-broksum`, or asks to fetch broker summary data.

## Working Directory

Run the fetcher from:

```bash
/home/ubuntu/idx-eod-api/Scrape stockbit
```

## Input

The user should provide a date in `YYYY-MM-DD` format. If missing, ask for the trading date.

## Workflow

For date `YYYY-MM-DD`, run:

```bash
python3 fetch_broker_summary.py --from YYYY-MM-DD --to YYYY-MM-DD --output-dir "2023/brokerdata_YYYY-MM-DD" --skip-existing --log-file "fetch_broker_summary_YYYY-MM-DD.log.csv"
```

Then verify from `/home/ubuntu/idx-eod-api`:

```bash
curl -sS https://eod.maxlong.my.id/health
```

Broksum data is mounted into the container from:

```bash
/home/ubuntu/idx-eod-api/Scrape stockbit/2023
```

So a Docker rebuild is normally not required for broksum-only updates.

## Rules

- Use the existing Stockbit auth file. Do not print its token.
- If the token is expired or HTTP 401 appears, ask the user to refresh the Stockbit bearer token file.
- Keep `--skip-existing` unless the user explicitly wants to refetch and overwrite existing symbols.
- Report output folder, failed symbol file if present, and `broksum latestDate` from health.
