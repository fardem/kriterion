# ---- Bauphase: uebersetzt die native Datenbankanbindung ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# npm ci statt npm install: nur so wird das Lockfile ueberhaupt gelesen.
# npm install loeste die Bereiche aus package.json jedes Mal neu auf -- zwei
# Baeume desselben Standes waren dann verschieden. npm ci bricht ab, wo
# install nachgaebe: passt das Lockfile nicht zur package.json, ist das
# ein Fehler und kein stiller Ausweg.
RUN npm ci --omit=dev
COPY . .

# ---- ffmpeg fuer die Proxys: liest alle Formate, schreibt nur H.264, AAC und MP4 ----
FROM node:22-bookworm-slim AS ffbuild
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential nasm pkg-config xz-utils \
      libx264-dev libva-dev libdrm-dev libdav1d-dev zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*
# Eine neue Version: FFMPEG und die Pruefsumme von ffmpeg.org zusammen aendern.
ARG FFMPEG=9.0.2
ADD --checksum=sha256:8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e \
    https://ffmpeg.org/releases/ffmpeg-${FFMPEG}.tar.xz /src/
WORKDIR /src
RUN tar xf ffmpeg-${FFMPEG}.tar.xz && cd ffmpeg-${FFMPEG} \
 && ./configure --prefix=/opt/ff --disable-debug --disable-doc --disable-ffplay --disable-ffprobe \
      --disable-autodetect --enable-gpl --enable-libx264 --enable-libdav1d --enable-vaapi --enable-libdrm --enable-zlib \
      --disable-encoders --enable-encoder=libx264,h264_vaapi,aac \
      --disable-muxers --enable-muxer=mp4,mov,null \
      --disable-filters --enable-filter=scale,scale_vaapi,format,hwupload,null,anull,aresample,aformat,testsrc2 \
      --disable-devices --enable-indev=lavfi \
      --disable-protocols --enable-protocol=file,pipe,http,tcp \
 && make -j"$(nproc)" && make install && strip /opt/ff/bin/ffmpeg

# ---- Laufzeit: ohne Uebersetzungswerkzeuge ----
FROM node:22-bookworm-slim
WORKDIR /app
# Schrift fuer das Vorschaubild von Textdateien; ohne sie zeichnet sharp nur Kaesten.
# Den Treiber fuer Quick Sync gibt es bei Debian nur fuer amd64.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core libx264-164 libva2 libva-drm2 libdrm2 libdav1d6 \
 && if [ "$(dpkg --print-architecture)" = amd64 ]; then \
      apt-get install -y --no-install-recommends intel-media-va-driver; fi \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ffbuild /opt/ff/bin/ffmpeg /usr/local/bin/ffmpeg
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
COPY --from=builder /app /app
RUN mkdir -p /app/data
EXPOSE 3000
# Ohne diese Zeile weiss Docker nur, dass der Prozess laeuft -- nicht, ob er
# antwortet. Ein Container in einer Neustartschleife saehe von aussen gesund
# aus. Gefragt wird /api/config: es antwortet schon vor der Anmeldung und
# verraet nichts ueber den Bestand.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
