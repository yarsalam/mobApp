# ChatGPT handoff — Yarsalam backend deployment

Last updated: 2026-10-25

## User's standing requirements

- Consider Iran filtering, unreliable access to international services, and possible international-connectivity outages in every deployment decision. Never promise that a foreign VPS will remain reachable from Iran in such an outage.
- Keep the administration panel private. Prefer VPN/SSH tunnel; public allowlisting is a fallback, not a default.
- Only runtime artifacts belong on the VPS. Source, tests, Git history, development dependencies, and build tooling stay in GitHub/CI. Prefer CI-built immutable images.
- Keep secrets out of Git and image layers. Keep databases and uploads persistent and independently backed up.
- Never start a Compose stack until its exact rendered configuration and service list have been inspected and approved.
- Give the user concrete commands for the next step. Do not claim to have run commands on the VPS unless the user supplied output proving it.

## VPS baseline confirmed by the user

- Host: `185.7.172.248`, user `deploy`.
- Ubuntu 24.04.5 LTS; kernel `6.8.0-147-generic` after successful reboot.
- SSH public-key login works. `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PubkeyAuthentication yes`; SSH active.
- UFW active with default deny incoming; TCP 22/80/443 allowed.
- Docker active; Compose v2.40.3.
- 8 GiB RAM, 4 vCPU, approximately 133 GB disk, no swap.
- `/opt/yarsalam` (root:root 0755), `/opt/yarsalam/secrets` (root:root 0700), and `/srv/yarsalam` (root:root 0755) exist.
- No application stack has been started on this VPS.

## Repository-specific caution

The current `docker-compose.yml` is development-oriented and has example credentials/source mounts. The current production overlay still layers over the large base Compose file, hides ports but does not disable all optional AI services, and builds the backend from source on the VPS. Do not run its documented `up -d --build` command. First design a minimal production Compose file using CI-built image digests and only the services approved for the first release.

## Next actions

1. Review and improve the production build pipeline in GitHub.
2. Define minimal runtime-only production Compose and a non-secret `.env.production.example`.
3. Inspect rendered Compose configuration, service list, published ports, volumes, health checks, resource limits, and migration behavior.
4. Decide the initial minimum service set; keep optional AI, WhatsApp, and admin services off until separately approved.
5. Establish backup/restore, monitoring, rollback, TLS, and connectivity-outage procedures.
6. Deploy only after explicit approval and after the exact image digests and Compose configuration are reviewed.

See [PRODUCTION_DEPLOYMENT_POLICY.md](PRODUCTION_DEPLOYMENT_POLICY.md) for the shared release gates.
