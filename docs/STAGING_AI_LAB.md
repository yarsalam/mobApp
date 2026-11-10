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

Some model assets are still absent from the repository. In particular,
Personality expects local sentiment/emotion weights, and Embedding expects a
MiniLM model path. A running container or an HTTP /health response alone is
not proof that the model is loaded. Missing model assets must be reported as a
blocker, not replaced with fake "healthy" data.

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

The first validation workflow checks Compose configuration and fixture
contracts. It does not yet certify AI output quality. Service-specific
evaluation must be added against inspected endpoint contracts and available
model assets. Moderation results require confusion matrices and false-positive
analysis; OCEAN needs independent Persian human/validated questionnaire data;
Matching needs offline ranking and hard-constraint evaluation. Passing this
synthetic suite alone does not authorize broad real-world marketing claims.

## Codespaces free quota

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
