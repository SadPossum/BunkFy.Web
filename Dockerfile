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
EXPOSE 8080
