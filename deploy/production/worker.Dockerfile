# Production worker (Inngest functions). Runs the database migrations and the production seed before it starts,
# so a deploy brings the schema up to date by itself. Build from the repository root:
#   docker build -f deploy/production/worker.Dockerfile -t aqua-worker .
# Needs at least DATABASE_URL (the platform database, owner connection), INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY and
# RSWIM_MASTER_KEY. See docs/saas/ENVIRONMENT.md for the full list.
FROM node:22-bookworm-slim
RUN npm install -g pnpm@10.28.0 && apt-get update && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@rswim/worker..." --filter "@rswim/db..." --filter "@rswim/seed..."
ENV NODE_ENV=production TZ=Asia/Jerusalem PORT=3030
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/deploy/production/worker-start.sh"]
