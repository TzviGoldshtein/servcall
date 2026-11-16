FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /src
COPY server/package.json server/pnpm-lock.yaml* server/
COPY web/package.json web/pnpm-lock.yaml* web/
RUN cd server && pnpm install --no-frozen-lockfile
RUN cd web && pnpm install --no-frozen-lockfile
COPY . .
RUN cd web && pnpm build
RUN cd server && pnpm build

FROM node:22-bookworm-slim
RUN corepack enable \
 && apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-noto-core fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=build /src/server/package.json ./
COPY --from=build /src/server/node_modules ./node_modules
COPY --from=build /src/server/dist ./dist
COPY --from=build /src/server/migrations ./migrations
COPY --from=build /src/web/dist ./web
ENV WEB_DIR=/app/web
EXPOSE 3000
CMD ["node", "dist/index.js"]
