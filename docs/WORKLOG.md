# Work Log

This file is durable project memory for future Codex conversations. Keep it
short, factual, and current.

## Current State

- Active branch: `main`
- Open PR: `none observed`
- Base branch: `main`
- Unrelated worktree changes: existing local edits in Dockerfile, compose files,
  server, UI routing/menu, and OpenRouter chat model files before this audit.

## Tasks

| Status | Task | Notes | Verification |
| --- | --- | --- | --- |
| Done | Fix malformed UTF-8 credential error | Hardened credential decryption so Agent node failures surface an actionable encryption-key/credential message instead of raw `Malformed UTF-8 data` or silent `{}`. | RED reproduced with Docker Jest `pnpm --filter flowise-components test -- src/utils.test.ts --runInBand`; GREEN same test passed 45/45; Docker builds `pnpm --filter flowise-components build` and `pnpm --filter flowise build`; `git diff --check`; production Docker stack `POSTGRES_PASSWORD=flowise_test_password POSTGRES_PORT=55435 FLOWISE_PORT=3103 docker compose -p flowise-credential-error-test up --build -d`; `/api/v1/readyz`, `/api/v1/livez`, `/api/v1/version`; Flowise logs scanned for error/warn; stack cleaned up. |
| Done | Add provider prompt-cache support | Added OpenAI prompt cache key routing controls on the OpenAI chat model and preserved provider cached-token usage details for analytics, OTel, and LangSmith metadata. | `git diff --check`; `docker build` production path via `POSTGRES_PASSWORD=flowise_test_password POSTGRES_PORT=55434 FLOWISE_PORT=3102 docker compose -p flowise-prompt-cache-test up --build -d`; `/api/v1/readyz`, `/api/v1/livez`, `/api/v1/ping`, `/api/v1/version`, root HTML; API create/get/delete chatflow smoke using `x-request-from: internal`; Flowise logs scanned for error/warn; Docker Jest run for `pnpm --filter flowise-components test -- handler.test.ts --runInBand` passed 32/32. |
| Done | Continue production optimization | Lazy-loaded markdown math plugins so the default markdown chunk no longer embeds MathJax. `MemoizedReactMarkdown` dropped from ~2.59MB/~898KB gzip to ~790KB/~277KB gzip; MathJax moved to an on-demand ~1.79MB/~619KB gzip chunk that is not loaded on default Agentflows/mobile smoke. | `git diff --check`; `POSTGRES_PASSWORD=flowise_test_password POSTGRES_PORT=55433 FLOWISE_PORT=3101 docker compose -p flowise-opt-test up --build -d`; `/api/v1/readyz`; asset size inspection inside container; Playwright desktop Agentflows + Agent Canvas smoke with zero console warnings/errors; Playwright mobile smoke with no horizontal overflow and `mathChunkLoaded=false`; Flowise/Postgres logs scanned for errors. |
| Done | End-to-end production smoke test | Fixed Docker production build blockers found during smoke test: stale `pnpm-lock.yaml` for `packages/ui` `zod`, non-TTY `pnpm prune`, and prune `postinstall`/husky failure. Stack booted with Postgres, migrations ran, UI rendered, and API write/read/delete smoke passed. Also removed redundant runtime-stage `chown -R /usr/src/flowise`, reducing that layer from ~198s to ~1.3s in local Docker build. | `git diff --check`; `POSTGRES_PASSWORD=flowise_test_password POSTGRES_PORT=55432 FLOWISE_PORT=3100 docker compose -p flowise-system-test up --build -d`; `POSTGRES_PASSWORD=flowise_test_password POSTGRES_PORT=55432 FLOWISE_PORT=3100 docker compose -p flowise-system-test build flowise`; `curl` probes for `/api/v1/livez`, `/api/v1/readyz`, `/api/v1/ping`, `/api/v1/version`, root HTML, and static JS asset; Postgres migration/index queries; Playwright desktop/mobile smoke with zero console warnings/errors; API create/get/delete chatflow smoke using `x-request-from: internal`. |
| Done | Implement production performance and cost optimizations | Applied bounded queue/body/cache defaults, Docker/compose production defaults, readiness/liveness, static cache headers, graceful shutdown, DB indexes, chatflow hot-path reuse/cache, chat pagination, LLM/RAG cache/retriever fixes, ingestion caps, metrics, and Artillery profile from `docs/PRODUCTION_OPTIMIZATION_AUDIT.md`. | `git diff --check`; `POSTGRES_PASSWORD=test docker compose config`; `docker buildx build --check .`; `node --check packages/ui/vite.config.js`. Full pnpm test/build not run because local `pnpm` and dependencies are absent. |
| Done | Production performance and cost optimization audit | Read-only codebase audit with multiple subagents; consolidated report written to `docs/PRODUCTION_OPTIMIZATION_AUDIT.md`. | Inspected repo configs/source and incorporated server/runtime, components/LLM/RAG, Docker/UI, and QA handoffs. |

## Decisions

- Keep existing user code changes untouched.
- Main thread owns `docs/WORKLOG.md` and the final audit report.
- Subagents are read-only and return findings with file references, risk,
  priority, and verification suggestions.
