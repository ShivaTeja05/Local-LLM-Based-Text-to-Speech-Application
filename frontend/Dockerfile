# Ellie frontend: build the Angular app, then serve it with nginx, which also proxies /api.

# --- 1. Build -------------------------------------------------------------
# Node 24 ships npm 11, which reads package-lock.json exactly as it was written.
FROM node:24-slim AS build
WORKDIR /src
ENV NG_CLI_ANALYTICS=false
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx ng build

# --- 2. Serve -------------------------------------------------------------
FROM nginx:1.29-alpine
# Where nginx sends /api (the compose service name by default).
ENV BACKEND_URL=http://backend:8000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
