# syntax=docker/dockerfile:1
ARG NODE_VERSION=22.18.0
FROM node:${NODE_VERSION}-alpine

WORKDIR /usr/src/app

# Install WITH devDeps so patch-package exists; patches/ must be present for postinstall.
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=bind,source=patches,target=patches \
    --mount=type=cache,target=/root/.npm \
    npm ci \
 && npm prune --omit=dev

# Now switch to production mode (after pruning) and copy the rest.
ENV NODE_ENV=production

USER node
COPY . .

# JSON-form CMD (handles signals properly)
CMD ["node", "AdminBot.js"]
