# État des lieux – image du serveur local
# Image de base (modifiable : docker compose build --build-arg NODE_IMAGE=...)
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}

# openssl : certificat auto-signé si HTTPS=true ; tzdata : heure locale dans les journaux
RUN apk add --no-cache openssl tzdata

WORKDIR /app
COPY server/server.js server/healthcheck.js ./
COPY public ./public

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public \
    INTERNAL_PORT=8080

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "healthcheck.js"]

CMD ["node", "server.js"]
