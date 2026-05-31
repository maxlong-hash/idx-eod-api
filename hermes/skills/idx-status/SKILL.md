---
name: idx-status
description: "Check IDX EOD API health, EOD freshness, MaX Screener CSV freshness, and broksum freshness."
version: 1.0.0
platforms: [linux]
metadata:
  hermes:
    tags: [idx, eod, status, health, telegram]
    related_skills: [update-screner, fetch-broksum, update-eod]
---

# IDX Status

Use this skill when the user invokes `/idx_status`, `/idx-status`, or asks for IDX API/data status.

Run from:

```bash
/home/ubuntu/idx-eod-api
```

Check:

```bash
curl -sS https://eod.maxlong.my.id/health
```

Optionally check the container:

```bash
sudo docker ps --format '{{.Names}}\t{{.Status}}\t{{.Image}}'
```

Report:

- API health status
- latest EOD date
- MaX Screener source CSV and generated time
- broksum latest date
- whether Docker containers are running

Do not print API keys or environment secrets.
