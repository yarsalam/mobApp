# Yarsalam foreign Staging and AI evaluation lab

This lab is separate from the Iranian VPS. It uses a fresh MySQL database,
Redis project, Qdrant volume and synthetic identities. Never import production
environment files, production database dumps, payment destinations, WhatsApp
sessions or real user uploads.

## Topology

- Always-on test infrastructure: NestJS backend, MySQL, Redis and Qdrant.
- Every AI microservice is behind its own Docker Compose profile.
- PHPMyAdmin and WhatsApp Listener remain off unless their staging profiles
  are explicitly requested.
- MySQL, Redis and Qdrant have no host-published ports.
- Backend port 5001 is intended for a PRIVATE Codespaces forwarded port.
- Each AI service has a local-loopback debug port plus a CPU/RAM limit.

## One-time Codespaces setup

The repository includes `.devcontainer/devcontainer.json` with a requested
minimum of 4 CPU cores and 16 GB RAM, Docker-in-Docker + Compose v2, and private
forwarding for the API and AI Ops test ports. This machine is intended for the
backend plus one AI model at a time.

1. Open the branch-specific Codespaces creation page:
   https://codespaces.new/yarsalam/mobApp/tree/infra%2Fstaging-ai-lab-2026-11
2. Confirm the payer displayed by GitHub is your personal account and choose a
   machine matching 4 cores / 16 GB RAM. If that machine is unavailable or
   would require paid usage, do not create it; tell us which machine types are
   shown.
3. Keep both forwarded ports private.
4. The post-create hook generates a private `.env.staging` file. The
   post-start hook then automatically validates Compose, starts MySQL, Redis,
   Qdrant and the Backend, builds only the AI Ops dependency chain, starts
   `ai_ops`, and waits for its HTTP health endpoint.
5. When the Codespace finishes starting, open the **Ports** tab. The staging
   API (5001) and AI Ops (18025) are forwarded as private ports. No terminal
   command is required to bring up the initial test environment.
6. Optional diagnostics in the integrated terminal:

       bash scripts/staging/ai-service.sh status
       bash scripts/staging/ai-service.sh ai-logs ai_ops

   Other AI services can be started one at a time with
   `bash scripts/staging/ai-service.sh ai-up SERVICE_NAME` and stopped with
   `bash scripts/staging/ai-service.sh ai-stop SERVICE_NAME`.


1. Open the yarsalam/mobApp repository on GitHub.
2. Select branch infra/staging-ai-lab-2026-11.
3. Select Code -> Codespaces -> Create codespace on branch.
4. Prefer a 4-core / 16-GB machine while testing the backend plus one heavy AI
   service. If only a 2-core / 8-GB machine is offered, start with the base
   stack and lightweight AI services.
5. In the Codespaces terminal, run:

       bash scripts/staging/bootstrap.sh
       bash scripts/staging/ai-service.sh validate
       bash scripts/staging/ai-service.sh base-up

The bootstrap creates a private .env.staging with fresh random credentials.
It refuses to overwrite an existing file and does not copy any production
secret.

## Enable or disable each AI service

Start with only one large model service at a time. This protects the RAM and
disk budget and makes per-service attribution possible.

    bash scripts/staging/ai-service.sh ai-up ai_assistant
    bash scripts/staging/ai-service.sh ai-status ai_assistant
    bash scripts/staging/ai-service.sh ai-logs ai_assistant
    bash scripts/staging/ai-service.sh ai-stop ai_assistant

Service names:

    ai_ops
    ai_feedback
    ai_seo
    ai_monetization
    ai_revenue
    ai_assistant
    ai_moderation
    ai_verification
    embedded_ai
    ml_service
    ai_uplift
    ai_backlink_quality
    ai_seo_recommender
    personality
    ai_image
    ai_support
    aeo_tracker

Moderation and Matching depend on the embedding service. Starting the
moderation profile also starts embedded_ai; starting ml_service does the same.
Stop each dependency separately after its consumer is stopped.

## Clean-build notes

The historical service Dockerfiles depend on locally prebuilt base images and
a local downloaded_wheels directory. Those prebuilt images and wheel files are
not committed. This lab therefore contains separate network-enabled base
Dockerfiles and builds only the base-image dependency chain needed by the
selected AI service. Production Dockerfiles and production image workflows are
not replaced.

## Embedding model provisioning

The Staging Embedding service uses the public
`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` model from
Hugging Face, pinned to revision
`e8f8c211226b894fcb81acc59f3b34ba3efd5f42`. The model card describes a
384-dimensional sentence embedding model for 50 languages and declares the
Apache-2.0 license.

The model binary is intentionally not committed to Git. Before
`ai_moderation`, Matching, or Embedding starts, `ai-service.sh ai-up`
invokes `scripts/staging/prepare-embedding-model.sh`. That one-shot container
downloads the pinned snapshot into the Docker named volume
`embedding_model_hub_cache` mounted at `/app/model-cache`, creates a Persian
embedding, and verifies its 384-dimensional finite output. The actual service
then starts using the same cache. Subsequent starts reuse it without another
download. The empty historical
`python-ai/services/embedded_ai/models/minilm-model` bind mount is replaced
in the Staging overlay, so it cannot shadow the downloaded model.

The Embedding health check now requires all of the following: the model is
loaded, the embedding dimension is 384, and Redis responds to ping. Moderation
depends on Embedding being healthy rather than merely started. If the model
cannot be downloaded or loaded, Moderation will not start in this Staging
profile. Do not bypass that dependency or label the service healthy.

To inspect the runtime state:

    docker logs embedded_ai --tail=100
    curl -fsS http://127.0.0.1:18104/health
    curl -fsS http://127.0.0.1:18018/health

The first model load requires outbound access to Hugging Face and several
hundred megabytes of free disk space. No Hugging Face token is required for
this public model. The named volume persists across container recreation;
do not delete it when rebuilding the service. The staging base-image builder
tracks each Dockerfile hash so a changed cache-permission layer is rebuilt
instead of silently reusing an old local base image.

Personality still has separate local sentiment/emotion model assets that have
not been provisioned. A running container or a plain HTTP /health response
alone is not proof that a model is loaded.

## Synthetic benchmark

Generate deterministic test fixtures:

    python scripts/ai-eval/generate_fixtures.py \
      --seed 20261110 \
      --output /tmp/yarsalam-ai-eval

Initial fixture sizes:
- 300 synthetic profiles;
- 1,500 directed Matching candidate pairs with expected hard-eligibility labels;
- 700 Persian Moderation cases spanning safe, external-contact, financial
  solicitation, harassment, threat, lexical-collision and obfuscation classes;
- 100 Assistant grounding/privacy prompts;
- 100 Support ticket classification cases.

Every record is tagged synthetic_only and all identities use SYN-* identifiers.
These are controlled test inputs, not real-user data, not training data and not
evidence about the Yarsalam audience or psychometric accuracy.

The validation workflow checks Compose configuration and fixture
contracts. The runtime Moderation job downloads the pinned Embedding model,
checks its actual 384-dimensional output, and runs the unique synthetic
Moderation cases through the live HTTP API. It uploads a confusion-matrix
report, excluding `review` labels from binary accuracy because the current
Python API exposes only allow/block outcomes. This is a plumbing and
regression check, not human-validated policy ground truth. OCEAN needs
independent Persian human/validated questionnaire data; Matching needs
offline ranking and hard-constraint evaluation. Passing synthetic fixtures
alone does not authorize broad real-world marketing claims.

To reproduce the Moderation evaluation after generating the fixtures and
starting `ai_moderation`:

    python scripts/ai-eval/evaluate_moderation.py \\
      --fixtures /tmp/yarsalam-ai-eval/moderation_cases.jsonl \\
      --output /tmp/moderation-evaluation.json

## Codespaces free quota

GitHub's current documentation lists 120 core-hours and 15 GB-month of
Codespaces storage for personal GitHub Free accounts. A 4-core Codespace uses
4 core-hours per active hour, so the compute allowance is at most 30 active
hours per month before accounting for other Codespaces usage. If no valid
payment method is attached, GitHub blocks Codespaces usage after the included
quota is exhausted. No card should be added for this lab; stop the Codespace
when finished and do not approve paid usage.


GitHub documents 120 core-hours and 15 GB-month of Codespaces storage per
personal GitHub Free account. A 4-core machine consumes 4 core-hours per active
hour (up to 30 hours from the compute allowance); a 2-core machine consumes 2
core-hours per active hour (up to 60 hours). Codespaces stops after an idle
timeout by default. If there is no valid payment method, usage is blocked after
the included quota is exhausted. No card is needed for the included allowance,
but this is not a 24/7 free VPS. Check account usage and stop the Codespace
when it is not in use.

GitHub Actions on this public repository runs short, repeatable validation jobs;
it is not the interactive Staging server.

## Safety boundary

- No production data, credentials, payment details or user conversations.
- No live payment settlement, outbound messaging or WhatsApp login.
- Codespaces forwarded ports must remain private.
- No VPS deployment and no changes to the Iranian server.
- Staging uses the separate yarsalam-staging Compose project. Stop commands
  preserve named volumes; never use down -v or prune commands here.
