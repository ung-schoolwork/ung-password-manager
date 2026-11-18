# Production image: the Next.js standalone server on Node 24, run as uid 1000.
# Built and pushed to ghcr.io by .github/workflows/image.yml; see deploy/kubernetes.

FROM oven/bun:1.3.14 AS build
WORKDIR /app
# next build runs on Node, as it does in CI; Bun only installs dependencies.
COPY --from=node:24-slim /usr/local/bin/node /usr/local/bin/node
COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile
COPY . .
# The public origin baked into anything generated at build time (such as the
# Chrome extension download). The server still reads APP_ORIGIN at run time.
ARG APP_ORIGIN=https://passwords.mediasave.llc
ENV APP_ORIGIN=$APP_ORIGIN \
    EXTENSION_APP_ORIGIN=$APP_ORIGIN \
    NEXT_TELEMETRY_DISABLED=1
# public/ is optional; create it so the runtime COPY below always has a source.
RUN mkdir -p public && bun run build

FROM node:24-slim
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/.next/static ./.next/static
COPY --from=build --chown=1000:1000 /app/public ./public
USER 1000:1000
EXPOSE 3000
CMD ["node", "server.js"]
