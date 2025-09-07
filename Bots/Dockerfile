# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.18.0
FROM node:${NODE_VERSION}-alpine

ENV NODE_ENV=production

WORKDIR /usr/src/app

# Install with dev deps so patch-package exists, apply patches, then prune dev deps away.
# Also make 'patches/' available during install so postinstall can find them.
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=bind,source=patches,target=patches \
    --mount=type=cache,target=/root/.npm \
    npm ci \
 && npm prune --omit=dev

USER node
COPY . .
CMD ["node", "AdminBot.js"]
