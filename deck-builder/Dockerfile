FROM node:22-bookworm-slim

# LibreOffice turns the .pptx into a PDF copy. Noto gives the PDF Arabic glyphs;
# the .pptx itself uses Arial, which every Office install has.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-impress fonts-noto-core fonts-liberation2 fontconfig \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY assets ./assets
COPY examples ./examples
COPY SPEC.md ./

ENV PORT=8000 OUTPUT_DIR=/data/out HOME=/tmp
RUN mkdir -p /data/out && chown -R node:node /data
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
