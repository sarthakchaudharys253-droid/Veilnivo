# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --global pnpm@11.25.0

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
# Public connection mode only. Database/JWT/provider secrets are runtime values.
ARG NEXT_PUBLIC_API_MODE=same-origin
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_MODE=$NEXT_PUBLIC_API_MODE NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 SERVE_FRONTEND=true FRONTEND_DIR=out
COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/tsconfig.json ./
# Prisma migration CLI and tsx are intentionally retained for the deploy start command.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src/lib/compat.ts ./src/lib/compat.ts
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/out ./out
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD node scripts/healthcheck.mjs
CMD ["node", "scripts/start-production.mjs"]
