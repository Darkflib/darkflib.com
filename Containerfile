# darkflib.com: Caddy with the built site baked in.
#
# One image carries the web server, its configuration, and the assets, so the CSP and cache policy in
# deploy/Caddyfile always ship with the code they describe (a Fault Lab origin added to connect-src arrives with the
# code that fetches it). This differs from sre-tab, where stock Caddy serves assets copied out of the application
# image into a volume: that split exists to keep an API and its frontend in step, and there is no API here.
#
# Plain Dockerfile syntax (no BuildKit-only features), so Docker and Podman build it identically. Base images are
# pinned by tag and digest; the Caddy digest is the one sre-tab-web runs, so the two share layers on the host.
#
#   podman build --format docker --build-arg BUILD_SHA="$(git rev-parse HEAD)" --tag darkflib.com:dev .
#
# --format docker keeps the HEALTHCHECK, which OCI format drops and darkflib-web.container's Notify=healthy needs.

# --- Build ------------------------------------------------------------------
FROM docker.io/library/node:24-trixie-slim@sha256:50c3b2f6988dfc307b86e5301d69611af31f4789bdf232863b07d3b02fe55ae0 AS build

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# There is no .git in the build context, so the commit comes in as build args (read by build/buildInfo.ts).
ARG BUILD_SHA
ARG BUILD_DIRTY=false
ENV BUILD_SHA=${BUILD_SHA} BUILD_DIRTY=${BUILD_DIRTY}

# vite build only: typechecking is CI's job, and a failing typecheck there already blocks publishing.
RUN test -n "$BUILD_SHA" || { echo "BUILD_SHA build arg is required" >&2; exit 1; }; \
    npx vite build

# --- Runtime ----------------------------------------------------------------
FROM docker.io/library/caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/dist /srv/www
COPY lab/origins /srv/lab

# No escalation paths on a read-only, capability-dropped container. The find after the chmod asserts the end state
# rather than trusting the traversal's exit status.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
    && find / -xdev -perm /6000 -type f -exec chmod a-s '{}' + \
    && remaining="$(find / -xdev -perm /6000 -type f)" \
    && if [ -n "$remaining" ]; then echo "setuid/setgid bits survived: $remaining" >&2; exit 1; fi

# Caddy's own non-root convention (65532), matching sre-tab-web. /data and /config are tmpfs in the Quadlet.
USER 65532:65532

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:8080/healthz"]

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
