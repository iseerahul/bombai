# Bambai in a container.
#
# WHAT THIS IS FOR. Production is Cloudflare Workers — `npm run worker:deploy`.
# This image is for the cases Cloudflare is a bad fit for: running the whole
# thing on one machine, handing an evaluator a single command, or working on a
# host where `wrangler dev` cannot run at all (Smart App Control blocks
# workerd.exe on some managed Windows machines, which is why the Node shim this
# image runs exists in the first place).
#
# It is NOT a Workers emulator. D1 is real SQLite on a volume, R2 is a
# directory, and none of the platform's limits, cron triggers or Durable
# Objects are here. Deployment correctness is still `wrangler deploy`'s job.
#
# Node 22+ is required and not incidental: the D1 shim is built on the
# built-in `node:sqlite`, which does not exist before it.

# ---------------------------------------------------------------------------
# Stage 1 — build both front ends and the Worker bundle
# ---------------------------------------------------------------------------
FROM node:24-slim AS build

WORKDIR /build

# Dependencies first, so editing source does not re-run either install. The two
# apps have separate trees: the map at the root, the landing in its own repo.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY mumbai-zenscape/package.json mumbai-zenscape/
# No lockfile is committed for the landing (Lovable manages it with bun), so
# this cannot be `npm ci`.
RUN cd mumbai-zenscape && npm install --no-audit --no-fund

COPY . .

# Order matters: the map builds into dist/app, then the landing is prerendered
# and copied on top of dist/ around it. build-landing.mjs fails loudly rather
# than overwrite dist/app if the two ever collide.
RUN npm run build && node scripts/build-worker.mjs

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Only what the server actually reads at runtime. No node_modules: the shim
# has no dependencies left once it is handed a prebuilt bundle, which is the
# whole reason build-worker.mjs exists.
COPY --from=build /build/dist ./dist
COPY --from=build /build/scripts/dev-server.mjs ./scripts/dev-server.mjs
COPY --from=build /build/worker/schema.sql ./worker/schema.sql

# The database and uploaded photos live here. Mount a volume over it or the
# first `docker rm` takes every account, pin and photo with it.
ENV DATA_DIR=/data
# Skips esbuild at boot — the bundle was built in stage 1.
ENV WORKER_BUNDLE=/app/dist/worker.mjs
# Without this the server binds the CONTAINER's loopback, the published port
# reaches nothing, and every request returns an empty reply.
ENV HOST=0.0.0.0
RUN mkdir -p /data && chown -R node:node /data /app

# `node` rather than root: this process serves uploads and runs a SQL database.
USER node
EXPOSE 8787

# No shell form, so Node is PID 1 and receives SIGTERM directly — otherwise
# `docker stop` waits the full timeout and then kills it mid-write.
CMD ["node", "scripts/dev-server.mjs", "--port=8787"]
