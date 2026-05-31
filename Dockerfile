# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    PORT=3001 \
    PAPERLESS_MCP_DATA=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
VOLUME ["/data"]
EXPOSE 3001
CMD ["node", "dist/index.js"]
