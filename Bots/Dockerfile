# syntax=docker/dockerfile:1
ARG NODE_VERSION=22.18.0
FROM node:${NODE_VERSION}-alpine

WORKDIR /usr/src/app

# 1) Copy only manifests + patches first to maximize layer cache
COPY package.json package-lock.json ./
COPY patches ./patches

# 2) Install WITH dev deps so patch-package can run, then prune dev deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci \
 && npm prune --omit=dev

# 3) Now copy the rest of the source
COPY . .

# 4) Production env & non-root
ENV NODE_ENV=production
USER node

# 5) JSON-form CMD
CMD ["node", "AdminBot.js"]
