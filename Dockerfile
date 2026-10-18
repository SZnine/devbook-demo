# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY immersive-review/package.json immersive-review/package-lock.json ./
RUN npm ci
COPY immersive-review/ ./
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production READ_HOST=0.0.0.0 READ_PORT=5174 READ_DATA_DIR=/data
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/build/server.mjs ./build/server.mjs
USER node
EXPOSE 5174
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.READ_PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build/server.mjs"]
