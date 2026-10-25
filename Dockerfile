# ---- build: compile the TypeScript
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ src/
RUN npm run build && npm prune --omit=dev

# ---- run: only the compiled app, production dependencies, the page and the seed catalogue
FROM node:24-alpine
WORKDIR /app
# the commit being built, shown in the page's footer (the image has no .git to read it from):
# docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) .
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
ENV NODE_ENV=production \
    PORT=8080 \
    LIBRARY=/library \
    POLL_SECONDS=30 \
    KEEP_BACKUPS=5 \
    PUID=1000 \
    PGID=1000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/dist/ dist/
COPY web/ web/
COPY seed/ seed/
# the KOReader plugin, served as a zip from Admin → Imports (src/koreader-sync)
COPY koreader/readingdashboard.koplugin/ koreader/readingdashboard.koplugin/

# starts as root only to hand /library to PUID:PGID, then drops to that user
VOLUME ["/library"]
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

# node:sqlite still prints an "experimental" warning on every start; it is stable enough here
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/main.js"]
