# Stream Event Hub Core

Backend engine for ingesting Twitch, YouTube, and LivePix events and broadcasting normalized stream activity over REST and Socket.IO.

This repository is a sanitized public release of a larger private streaming toolkit. It intentionally contains only the server-side logic.

Removed from this public version:
- All overlay HTML/CSS/JS files
- Intro, BRB, ending, and other scene pages
- Admin frontend assets
- Runtime data, uploaded media, QR codes, and branding assets
- Private deploy settings and machine-specific identifiers

Included in this public version:
- Twitch, YouTube, and LivePix listener logic
- Alert queueing and replay history APIs
- Chat ingestion and featured-message state management
- Session metrics and analytics endpoints
- Config persistence with secret redaction
- Docker and remote deploy scaffolding

## Project Layout

```text
.
├── server/
│   ├── index.js
│   ├── package.json
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   └── ...
│   └── test/
├── Dockerfile
├── deploy.sh
└── README.md
```

## Quick Start

Requirements:
- Node.js 20+
- npm 10+

Install and run:

```bash
cp server/.env.example server/.env
npm ci --prefix server
npm run dev --prefix server
```

Run tests:

```bash
npm test --prefix server
```

## Runtime Notes

- Runtime files are created under `server/data/` on first start.
- Secrets are persisted in `server/data/secrets.json` and are ignored by git.
- Audio uploads are stored in `server/data/sounds/`.
- The original live overlay designs are not part of this repository. Build your own frontend or connect your own browser sources to the exposed APIs and Socket.IO events.

## API Surface

Core endpoints:
- `GET /`
- `GET /api/health/ready`
- `GET /api/status`
- `GET /api/health/connections`
- `GET /api/audience`
- `GET /api/config`
- `POST /api/config`
- `GET /api/chat/state`
- `POST /api/chat/test`
- `POST /api/chat/feature`
- `GET /api/alert-history`
- `POST /api/alert-replay`
- `GET /api/session/summary`
- `POST /api/session/start`
- `POST /api/session/end`
- `GET /api/analytics/overview`
- `POST /webhooks/livepix`

Authentication and OAuth routes are also available for the supported providers.

## Deployment

Docker image build:

```bash
docker build -t stream-event-hub-core .
docker run --rm -p 3232:3232 -v "$(pwd)/server/data:/app/data" stream-event-hub-core
```

Remote deployment scaffolding is provided through `deploy.sh` and `.deploy.env.example`.

## License

ISC
