# lite-tv: no npm dependencies, so the image is just Node plus the source.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY backends ./backends
COPY public ./public
# Sign-ins are stored in /data. Mount a volume or folder there so they survive restarts.
# The container starts as root only to give /data to PUID:PGID, then runs as that user (see server.js).
RUN mkdir -p /data
ENV PORT=6972 DATA_DIR=/data NODE_ENV=production PUID=1000 PGID=1000
VOLUME /data
EXPOSE 6972
HEALTHCHECK --interval=60s --timeout=5s CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/ping.gif" || exit 1
CMD ["node", "server.js"]
