# NestJS backend — runtime-only deployment

## Invariants
- Build and scan the production image in GitHub Actions; the VPS does not build from source.
- The final Node image contains only runtime dependencies, dist, package metadata, and the existing public assets mount target. Build toolchain and source checkout stay out of the final image.
- This Compose file has only the backend service and references the existing external yarsalam_network.
- It does not define MySQL, Redis, Qdrant, Python services, or AI Packs. Updating the API must not recreate or delete these dependencies.
- Existing public uploads must remain at their current host path and be mounted read-write at /app/public.

## Required private environment values
The existing private .env.production must contain the current production secrets/config plus:
- BACKEND_IMAGE_TAG=sha-<full-mobApp-commit>
- PUBLIC_ASSETS_DIR=<absolute path to the current public-assets directory>

Do not place the environment file or secrets in Git or inside the image. Before writing the two new variables, inspect the running container mounts and Compose labels to establish the exact current paths. Never guess the public upload directory.

## Read-only preflight before backend replacement
On the VPS:
    docker inspect backend --format 'project={{index .Config.Labels "com.docker.compose.project"}} service={{index .Config.Labels "com.docker.compose.service"}}'
    docker inspect backend --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
    docker network inspect yarsalam_network --format '{{.Name}}'

Use the exact project identity returned by the running backend container when invoking Compose. Confirm the public-assets source path exactly matches PUBLIC_ASSETS_DIR. Confirm MySQL, Redis and Qdrant remain healthy/on their existing networks. Do not run a project-wide down or use the old development Compose file.

## Limited runtime replacement
Only after the image has been published and rollback details recorded:
    docker compose --env-file .env.production -p "$EXISTING_PROJECT" -f docker-compose.runtime.yml pull backend
    docker compose --env-file .env.production -p "$EXISTING_PROJECT" -f docker-compose.runtime.yml up -d --no-deps --force-recreate backend

The actual runtime directory must contain this Compose file and the private env file. The public-assets mount is an existing persistent path outside the image. These commands are templates, not executed. Verify API health/logs and confirm existing DB/Redis dependencies and upload data remain available.

## Existing image workflow
The branch feat/ci-runtime-backend-image contains .github/workflows/backend-runtime-image.yml. It builds the multi-stage image in Actions, scans it with Trivy, and pushes an immutable commit tag on main. Do not use the moving latest tag for production selection. Set BACKEND_IMAGE_TAG only to the full SHA tag printed by a successful workflow.
