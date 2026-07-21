# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_BUNKFY_API_BASE_URL=/
ARG VITE_BUNKFY_EMAIL_VERIFICATION_ENABLED=false
ENV VITE_BUNKFY_API_BASE_URL=$VITE_BUNKFY_API_BASE_URL
ENV VITE_BUNKFY_EMAIL_VERIFICATION_ENABLED=$VITE_BUNKFY_EMAIL_VERIFICATION_ENABLED
RUN pnpm build

FROM nginx:1.28-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i '/^user  nginx;/d' /etc/nginx/nginx.conf \
    && touch /run/nginx.pid \
    && chown nginx:nginx /run/nginx.pid \
    && chown -R nginx:nginx /var/cache/nginx
USER nginx
EXPOSE 8080
