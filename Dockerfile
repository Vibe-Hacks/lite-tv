# lite-tv: no npm dependencies, so the image is just Node plus the source.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY backends ./backends
COPY public ./public
# Login sessions are stored in /data. Mount a volume there so sign-ins survive restarts.
RUN mkdir -p /data && chown node:node /data
ENV PORT=6972 DATA_DIR=/data NODE_ENV=production
VOLUME /data
EXPOSE 6972
HEALTHCHECK --interval=60s --timeout=5s CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/ping.gif" || exit 1
USER node
CMD ["node", "server.js"]
