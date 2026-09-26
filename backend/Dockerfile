FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 \
       make \
       g++ \
       ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY russian_trusted_root_ca.crt /usr/local/share/ca-certificates/russian_trusted_root_ca.crt

RUN update-ca-certificates

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

CMD ["node", "index.js"]