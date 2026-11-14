# Production web app, for hosts other than Vercel (Railway, Fly, any container host). On Vercel the repository is
# built directly (docs/saas/DEPLOY.md). Build from the repository root:
#   docker build -f deploy/production/web.Dockerfile \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... -t aqua-web .
# The worker container runs the migrations; this one only serves pages.
FROM node:22-bookworm-slim AS build
RUN npm install -g pnpm@10.28.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@rswim/web..."
# Public values are baked into the browser bundle at build time; secrets are never build arguments.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production TZ=Asia/Jerusalem
RUN pnpm --filter @rswim/web build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Jerusalem PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1
USER node
WORKDIR /app/apps/web
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec node_modules/.bin/next start --hostname 0.0.0.0 --port ${PORT}"]
