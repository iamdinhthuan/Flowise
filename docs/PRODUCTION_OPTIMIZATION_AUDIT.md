# Flowise Production Speed and Cost Optimization Audit

Date: 2026-05-11  
Scope: read-only audit of the local Flowise fork for production speed, infrastructure cost, and LLM/provider spend. Multiple subagents reviewed server/runtime, components/LLM/RAG, Docker/UI/build, and QA/observability. This report consolidates the findings into one implementation backlog.

## Codebase Index

| Area | Main files | Production relevance |
| --- | --- | --- |
| Monorepo orchestration | `package.json`, `pnpm-workspace.yaml`, `turbo.json` | Build/test/start scripts, Docker build target, workspace dependency graph. |
| Server runtime | `packages/server/src/index.ts`, `packages/server/src/commands/start.ts`, `packages/server/src/DataSource.ts` | Express setup, database init, static UI serving, auth, metrics, shutdown. |
| API routes/services | `packages/server/src/routes`, `packages/server/src/controllers`, `packages/server/src/services`, `packages/server/src/utils/buildChatflow.ts`, `packages/server/src/utils/upsertVector.ts` | Hot paths for predictions, chat history, vector upserts, document stores, auth, quota checks. |
| Queue mode | `packages/server/src/queue/*`, `packages/server/src/commands/worker.ts` | BullMQ job execution, concurrency, Redis usage, backpressure, job retention. |
| Component nodes | `packages/components/nodes`, `packages/components/src` | LLM wrappers, embeddings, vector stores, retrievers, loaders, caches, token/cost metadata. |
| UI | `packages/ui/src/routes/*`, `packages/ui/vite.config.js`, `packages/ui/package.json` | Bundle size, route chunks, static asset cache behavior, Lite UI surface. |
| Deployment | `Dockerfile`, `docker-compose.yml`, `docker/Dockerfile`, `docker/worker/Dockerfile` | Runtime image size, dependency pruning, user/volume paths, health checks. |
| QA/observability | `.github/workflows/main.yml`, `artillery-load-test.yml`, `metrics/*`, `packages/server/src/metrics/*` | Regression guardrails for build, test, load, metrics, health, and production readiness. |

## Executive Summary

The biggest production wins are not model-level tweaks yet. The current fork still has major runtime and deployment costs: a 3GB-class Docker image, an unsafe queue concurrency default, global 50MB body parsing, repeated chatflow/database lookups on prediction paths, missing composite indexes, and shallow health/load testing.

For LLM spend, there are valuable optimizations already starting, especially OpenRouter/Anthropic prompt caching and agentflow cost metadata. The missing pieces are cache safety, pricing metadata caching, RAG retrieval correctness, query embedding reuse, ingestion guardrails, and verification tests so cost reductions do not silently change behavior.

Recommended order:

1. Fix production deployment baseline: pruned runtime image, correct volume path for `USER node`, `NODE_ENV=production`, frozen installs, real health/readiness.
2. Put hard limits on concurrency, body sizes, job retention, ingestion sizes, and static asset caching.
3. Reduce hot-path database and parser overhead: request-scoped chatflow context, TTL cache, and composite indexes.
4. Fix provider-cost bugs: model pricing cache, Redis cache pooling, query embedding cache, multi-store retriever merge, RRF retrieval behavior.
5. Add performance/cost guardrails: real Artillery scenarios, metrics tests, Cypress smoke, Docker image-size budget, bundle budget, and token/cost regression checks.

## Implementation Pass

Applied in this workspace:

- Docker/compose production defaults: frozen install, pruned runtime deps, node user volume path, production env, readiness healthcheck, resource/env knobs.
- Runtime safety: bounded body parser defaults with larger limits only for upload/prediction/webhook-style routes, raw body retained only for webhooks, static asset cache headers, readiness/liveness endpoints, graceful HTTP/DB/Redis shutdown.
- Queue controls: default worker concurrency reduced to 5, per-queue concurrency envs supported, completed/failed job retention defaults added.
- Database/query path: production composite indexes for Postgres, SQLite, MySQL, and MariaDB; non-feedback chat message pagination; short-TTL chatflow cache with invalidation; request-scoped prediction chatflow reuse.
- LLM/RAG cost controls: local/default model list lookup with TTL cache, Redis LLM cache connection reuse and pipelined writes, query embedding cache, bounded cache pools, multi-store retriever merge/dedupe, parallel RRF search using configured `topK`, RecordManager namespace restore, optional ingestion caps.
- Observability/guardrails: Prometheus route normalization and wider latency buckets, Docker/compose checks, and an environment-driven Artillery smoke/load profile.

## P0 Findings

### 1. Runtime Docker image is massively oversized

Evidence:

- `Dockerfile:35` runs plain `pnpm install`.
- `Dockerfile:55` copies the whole builder workspace into runtime.
- Docker/UI subagent measured local `flowise-lite:latest` at about `3.39GB`, with `/usr/src/flowise/node_modules` about `2.4GB`.

Impact:

- Higher registry transfer time, cold start time, disk use, CI time, and vulnerability surface.
- Runtime contains source, dev dependencies, build tooling, TS files, and unused workspace packages.

Recommendation:

- Build a real production artifact layer with only `packages/server/dist`, `packages/components/dist`, `packages/ui/build`, required package metadata, and production dependencies.
- Use `pnpm install --frozen-lockfile` plus BuildKit cache mounts.
- Prefer `pnpm --filter flowise deploy --prod <out>` if it works for this monorepo, otherwise `pnpm prune --prod` in a copied runtime tree.
- Set `NODE_ENV=production`.
- Avoid installing global `pnpm` in the final image if the command can run through `node packages/server/bin/run start` or an installed binary.

Verification:

```bash
docker build -t flowise-lite-audit .
docker image inspect flowise-lite-audit --format '{{.Size}}'
docker run --rm flowise-lite-audit sh -lc 'du -sh /usr/src/flowise /usr/src/flowise/node_modules'
```

### 2. Compose volume path likely does not match runtime user

Evidence:

- `Dockerfile:57` runs as `node`.
- `docker-compose.yml:41-42` mounts `flowise_data` at `/root/.flowise`.
- Flowise defaults use `$HOME/.flowise`; for the `node` user that is normally `/home/node/.flowise`.

Impact:

- Secrets, logs, uploads, local SQLite/storage, and encryption key can become ephemeral or split between `/root/.flowise` and `/home/node/.flowise`.
- This can create confusing production data loss or duplicate state.

Recommendation:

- Mount `flowise_data:/home/node/.flowise`, or explicitly set `DATABASE_PATH`, `SECRETKEY_PATH`, `LOG_PATH`, and `BLOB_STORAGE_PATH` to a mounted writable directory owned by `node`.
- Keep local storage paths consistent across server, worker, and compose files.

Verification:

```bash
docker compose config
docker compose up --build -d
docker compose exec flowise sh -lc 'id; echo $HOME; ls -la $HOME/.flowise /root/.flowise 2>/dev/null || true'
```

### 3. Queue defaults can create runaway provider spend

Evidence:

- `packages/server/src/queue/BaseQueue.ts:8` defaults `WORKER_CONCURRENCY` to `100000`.
- `packages/server/src/queue/BaseQueue.ts:40-56` leaves `removeOnComplete` unset unless `REMOVE_ON_*` is configured.

Impact:

- In queue mode, a burst can overwhelm LLM providers, DB, Redis, vector stores, and storage.
- Completed jobs can accumulate in Redis, raising memory cost and slowing queue operations.

Recommendation:

- Default prediction/upsert/schedule concurrency to small bounded values, for example `5`, `2`, and `2`, then tune from load tests.
- Expose per-queue env vars: `PREDICTION_WORKER_CONCURRENCY`, `UPSERT_WORKER_CONCURRENCY`, `SCHEDULE_WORKER_CONCURRENCY`.
- Set default `removeOnComplete` by age/count, for example keep last `1000` or `24h`.
- Add queue saturation metrics: active, waiting, delayed, failed, completed, oldest job age.

Verification:

```bash
WORKER_CONCURRENCY=5 REMOVE_ON_COUNT=1000 docker compose -f docker/docker-compose-queue-source.yml up -d
```

Then load test predictions and inspect Redis job counts before/after.

### 4. Global 50MB body parser wastes memory and bypasses route-specific limits

Evidence:

- `packages/server/src/index.ts:200-209` registers global JSON/urlencoded parsers with default `FLOWISE_FILE_SIZE_LIMIT=50mb`.
- The parser also captures `rawBody` for every parsed request even though raw bytes are only needed for webhook signature verification.

Impact:

- Large request bodies are allocated before route-specific controls can apply.
- Memory pressure and GC cost increase on every JSON-heavy endpoint.
- Smaller limits intended by downstream routes can be ineffective if registered after this global parser.

Recommendation:

- Move body parsers to routers with endpoint-specific limits.
- Keep large parser limits only for upload/prediction routes that need base64.
- Capture raw body only for webhook signature routes.
- Register MCP and other strict-limit routes before broad body parsing.

Verification:

```bash
node --trace-gc packages/server/bin/run start
```

Send 1MB, 10MB, and 50MB requests to prediction, webhook, and MCP routes and compare RSS and HTTP status before/after.

## P1 Findings

### 5. Prediction hot path fetches/parses chatflow repeatedly

Evidence:

- CORS/domain validation can fetch chatflow via `packages/server/src/utils/domainValidation.ts`.
- `packages/server/src/controllers/predictions/index.ts` fetches chatflow for origin validation.
- `packages/server/src/services/chatflows/index.ts` fetches/parses again for streaming validity.
- `packages/server/src/utils/buildChatflow.ts` fetches chatflow again before execution.

Impact:

- Extra DB round-trips and repeated `JSON.parse(flowData/chatbotConfig/apiConfig)` on the highest-value API path.
- Latency grows with large flows and high request rates.

Recommendation:

- Add request-scoped `chatflowContext` with chatflow entity, parsed `flowData`, parsed configs, streamability, workspace/org, subscription/product, and API-key result.
- Add a small TTL/read-through cache keyed by `chatflowId + updatedDate`.
- Invalidate on chatflow save/update/delete and API config changes.

Verification:

- Add temporary query count logging around `/api/v1/prediction/:id`.
- Target: one chatflow load per request, or zero DB loads on fresh cache hit.

### 6. Common DB filters need composite indexes

Evidence:

- `ChatMessage` only has single-column `chatflowid` index while chat history filters by `chatflowid`, `chatId` or `sessionId`, and orders by `createdDate`.
- `ChatFlow` list/count/API-key paths filter by workspace/type/apikey and order by name or updated date.
- `Execution` has single-column indexes but hot queries use workspace/agentflow/session/date combinations.

Recommended migrations:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_flow_workspace_type_updated
ON chat_flow ("workspaceId", "type", "updatedDate" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_flow_workspace_apikey_name
ON chat_flow ("workspaceId", "apikeyid", "name");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_message_flow_session_date
ON chat_message ("chatflowid", "sessionId", "createdDate");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_message_flow_chat_date
ON chat_message ("chatflowid", "chatId", "createdDate");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_execution_workspace_agent_session_date
ON execution ("workspaceId", "agentflowId", "sessionId", "createdDate" DESC);
```

Use non-concurrent equivalents for SQLite/MySQL/MariaDB migrations.

Verification:

```sql
EXPLAIN ANALYZE SELECT ... -- chat history, flow list, execution list hot queries
```

Compare scan type, rows examined, and p95 latency.

### 7. Chat message pagination is incomplete on non-feedback path

Evidence:

- `packages/server/src/utils/getChatMessage.ts` accepts `page` and `pageSize`.
- The non-feedback `.find()` path does not apply `skip`/`take`; it can return all matching messages with execution relation.

Impact:

- Large sessions can produce slow responses, high DB memory, and high API payload cost.

Recommendation:

- Apply pagination consistently for non-feedback queries.
- Add composite indexes above.
- Consider default page size for UI/API when no explicit limit is provided.

### 8. Static UI serving lacks production cache/compression policy

Evidence:

- `packages/server/src/index.ts:396-404` serves `flowise-ui/build` with bare `express.static`.

Impact:

- Hashed Vite assets do not get explicit immutable cache headers.
- `index.html` can be cached incorrectly by intermediaries.
- No Brotli/gzip precompressed asset serving strategy.

Recommendation:

- Serve `/assets/*` with `Cache-Control: public, max-age=31536000, immutable`.
- Serve `index.html` with `Cache-Control: no-cache`.
- Generate and serve `.br`/`.gz` files or put a CDN/reverse proxy in front.

Verification:

```bash
curl -I http://localhost:3000/assets/<hashed>.js
curl -I http://localhost:3000/
```

### 9. UI bundle lacks budget and chunk strategy

Evidence:

- `packages/ui/vite.config.js:41-42` only configures `outDir`.
- Docker/UI subagent measured roughly `8.4MB` JS, 380 JS files, and 5 chunks over 512KB in a local build.
- Heavy libraries include CodeMirror, Tiptap/lowlight, ReactFlow, Recharts, Markdown/syntax highlighting, MUI icons, and docstore/canvas views.

Recommendation:

- Add bundle analyzer and CI budget.
- Use `manualChunks` for editor, markdown/syntax, ReactFlow/canvas, MUI/icons, docstore/vectorstore, and charts.
- Remove `react-scripts` if Vite is the only active build path.
- Replace broad icon imports with narrow imports where possible.

Verification:

```bash
pnpm --filter flowise-ui build
npx vite-bundle-visualizer packages/ui
```

### 10. Production logging is too chatty by default

Evidence:

- `packages/server/src/DataSource.ts` enables Postgres `error`, `warn`, `info`, and `log`, plus notifications.
- `packages/server/src/utils/logger.ts` logs most non-GET API requests to both request and server loggers.
- `packages/components/nodes/chatmodels/ChatOpenRouter/FlowiseChatOpenRouter.ts` uses direct `console.debug`.

Impact:

- Higher CPU/I/O cost, noisy logs, and possible sensitive prompt leakage in diagnostic paths.

Recommendation:

- Default production `LOG_LEVEL=warn`.
- Disable TypeORM `info/log` and notifications unless explicitly enabled.
- Sample request logs or only log slow/error requests.
- Route model debug output through the app logger and guard by debug level.

## LLM, RAG, and Provider Cost Findings

### 11. Model/pricing lookup can hit remote GitHub repeatedly

Evidence:

- `packages/components/src/modelLoader.ts:36-41` defaults `MODEL_LIST_CONFIG_JSON` to a raw GitHub URL.
- `modelLoader.ts:63-74` reloads the model file for each config lookup.
- Agentflow cost paths call pricing lookup after LLM runs.

Impact:

- Unnecessary outbound calls, latency, and fragility on hot cost-metadata paths.
- Production cost accounting depends on GitHub availability unless overridden.

Recommendation:

- Default production to local bundled `models.json`.
- Cache parsed model metadata in process with TTL and manual invalidation.
- Add startup warning if production uses a remote model config URL.

### 12. Agentflow multi-store retriever pays for earlier stores then drops results

Evidence:

- `packages/components/nodes/agentflow/Retriever/Retriever.ts:153-175` loops over knowledge bases but assigns `docs = ...` inside the loop.

Impact:

- Retrieval/vector calls are paid for each store, but only the last store result is returned.
- Accuracy and cost both suffer.

Recommendation:

- Run safe retrievals in parallel with bounded concurrency.
- Merge, dedupe by source/document id, and rerank.
- Add tests proving multiple knowledge bases return combined documents.

### 13. RRF retriever does extra sequential vector searches

Evidence:

- `packages/components/nodes/retrievers/RRFRetriever/ReciprocalRankFusion.ts:45-53` generates alternative queries then loops sequentially.
- It hard-codes `similaritySearch(..., 5, ...)` instead of using configured `topK/fetchK`.

Impact:

- More vector-store calls than expected, slower retrieval, and wasted spend.

Recommendation:

- Make RRF a direct retriever or avoid duplicate base retrieval.
- Use `Promise.all` with bounded concurrency.
- Use configured `topK/fetchK`.
- Cache generated query variants for repeated queries.

### 14. RecordManager namespace mutation can break dedupe and cause re-embedding

Evidence:

- `packages/components/src/indexing.ts:265-266` mutates `recordManager.namespace` by appending `vectorStoreName`.

Impact:

- Reusing a manager can compound suffixes, miss existing record keys, and re-embed documents unnecessarily.

Recommendation:

- Derive scoped namespace immutably.
- Clone/wrap the manager per vector store instead of mutating shared state.
- Add tests for repeated upserts with the same manager.

### 15. Redis caches add latency and miss query embedding reuse

Evidence:

- `packages/components/nodes/cache/RedisCache/RedisCache.ts:54-77` performs sequential `GET` calls and quits the client after lookup.
- `RedisCache.ts:82-101` performs sequential `SET` calls and quits the client after update.
- `packages/components/nodes/cache/RedisCache/RedisEmbeddingsCache.ts:131-134` bypasses cache for `embedQuery`.

Impact:

- Redis cache can become slower than expected under load.
- Repeated retrieval queries still pay embedding provider cost.

Recommendation:

- Use pooled shared Redis clients, MGET/pipelining, and avoid connect/quit per operation.
- Cache query embeddings as well as document embeddings.
- Namespace embedding cache keys by provider, model, dimensions, and normalization settings.
- Add TTL and max-size policy.

### 16. Cache pools are unbounded

Evidence:

- `packages/server/src/CachePool.ts` stores LLM, embedding, MCP, and SSO caches in memory or Redis.
- LLM/embedding Redis entries are set without expiry in queue mode.

Impact:

- Long-running production nodes can leak memory or Redis storage.
- Cache growth cost is invisible without metrics.

Recommendation:

- Add TTL, LRU/max-entry controls, and cache metrics: hit/miss, size, evictions, Redis errors.
- Expose sane production env defaults.

### 17. Document ingestion lacks cost guardrails

Evidence:

- File/folder/S3 loaders load full sources before splitting.
- Current preview caps web scraper limit, but production upsert paths still need hard byte/page/chunk/token estimates.

Impact:

- A large folder or S3 object can trigger large parsing, chunking, embedding, and vector-store bills.

Recommendation:

- Enforce max bytes, pages, files, chunks, and estimated embedding tokens before embedding calls.
- Add dry-run/preflight cost estimate.
- For S3, skip unchanged sources via `ETag`/`LastModified`.
- Make ingestion caps visible in UI and API errors.

## Observability and QA Gaps

### 18. Health checks are shallow

Evidence:

- `packages/server/src/controllers/ping/index.ts:3-6` returns only `pong`.
- `docker-compose.yml:43-48` uses `/api/v1/ping` as the app healthcheck.

Impact:

- Orchestrators can route traffic to an app with failed DB, Redis, queues, migrations, or node pool initialization.

Recommendation:

- Add `/livez` for process liveness.
- Add `/readyz` for DB initialized, migrations complete, Redis/queue ready when enabled, node pool ready, and storage path writable.
- Keep provider reachability out of readiness unless explicitly configured; report it as degraded instead.

### 19. Metrics buckets and labels are not production-ready for LLM workloads

Evidence:

- `packages/server/src/metrics/Prometheus.ts:79-83` HTTP duration buckets stop at `500ms`.
- `Prometheus.ts:96-100` defines labels for `http_requests_total`, but `Prometheus.ts:136` increments without labels.

Impact:

- LLM/RAG calls lasting seconds or minutes are not observable with useful buckets.
- Request metrics can lose method/path/status label fidelity.

Recommendation:

- Use buckets such as `0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120`.
- Add route normalization to avoid high-cardinality IDs.
- Add counters/histograms for LLM tokens, estimated cost, cache hit/miss, retrieval count, embedding calls, queue wait time, and job duration.
- Add unit/integration tests for metrics registration and increments.

### 20. E2E and load tests do not protect production optimization work

Evidence:

- `.github/workflows/main.yml:32-37` runs install/lint/build/coverage.
- Cypress is wired in CI, but QA subagent found current specs effectively commented out.
- `artillery-load-test.yml:5-26` uses a placeholder target and only an 8-request, 3-second scenario.

Impact:

- Speed/cost changes can regress user flows, streaming, queue mode, or token spend without detection.

Recommendation:

- Add Lite production smoke E2E: bootstrap/login if applicable, agentflow list/create/open, prediction, API key, variables, executions, metrics/health.
- Replace Artillery placeholder with env-driven scenarios:
  - internal prediction
  - external prediction with API key
  - streaming
  - agentflow execution
  - queue mode
  - RAG/vector upsert
- Add thresholds for p95/p99, error rate, memory, queue wait time, and token/cost budget.
- Add Docker compose health smoke and image-size budget in CI.

## Suggested Implementation Roadmap

### Phase 1: Production Baseline

1. Fix Docker runtime image pruning and `USER node` volume path.
2. Set `NODE_ENV=production`, frozen installs, BuildKit cache, and reproducible compose env.
3. Add `/livez` and `/readyz`.
4. Fix graceful shutdown: keep `http.Server`, call `server.close()`, drain SSE/jobs, flush telemetry, close DB/Redis/session stores.

Success metrics:

- Runtime image under a defined budget, ideally below `1GB` first, then lower after dependency pruning.
- Cold start and RSS measured before/after.
- Readiness fails when DB/Redis is down.

### Phase 2: Hot Path Server Optimization

1. Route-specific body parsers and raw-body capture only where needed.
2. Request-scoped `chatflowContext` plus TTL cache.
3. Composite DB indexes and pagination fixes.
4. Static asset cache/compression policy.
5. Production log defaults and slow/error request logging.

Success metrics:

- Lower query count per prediction.
- Lower p95 latency on prediction/public chatbot/config/chat history.
- Lower RSS under large request rejection tests.

### Phase 3: Cost Controls for LLM and RAG

1. Cache `models.json` and make local config the production default.
2. Fix multi-store retriever merge/dedupe/rerank.
3. Refactor RRF to avoid duplicate sequential retrieval work.
4. Redis cache pooling, pipelining, TTLs, query embedding cache.
5. Immutable record-manager namespace.
6. Ingestion caps and preflight embedding cost estimates.

Success metrics:

- Fewer embedding/provider calls for repeated queries/upserts.
- Multi-store retrieval returns correct merged results.
- Repeated upsert skips unchanged docs.
- Cost metadata remains accurate and tested.

### Phase 4: Guardrails

1. Real Cypress smoke tests.
2. Artillery/autocannon production scenarios.
3. Metrics tests.
4. Bundle analyzer and bundle budget.
5. Docker image-size budget.
6. Token/cost regression fixtures for representative flows.

Suggested commands:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test:coverage
pnpm --filter flowise cypress:run
docker build -t flowise-lite-audit .
POSTGRES_PASSWORD=test_password docker compose up --build -d
curl -fsS http://localhost:3000/api/v1/ping
curl -fsS http://localhost:3000/readyz
artillery run --output reports/load.json artillery-load-test.yml
```

## Open Questions Before Implementation

1. Is `LITE_MODE=true` intended to support only Agentflows V2, or must legacy chatflows/vector/document-store routes remain usable through API?
2. Should production standardize on Postgres + Redis, or must SQLite/local-only remain a first-class deployment?
3. Which LLM providers/models are production defaults? This determines cache namespace and cost-pricing tests.
4. Are uploads and document-store files expected to live in local volume, S3/GCS/Azure, or both?
5. What target budgets should be enforced: image size, cold start, RSS, p95 latency, p99 latency, monthly provider spend, and max cost per prediction?

## Highest-Value Backlog

| Priority | Work item | Expected gain | Risk |
| --- | --- | --- | --- |
| P0 | Pruned production Docker image | Lower infra cost, faster deploy/start, smaller attack surface | Medium: workspace deploy needs careful packaging. |
| P0 | Fix volume path for `node` user | Prevent data/secrets/log split or loss | Low. |
| P0 | Queue concurrency/job retention defaults | Prevent runaway LLM/Redis spend | Medium: must tune per workload. |
| P0 | Route-specific body parsing | Lower memory/DoS exposure | Medium: webhook/upload parsing must be preserved. |
| P1 | Chatflow context/cache | Lower DB/JSON parse latency | Medium: invalidation correctness. |
| P1 | Composite DB indexes | Faster chat history/list/execution queries | Medium: migration per DB vendor. |
| P1 | Fix RAG retrieval bugs | Lower provider/vector cost and better answers | Medium: behavior changes need tests. |
| P1 | Redis cache pooling/query embeddings | Lower latency and embedding spend | Medium: cache key correctness. |
| P1 | Model metadata cache | Avoid remote hot-path lookup | Low. |
| P2 | Real load/E2E/metrics guardrails | Prevent regressions | Low to medium. |
