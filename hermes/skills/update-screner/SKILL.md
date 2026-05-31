---
name: update-screner
description: "Update MaX Screener CSV for IDX EOD API, then publish it to the VPS container."
version: 1.0.0
platforms: [linux]
metadata:
  hermes:
    tags: [idx, eod, max-screener, telegram]
    related_skills: [update-screener, idx-status]
---

# Update MaX Screener

Use this skill when the user invokes `/update_screner`, `/update-screner`, or asks to update MaX Screener.

## Working Directory

Always run commands from:

```bash
/home/ubuntu/idx-eod-api
```

## Workflow

1. Run the exporter:

```bash
npm run screener:update
```

2. Publish the generated CSV to the live API container:

```bash
sudo docker compose -f docker-compose.vps.yml up -d --build
```

3. Verify:

```bash
curl -sS https://eod.maxlong.my.id/health
```

Report the newest `screenerMaxStats.sourceFile`, `screenerMaxStats.generatedAt`, and whether the command completed successfully.

## Rules

- This exporter uses the same MaX Screener logic as the UI because it imports `screener-max/src/lib/maxEngine.ts` with `DEFAULT_SETTINGS`.
- Do not replace historical CSVs unless the user explicitly asks for cleanup.
- If one ticker is skipped because it has too few bars, report it as a warning, not a full failure.
