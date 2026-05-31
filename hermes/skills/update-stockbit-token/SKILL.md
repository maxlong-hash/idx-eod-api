---
name: update-stockbit-token
description: "Update the Stockbit bearer token file used by the broksum fetcher."
version: 1.0.0
platforms: [linux]
metadata:
  hermes:
    tags: [idx, stockbit, bearer-token, broksum, telegram]
    related_skills: [fetch-broksum]
---

# Update Stockbit Token

Use this skill when the user invokes `/update_stockbit_token`, `/update-stockbit-token`, or asks to refresh the Stockbit bearer token.

## Target File

The fetcher reads this file:

```bash
/home/ubuntu/idx-eod-api/Scrape stockbit/Autentikatsi bearer stockbit.txt
```

## Preferred Input

Prefer a Telegram file upload containing the new bearer token. If the uploaded file path is available, copy its content into the target file.

If the user pasted the token in chat, you may update the file from the pasted token, but warn briefly that uploading a text file is safer because Telegram chat history can retain pasted secrets.

## Workflow

1. Work from:

```bash
/home/ubuntu/idx-eod-api/Scrape stockbit
```

2. Back up the current token file before writing:

```bash
cp "Autentikatsi bearer stockbit.txt" "Autentikatsi bearer stockbit.txt.bak-$(date +%Y%m%d-%H%M%S)"
```

3. Write the new token to:

```bash
Autentikatsi bearer stockbit.txt
```

Keep exactly one trailing newline. Preserve a leading `Bearer ` prefix if provided; otherwise write the raw token.

4. Validate without printing the token:

```bash
python3 fetch_broker_summary.py --from YYYY-MM-DD --to YYYY-MM-DD --symbols BBCA --output-dir /tmp/stockbit-token-smoke --log-file /tmp/stockbit-token-smoke.log.csv --skip-existing
```

Use the latest requested broksum date if the user provided one. If no date is provided, use a recent known IDX trading date from the API health or ask the user for a date.

5. Report only:

- token file updated
- backup file path
- validation success/failure
- if validation fails with HTTP 401, tell the user the token still appears invalid or expired

## Rules

- Never print the token, bearer header, JWT, or any secret value.
- Do not commit the token file to git.
- Do not delete backup files unless the user explicitly asks.
