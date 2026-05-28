# syntax=docker/dockerfile:1.6

# --- stage 1: stáhnout vendor knihovny (PDF.js + pdf-lib) ---
# Knihovny stahujeme za build-time, aby aplikace za běhu nezávisela
# na žádném CDN (= dokumenty zůstávají u uživatele).
FROM alpine:3.20 AS vendor
RUN apk add --no-cache curl

WORKDIR /vendor

# PDF.js 3.x = poslední větev s UMD legacy buildem (kompatibilní s prostým <script>).
# Verze 4.x už ships jen ES moduly.
ARG PDFJS_VERSION=3.11.174
ARG PDFLIB_VERSION=1.17.1

# PDF.js legacy UMD build (kompatibilní s prostým <script>, bez ES modulů)
RUN curl -fsSL -o pdf.min.js \
      "https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.js" \
 && curl -fsSL -o pdf.worker.min.js \
      "https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.js"

# pdf-lib (UMD)
RUN curl -fsSL -o pdf-lib.min.js \
      "https://unpkg.com/pdf-lib@${PDFLIB_VERSION}/dist/pdf-lib.min.js"

# --- stage 2: nginx servíruje statiku ---
FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY index.html /usr/share/nginx/html/index.html
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/

COPY --from=vendor /vendor/pdf.min.js        /usr/share/nginx/html/vendor/pdf.min.js
COPY --from=vendor /vendor/pdf.worker.min.js /usr/share/nginx/html/vendor/pdf.worker.min.js
COPY --from=vendor /vendor/pdf-lib.min.js    /usr/share/nginx/html/vendor/pdf-lib.min.js

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
