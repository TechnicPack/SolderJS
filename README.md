# SolderJS

SolderJS is an alternative read-only API for [TechnicSolder](https://github.com/TechnicPack/TechnicSolder), designed for low-latency reads and horizontal scaling. It uses an existing TechnicSolder PostgreSQL database and Redis for caching.

> SolderJS is intended for experienced TechnicSolder operators. It is provided without support.

## Requirements

- Node.js 22 or newer (CI covers 22, 24, and 26)
- pnpm 11
- An existing TechnicSolder database on PostgreSQL
- Redis 7 or newer

SolderJS does not create or migrate the TechnicSolder schema.

## Setup

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Edit DATABASE_URL, MIRROR_URL, and any Redis settings.
pnpm start
```

A `.env` file is optional. In production, variables can be provided directly by the process manager or container runtime. `DATABASE_URL` is required and configuration is validated before the service starts.

## Configuration

| Variable                   | Default              | Description                                                        |
| -------------------------- | -------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`             | required             | PostgreSQL URL for the existing TechnicSolder database             |
| `HOST`                     | `localhost`          | HTTP listen address                                                |
| `PORT`                     | `3000`               | HTTP listen port                                                   |
| `TRUST_PROXY`              | `false`              | Proxy hop count/trusted value; `true` is rejected                  |
| `MIRROR_URL`               | `https://localhost/` | Base URL used to construct mod download URLs                       |
| `NODE_LOGGING`             | `true`               | Enable application logging                                         |
| `LOGGING_LEVEL`            | `info`               | Winston npm level (`error` through `silly`)                        |
| `PG_CONNECTION_TIMEOUT_MS` | `5000`               | PostgreSQL connection timeout                                      |
| `PG_QUERY_TIMEOUT_MS`      | `10000`              | PostgreSQL query timeout                                           |
| `PG_POOL_MAX`              | `20`                 | Maximum PostgreSQL pool size                                       |
| `REDIS_HOST`               | `localhost`          | Redis host                                                         |
| `REDIS_PORT`               | `6379`               | Redis port                                                         |
| `REDIS_PASSWORD`           | unset                | Redis password                                                     |
| `REDIS_CONNECT_TIMEOUT_MS` | `5000`               | Timeout for each Redis connection attempt                          |
| `RATE_LIMIT_WINDOW_MS`     | `900000`             | Per-instance API rate-limit window                                 |
| `RATE_LIMIT_MAX`           | `300`                | Requests allowed per client in each window                         |
| `VERIFY_RATE_LIMIT_MAX`    | `30`                 | Key-verification requests allowed per client in each window        |

Keep `TRUST_PROXY=false` unless the service is behind a known reverse proxy. For a single proxy hop, use `TRUST_PROXY=1`; trusting an incorrect number of hops can allow clients to spoof their address. Boolean `true` is rejected because trusting every proxy allows clients to bypass IP-based rate limits.

> **Upgrade note:** Previous releases enabled Express proxy trust unconditionally. Before deploying this version behind a reverse proxy, set `TRUST_PROXY` to the exact proxy hop count. If it remains `false`, all clients behind that proxy share one rate-limit bucket.

Rate limits use in-process storage and therefore apply per SolderJS instance. Use a shared rate-limit store at the edge when enforcing a cluster-wide limit.

## Authentication

Authentication matches TechnicSolder's read API:

- `?k=<API key>`
- `?cid=<client UUID>`

SolderJS intentionally does not define header-based authentication so clients remain interchangeable with TechnicSolder. Always use TLS and configure proxies to redact these query parameters from access logs.

Visibility follows TechnicSolder's read API behavior:

- Public modpacks and published public builds are available anonymously.
- Hidden modpacks are omitted from listings without access, but a non-private hidden modpack remains directly addressable.
- Private modpacks and private builds require an API key or a client assignment for that modpack.
- Unpublished builds are never returned.
- Unauthorized private resources return `404` to avoid revealing their existence.

## Endpoints

| Endpoint                        | Description                                           |
| ------------------------------- | ----------------------------------------------------- |
| `GET /api`                      | API name, version, and release stream                 |
| `GET /api/modpack`              | Visible modpacks; supports `?include=full`            |
| `GET /api/modpack/:slug`        | Modpack metadata and visible build versions           |
| `GET /api/modpack/:slug/:build` | Build metadata and mods; supports `?include=mods`     |
| `GET /api/verify/:key`          | Verify an API key; subject to the stricter rate limit |
| `GET /health/live`              | Process liveness                                      |
| `GET /health/ready`             | PostgreSQL readiness                                  |

## Development

```sh
pnpm check              # Biome lint/format checks and unit tests
pnpm test               # Unit and route tests
pnpm test:services:up   # Start PostgreSQL and Redis test services
pnpm test:integration   # Exercise the data layer against real services
pnpm test:services:down # Stop and remove test services
```

CI runs checks on Node.js 22, 24, and 26. The PostgreSQL and Redis integration suite runs on Node.js 24 and 26.

Redis is treated as an optional acceleration layer: the service starts and remains ready when Redis is unavailable, serves requests from PostgreSQL, and reconnects to Redis in the background. Readiness probes are coalesced for one second to avoid amplifying PostgreSQL load. Restrict `/health/ready` to the orchestrator or monitoring network at the reverse proxy.

The server handles `SIGINT` and `SIGTERM`, stops accepting new requests, allows active requests a bounded shutdown period, and then closes Redis and PostgreSQL connections.

## License

This project is licensed under the [MIT License](./LICENSE).
