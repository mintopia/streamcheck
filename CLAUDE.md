# StreamCheck

Twitch stream quality monitor. Node.js backend with Express, WebSocket, streamlink + FFmpeg for stream analysis. Browser dashboard for live metrics.

## Design Context

### Users
Stream engineers and operations staff monitoring live Twitch streams. Sustained use (hours), split attention across multiple screens. Must assess stream health at a glance.

### Brand Personality
Confident, precise, professional.

### Aesthetic Direction
Mission control feel. References: Datadog/New Relic, Grafana. Restrained color strategy — neutral tinted backgrounds, status colors (green/amber/red) only. Dark and light themes with toggle.

### Anti-references
No toy/playful, no corporate SaaS templates, no clutter, no retro terminal novelty.

### Design Principles
1. **Glanceability** — health readable in under 2 seconds
2. **Quiet until it matters** — calm when healthy, escalates visually on problems
3. **Data density without clutter** — all metrics visible, clear hierarchy
4. **Trust through precision** — exact values, units, ranges, thresholds
5. **Sustained use** — comfortable for hours of passive monitoring
