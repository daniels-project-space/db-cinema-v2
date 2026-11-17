FROM node:22-alpine3.22@sha256:cd7807368cf24826297cbad5dca1a44972ccfd770647db52a8c7589eb4599ac8
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY scanner.cjs ./
USER 1000:101
ENV CLAMD_SOCKET=/run/clamav/clamd.sock CHAT_SCANNER_TMPDIR=/run/scanner-tmp PORT=8787 CHAT_SCANNER_BIND_HOST=0.0.0.0
EXPOSE 8787
HEALTHCHECK --interval=5m --timeout=8s --start-period=2m --retries=2 CMD ["node","-e","const t=process.env.CHAT_SCANNER_TOKEN;if(!t)process.exit(1);const n=require('node:crypto').randomUUID().replace(/-/g,'');fetch('http://127.0.0.1:'+process.env.PORT+'/health',{headers:{Authorization:'Bearer '+t,'X-Scan-Nonce':n},signal:AbortSignal.timeout(7000)}).then(async r=>{const b=await r.json();process.exit(r.ok&&b.ready===true&&b.nonce===n?0:1)}).catch(()=>process.exit(1))"]
CMD ["node","scanner.cjs"]
