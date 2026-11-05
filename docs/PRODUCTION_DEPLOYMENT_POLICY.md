# Yarsalam production deployment policy

This document is a release gate, not authorization to deploy. Do not run Compose or publish services until the checklist below is reviewed.

## Non-negotiable deployment constraints

1. **Runtime-only on the VPS.** Application source, tests, Git history, development dependencies, CI files, source maps, local caches, and build tooling stay in GitHub/CI. The VPS should receive only deployment manifests, an approved image reference/digest, a tightly scoped production environment file, and persistent runtime data. Prefer CI-built images over building from a source checkout on the VPS.
2. **Iran connectivity and filtering.** Plan for intermittent filtering, DNS failures, and loss of international connectivity. Minimize runtime dependencies on external APIs/CDNs/package registries. Build and push images in CI, pin image versions/digests, and document recovery steps that do not require downloading dependencies during an outage. A foreign VPS or DNS change cannot guarantee availability from Iran during an international outage. If domestic reachability is a hard requirement, evaluate a separately operated in-country endpoint and tested data synchronization/failover.
3. **Keep administration private.** The admin UI/API must not be made public merely by assigning a separate domain. Prefer a private VPN or SSH tunnel; if a public gateway is explicitly required, restrict it with an allowlist and strong authentication. Do not publish MySQL, Redis, Qdrant, or internal AI ports.
4. **Secrets stay out of Git and images.** Never commit `.env`, `.env.production`, private keys, access tokens, database credentials, or real production values. Use a root-owned secrets directory (for example `/opt/yarsalam/secrets`, mode 0700) and least-privilege file permissions. Rotate any credentials that were previously committed or exposed.
5. **Data durability.** Keep databases and user uploads in explicit persistent volumes/paths, separate from replaceable containers. Define encrypted/off-host backups and test restoration before production.
6. **Fail safely.** Production schema auto-sync must be disabled; migrations must be explicit and reviewed. Health checks, restart policy, logging limits, resource limits, and a rollback plan are required.

## VPS layout

- `/opt/yarsalam/`: deployment manifests and release metadata only.
- `/opt/yarsalam/secrets/`: production secret files; root-owned and mode 0700.
- `/srv/yarsalam/`: only required persistent runtime data, with service-specific ownership.
- Do not clone the source repositories into these directories for routine production deployment.

## Current server baseline (2026-10-25)

- Ubuntu 24.04.5 LTS; updated kernel `6.8.0-147-generic`; reboot completed.
- SSH: root login disabled, password and keyboard-interactive SSH authentication disabled, public-key authentication enabled; SSH service active after reboot.
- UFW: default deny incoming; TCP 22, 80, 443 allowed.
- Docker Engine and Compose are installed and active.
- Empty deployment directories were created under `/opt/yarsalam` and `/srv/yarsalam`.
- No application containers have been deployed yet.
- Do not upgrade to Ubuntu 26.04 as part of this deployment task.

## Backend repository cautions

- The existing `docker-compose.yml` is development-oriented and contains fixed example credentials, source bind mounts, and many optional services.
- The current `docker-compose.production.yml` is an overlay on that large base file. Hiding ports does not prevent optional AI services from starting; default `up` can start services beyond the API and database.
- Its documented command builds from source on the VPS. **Do not run that command as-is.**
- Before deployment, create a minimal production Compose file that explicitly includes only approved services and consumes CI-built, immutable image references. Decide whether Redis is required for the initial release. Do not start AI/WhatsApp/background workers until each is justified, resource-budgeted, and separately approved.
- Confirm database initialization/migrations, required environment variables, uploads path, health checks, resource limits, and rollback strategy before starting anything.

## Required pre-deployment gates

- [ ] Review source and dependency/licensing requirements in GitHub/CI, not on the production host.
- [ ] Build and test immutable production images in CI; scan them and pin by digest.
- [ ] Use a minimal production Compose file; run `docker compose config` with secrets supplied safely and inspect the rendered output before any `up`.
- [ ] Verify all published ports and reverse-proxy bindings; internal services have no public host ports.
- [ ] Confirm TLS, hostnames, CORS, authentication, and the private admin access path.
- [ ] Confirm database schema/migration plan, persistence, backup, restore, monitoring, log rotation, and rollback.
- [ ] Test an outage/recovery path without requiring live package installation on the VPS.
- [ ] Obtain explicit approval before the first `docker compose up`, DNS switch, or public exposure.

## Operational rule

Do not execute `docker compose up`, `docker compose pull`, release upgrades, firewall changes, or public DNS changes without first inspecting the exact manifests, image sources, ports, volumes, environment-variable names, and expected service list.
