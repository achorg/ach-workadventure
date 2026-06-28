# Stress testing WorkAdventure (self-hosted)

This runbook is meant for production-like playtests on your own domain.

## Current infra prerequisites

Before testing large audio/video groups, verify media infrastructure:

- `LIVEKIT_HOST`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `MAX_USERS_FOR_WEBRTC`

Without LiveKit, large simultaneous speaking groups are not representative.

## 1) Bot-based room load (avatars, movement)

Script: `tests/stress-playtest.js`

Install browser/runtime dependencies (one-time):

- `cd tests`
- `npx playwright install chromium`
- `npx playwright install-deps chromium`

Run a quick smoke test:

- `cd tests`
- `USERS=5 RAMP_MS=1000 HOLD_MS=10000 PLAY_URL=https://workadventure.apjan.co ROOM_PATH=/_/global/achorg.github.io/ach2025-map/map.json node stress-playtest.js`

Run a 50-user playtest:

- `cd tests`
- `USERS=50 RAMP_MS=1500 HOLD_MS=300000 PLAY_URL=https://workadventure.apjan.co ROOM_PATH=/_/global/achorg.github.io/ach2025-map/map.json node stress-playtest.js`

Useful environment knobs:

- `USERS`: number of clients
- `RAMP_MS`: delay between joins
- `HOLD_MS`: how long bots stay active
- `PLAY_URL`: your play domain
- `ROOM_PATH`: room path to test
- `HEADLESS=false`: optional visual mode

## 2) Observe server behavior while running

In a second terminal, monitor container resources:

- `docker stats --no-stream`
- `docker stats`

Watch service logs for warnings/errors:

- `docker compose --env-file /home/workadventure/apps/workadventure/deploy/workadventure-prod/.env -f /home/workadventure/apps/workadventure/deploy/workadventure-prod/docker-compose.yaml logs -f play back reverse-proxy`

## 3) Audio/video capacity playtest

For “30 people speaking” tests, run real-browser user sessions or test clients with LiveKit enabled.

Suggested staged scenarios:

1. 10 users in one bubble, all on mic.
2. 20 users in one bubble, 10 active speakers.
3. 30 users in one bubble, 10-15 active speakers.

Track at each stage:

- Join success/failure rate
- Audio/video setup success
- Median and p95 join time
- Packet loss / quality complaints from participants
- CPU and memory saturation on WorkAdventure, LiveKit, and TURN servers

## 4) Pass/fail criteria (example)

- Avatar load test (50 users):
  - >= 95% join success
  - No sustained container CPU pegging at 100%
  - No repeated websocket disconnect spikes

- Media test (30 users):
  - >= 90% successful media sessions
  - Stable audio with acceptable latency and no persistent dropouts
  - No cascading reconnect loops
