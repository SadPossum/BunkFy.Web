# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS build
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

FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236 AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i '/^user  nginx;/d' /etc/nginx/nginx.conf \
    && touch /run/nginx.pid \
    && chown nginx:nginx /run/nginx.pid \
    && chown -R nginx:nginx /var/cache/nginx
USER nginx
EXPOSE 8080
