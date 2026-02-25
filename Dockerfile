# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
# Keep runtime compatibility for alpine/node native deps.
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
# Install dependencies based on the preferred package manager.
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/.cache/yarn \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    if [ -f yarn.lock ]; then yarn --frozen-lockfile --network-timeout 600000; \
    elif [ -f package-lock.json ]; then npm ci --no-audit --prefer-offline --progress=false; \
    elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
    else echo "Lockfile not found." && exit 1; \
    fi

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Persist Next.js build cache across rebuilds (requires BuildKit).
RUN --mount=type=cache,target=/app/.next/cache \
    --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/.cache/yarn \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    set -eux; \
    if [ -f yarn.lock ]; then yarn run build; \
    elif [ -f package-lock.json ]; then npm run build; \
    elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \
    else echo "ERROR: Lockfile not found." && exit 1; \
    fi

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache.
RUN mkdir -p .next && chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
