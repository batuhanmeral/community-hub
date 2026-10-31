# ─── Build stage ──────────────────────────────
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build

WORKDIR /app

# In the compose setup nginx proxies /api and /media to the backend, so the SPA
# talks to the same origin. Override at build time for split deployments.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Serve stage ──────────────────────────────
# Unprivileged build: nginx runs as uid 101, so it cannot bind ports below 1024.
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e AS serve

# Alpine fixes land before the pinned base is rebuilt; apk needs root.
USER root
RUN apk upgrade --no-cache

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
