---
name: update-screener
description: "Alias for update-screner. Update MaX Screener CSV for IDX EOD API."
version: 1.0.0
platforms: [linux]
metadata:
  hermes:
    tags: [idx, eod, max-screener, telegram]
    related_skills: [update-screner, idx-status]
---

# Update Screener Alias

Use the exact same workflow as the `update-screner` skill.

Run from `/home/ubuntu/idx-eod-api`:

```bash
npm run screener:update
sudo docker compose -f docker-compose.vps.yml up -d --build
curl -sS https://eod.maxlong.my.id/health
```

Report the generated MaX Screener CSV file and health status.
