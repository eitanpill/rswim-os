# The live demo: Postgres, the Inngest dev server, the worker and the web app in one container, on fake data only.
# Build from the repository root:  docker build -f deploy/demo/Dockerfile -t rswim-demo .
# Run:                             docker run -p 3000:3000 rswim-demo
#
# Railway reads the root railway.json, which points here, for every service made from this repository, and it no
# longer lets a new service choose another config file. So this file also builds the production worker when the
# service has the variable RSWIM_IMAGE=worker (Railway passes it as a build argument). Without it, it is the demo.
# The worker stage is deploy/production/worker.Dockerfile; keep the two the same.
ARG RSWIM_IMAGE=demo

FROM node:22-bookworm-slim AS node

FROM postgres:16-bookworm AS demo
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && npm install -g pnpm@10.28.0 inngest-cli@1.46.0 \
 && inngest-cli version

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# Baked in at build time as well: Next.js reads some environment while building.
ENV RSWIM_DEMO_MODE=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    TZ=Asia/Jerusalem
RUN pnpm --filter @rswim/web build

EXPOSE 3000
ENTRYPOINT []
CMD ["/app/deploy/demo/start.sh"]

# The production worker (same as deploy/production/worker.Dockerfile).
FROM node:22-bookworm-slim AS worker
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

FROM ${RSWIM_IMAGE}
