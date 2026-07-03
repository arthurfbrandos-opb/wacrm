# syntax=docker/dockerfile:1
# Multi-stage build for the Next.js 16 standalone server.
# Stage 1 installs deps, stage 2 builds, stage 3 ships only the
# standalone output. NEXT_PUBLIC_* must be present at BUILD time
# (they are inlined into the client bundle), so they arrive as
# build args; runtime-only secrets come from env_file at `docker run`.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_GOOGLE_PICKER_KEY
ARG NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_GOOGLE_PICKER_KEY=$NEXT_PUBLIC_GOOGLE_PICKER_KEY \
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER=$NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Standalone output: server.js + traced node_modules + static assets.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
