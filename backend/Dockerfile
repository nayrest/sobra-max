FROM node:24-bookworm-slim

WORKDIR /app

# Нативных модулей нет (pg, express — чистый JS), компиляторы не нужны.
# ca-certificates — чтобы добавить сертификат НУЦ Минцифры для HTTPS к MAX API.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY russian_trusted_root_ca.crt /usr/local/share/ca-certificates/russian_trusted_root_ca.crt

RUN update-ca-certificates

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

CMD ["node", "index.js"]