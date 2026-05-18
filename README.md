# Shlyapcord

Web voice app MVP with invite-link access, Java backend, React frontend, WebRTC media, and Docker Compose.

## Local Run

```bash
docker compose up --build
```

Open:

```text
http://localhost:3000/invite/local-dev
```

The default invite token is `local-dev`.

## Services

- `server`: Java 21, Spring Boot, WebSocket signaling.
- `web`: React, Vite, TypeScript.
- `proxy`: nginx entrypoint on port `3000`.
- `turn`: optional coturn profile for WebRTC fallback.

## Rooms

MVP has one default voice room for all invited users.

## Audio Processing

Microphone audio is routed through RNNoise WASM in the browser before being sent over WebRTC.
If AudioWorklet or RNNoise initialization fails, the client falls back to browser audio capture.

## TURN

Start with TURN enabled:

```bash
docker compose --profile turn up --build
```

For production, set `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` in `.env`.

## Development URLs

- Proxy: `http://localhost:3000`
- Backend health: `http://localhost:8080/api/health`
- Invite link: `http://localhost:3000/invite/local-dev`

## Production Reverse Proxy

Caddy deployment notes are in `deploy/caddy/README.md`.
