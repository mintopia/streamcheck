## Design Context

### Users
Stream engineers and operations staff monitoring live Twitch streams. They use this tool during active broadcasts, often alongside other monitoring tools (OBS, Grafana, chat). They need to assess stream health at a glance and spot problems before viewers notice. Usage is sustained (hours at a time) and attention is split across multiple screens.

### Brand Personality
Confident, precise, professional.

### Aesthetic Direction
**Mission control** — serious, data-dense, built for sustained monitoring. References: Datadog/New Relic (polished observability UI, color-coded status, clean hierarchy) and Grafana (dense data panels, time-series focus). Both dark and light themes with toggle, optimized for long sessions in varying ambient light.

**Color strategy: Restrained.** Neutral tinted backgrounds with status colors (green/amber/red) as the primary chromatic elements. No brand accent color — let the data and its health status be the visual story. Status colors must be distinguishable for color-blind users (use shape/icon reinforcement alongside color).

**Anti-references:**
- No toy/playful aesthetic (rounded cartoon elements, pastels)
- No corporate SaaS templates (generic dashboards, stock illustrations)
- No clutter/information overload (wall of numbers without hierarchy)
- No retro terminal novelty (green-on-black, faux CRT)

**Theme:** Dark and light modes with toggle. Dark mode for dim broadcast environments; light mode for daytime office use.

### Design Principles
1. **Glanceability** — Stream health status must be readable in under 2 seconds from across a desk. Size, color, and position encode severity.
2. **Quiet until it matters** — The interface is calm when everything is healthy. Problems surface through color escalation and visual weight, not constant animation or alerts.
3. **Data density without clutter** — Show all metrics simultaneously but with clear hierarchy. Primary metrics (bitrate, LUFS, health) are prominent; secondary metrics (codec, resolution) are present but recessed.
4. **Trust through precision** — Display exact values, not vague labels. Engineers trust numbers. Show units, ranges, and thresholds explicitly.
5. **Sustained use** — Optimized for hours of passive monitoring. No eye strain, no distracting motion, comfortable contrast ratios.
