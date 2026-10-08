# The live demo: Postgres, the Inngest dev server, the worker and the web app in one container, on fake data only.
# Build from the repository root:  docker build -f deploy/demo/Dockerfile -t rswim-demo .
# Run:                             docker run -p 3000:3000 rswim-demo
FROM node:22-bookworm-slim AS node

FROM postgres:16-bookworm
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
    TZ=Asia/Jerusalem \
    RSWIM_DEMO_SCHOOL_NAME="שחייה בכיף (דמו)" \
    RSWIM_DEMO_OWNER_NAME="יעל"
RUN pnpm --filter @rswim/web build

EXPOSE 3000
ENTRYPOINT []
CMD ["/app/deploy/demo/start.sh"]
