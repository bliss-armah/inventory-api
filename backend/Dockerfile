FROM node:22-alpine AS deps
WORKDIR /app
# Prisma 5 ships OpenSSL-linked Rust engines. Without libssl present, the
# engine postinstall and loader mis-detect musl's OpenSSL, fall back to
# "openssl-1.1.x", and then try to fetch the missing binary at runtime --
# which fails as the non-root user and crash-loops the container.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./
RUN npx prisma generate
RUN npm run typecheck

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Prisma 5 ships OpenSSL-linked Rust engines. Without libssl present, the
# engine postinstall and loader mis-detect musl's OpenSSL, fall back to
# "openssl-1.1.x", and then try to fetch the missing binary at runtime --
# which fails as the non-root user and crash-loops the container.
RUN apk add --no-cache openssl
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
RUN mkdir -p /app/uploads && chown -R app:app /app/uploads
USER app
EXPOSE 5000
CMD ["sh", "-c", "npx prisma migrate deploy && node --import tsx src/server.ts"]
