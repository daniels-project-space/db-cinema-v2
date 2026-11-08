FROM node:22-alpine3.22@sha256:cd7807368cf24826297cbad5dca1a44972ccfd770647db52a8c7589eb4599ac8
RUN apk add --no-cache mupdf-tools=1.25.6-r1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY scanner.cjs ./
USER 1000:101
ENV CLAMD_SOCKET=/run/clamav/clamd.sock CHAT_SCANNER_TMPDIR=/run/scanner-tmp PORT=8787
CMD ["node","scanner.cjs"]
