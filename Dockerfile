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

# ---- Laufzeit: ohne Uebersetzungswerkzeuge ----
FROM node:22-bookworm-slim
WORKDIR /app
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
