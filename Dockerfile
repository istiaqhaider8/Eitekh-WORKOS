# Eitekh WorkOS — production image.
#
# WHY MULTI-STAGE
#
# The build needs the full dependency tree, the Prisma CLI and the source; the
# runtime needs none of them. Building and running in one stage ships a compiler
# toolchain and every devDependency to production, which is both a larger image
# and a larger attack surface for no benefit.
#
# WHY NODE 24
#
# package.json declares engines >= 22.18, because scripts/ import application
# TypeScript through Node's native type stripping. CI runs 24; this matches it
# deliberately, since a runtime that differs from the tested one is exactly how
# the A5 drill broke (see .github/workflows/ci.yml).

# ---------------------------------------------------------------- deps
FROM node:24-alpine AS deps
WORKDIR /app

# Prisma's engines need this on Alpine.
RUN apk add --no-cache libc6-compat

# Only the manifests, so this layer is cached until dependencies actually
# change — the single biggest influence on rebuild time.
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------- build
FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The client must exist before the build: route handlers import it at compile
# time, and a missing client fails the build with an error that points at the
# import rather than at the missing generate step.
RUN npx prisma generate

# NEXT_TELEMETRY_DISABLED: a build should not phone home from a CI runner.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM node:24-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# A non-root user, created rather than assumed. The node image ships one, but
# creating it explicitly means the uid is stable and documented.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# `standalone` traces the server's own imports and a minimal node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets are NOT traced into standalone. Missing these is the classic
# first-container mistake: the app boots, serves HTML, and every script, style
# and font 404s.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migrations and the Prisma schema, so the image can run `migrate deploy`
# itself rather than requiring a separate toolchain at deploy time.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000

# /api/health checks the database too, so an unhealthy container is one that
# cannot do its job — not merely one whose process is alive. It returns 503
# when the database is unreachable, which is what should take an instance out
# of a load balancer.
#
# start-period is generous because the first request compiles routes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
