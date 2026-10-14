# Production deployment (backend)

## What this overlay changes

- Uses the multi-stage production `Dockerfile` instead of `Dockerfile.dev`.
- Removes the backend source-code bind mount; keeps `./public` mounted for uploaded/public assets.
- Loads backend and environment-file-based AI service configuration from `.env.production`.
- Forces `NODE_ENV=production` and `DB_SYNC=false`.
- Publishes only the NestJS API on host loopback at `127.0.0.1:5001` for a reverse proxy running on the Docker host.
- Removes host-published ports for MySQL, Redis, phpMyAdmin, Qdrant and AI services. They remain available to services on the Compose network.
- Puts phpMyAdmin behind the opt-in `dev-tools` profile; do not enable that profile on a public production server.

## Requirements

- Docker Engine and Docker Compose v2.24.4 or newer (`!override` is used to replace inherited Compose lists).
- Review and configure firewall rules and a TLS reverse proxy before exposing the API publicly.
- Ensure the host-based reverse proxy targets `http://127.0.0.1:5001`. If the reverse proxy runs in another container, use a shared private Docker network and the backend service name instead; do not publish the API publicly just to connect the proxy.
- The current main Compose file contains development-era configuration for MySQL and some services. This overlay replaces the MySQL credentials and healthcheck for production, but deployment still requires a secrets review and application-specific smoke tests.

## First-time setup

1. Copy `.env.production.example` to `.env.production`.
2. Replace every `REPLACE_...` value with a unique secret. Do not reuse development credentials and do not commit `.env.production`.
3. Set `CORS_ORIGINS`, `FRONTEND_URL`, and `APP_URL` to the real HTTPS origins.
4. Review all third-party keys and the backend's required environment variables against `.env.example` and the application configuration.
5. Create the public-assets directory if needed: `mkdir -p public`.
6. Validate the merged configuration before starting services:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml config --quiet
```

7. Start or update the stack:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml up -d --build
```

8. Verify the API from the host and inspect service health:

```bash
curl -i http://127.0.0.1:5001/
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml logs --tail=100 backend
```

The root URL may not be an application route; use a known health endpoint if one is configured.

## Operational cautions

- Back up the MySQL volume before migrations or upgrades.
- Do not run database schema synchronization in production; use reviewed migrations.
- Never publish database, Redis, Qdrant, phpMyAdmin, or AI service ports to the public internet.
- This is a production-oriented Compose overlay, not a completed deployment certification. Confirm required variables, database migrations, upload persistence, backups, TLS, firewall, and end-to-end API flows on the target server before routing real traffic.
