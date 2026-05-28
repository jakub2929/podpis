# Podpis PDF

Webová aplikace pro podepisování PDF dokumentů přímo v prohlížeči.
**Žádný backend — dokument neopouští zařízení uživatele.** Kreslení podpisu
i export podepsaného PDF probíhají lokálně přes [PDF.js](https://mozilla.github.io/pdf.js/)
a [pdf-lib](https://pdf-lib.js.org/).

## Funkce

- Drag & drop nebo výběr PDF souboru
- Vícestránkový PDF viewer (PDF.js, retina-ready)
- Vytvoření podpisu kreslením na canvas (myš / dotyk / pero, volitelná barva a tloušťka)
- Nebo nahrání obrázku podpisu (PNG/JPG, ideálně s průhledným pozadím)
- Drag & resize podpisu nad stránkou
- Více podpisů na různých stránkách
- Export do nového PDF s vepsanými podpisy
- Tmavé UI v češtině

## Lokální vývoj

Žádný build krok není potřeba. Aplikace je čistá statika, ale musí
běžet přes HTTP server (kvůli PDF.js workeru a `fetch()` na vendor knihovny).

```bash
# 1. Stáhněte vendor knihovny (jednorázově)
mkdir -p vendor
PDFJS=3.11.174
PDFLIB=1.17.1
curl -fsSL -o vendor/pdf.min.js \
  "https://unpkg.com/pdfjs-dist@${PDFJS}/legacy/build/pdf.min.js"
curl -fsSL -o vendor/pdf.worker.min.js \
  "https://unpkg.com/pdfjs-dist@${PDFJS}/legacy/build/pdf.worker.min.js"
curl -fsSL -o vendor/pdf-lib.min.js \
  "https://unpkg.com/pdf-lib@${PDFLIB}/dist/pdf-lib.min.js"

# 2. Spusťte jakýkoli statický server
python3 -m http.server 8080
# nebo: npx serve .
```

Pak otevřete <http://localhost:8080>.

## Build & spuštění v Dockeru

```bash
docker build -t podpis-pdf .
docker run --rm -p 8080:80 podpis-pdf
```

Aplikace běží na <http://localhost:8080>.

Vendor knihovny se stahují v build fázi z `unpkg.com` — v běžícím
kontejneru už žádné externí volání není.

## Nasazení na Coolify

### Doporučená varianta: Docker Compose build pack

Repo už obsahuje `docker-compose.yml`, který Coolify rozpozná automaticky.

1. **New Resource → Application**.
2. Zdroj: **Git repository** (GitHub / GitLab / vlastní). Vyberte branch.
3. **Build Pack: Docker Compose**.
4. **Compose file path**: `docker-compose.yml` (default).
5. **Domains**: přidejte doménu, Coolify vyřídí TLS přes Traefik.
6. **Deploy**. První build trvá ~1–2 minuty (stáhne vendor knihovny, postaví nginx vrstvu).

Port (80) i healthcheck jsou definované v `docker-compose.yml` a `Dockerfile`,
nemusíte v Coolify nic dalšího nastavovat.

### Alternativa: čistý Dockerfile build pack

Pokud nechcete compose, lze v Coolify zvolit **Build Pack: Dockerfile**
a nastavit **Exposed Port: 80**. Funkčně rovnocenné.

### Volitelné build args

V Coolify v sekci *Build → Build Arguments* (Compose dědí z `docker-compose.yml`):

| ARG              | Default    | Význam                  |
|------------------|------------|-------------------------|
| `PDFJS_VERSION`  | 3.11.174   | verze pdfjs-dist (UMD)  |
| `PDFLIB_VERSION` | 1.17.1     | verze pdf-lib           |

### Co Coolify dělá automaticky

- Postaví obraz z `Dockerfile`.
- Pustí kontejner s `restart: unless-stopped`.
- Předřadí Traefik proxy s TLS certifikátem pro vaši doménu.
- Spustí healthcheck každých 30 s; pokud spadne 3× za sebou, restartuje.
- Při dalším push do branch (pokud máte zapnuté auto-deploy) obraz přestaví.

### Update knihoven

Změňte verze v `docker-compose.yml` (`PDFJS_VERSION`, `PDFLIB_VERSION`),
commitněte, push → Coolify postaví znovu. (Pozor: PDF.js v4+ je ESM-only
a v této aplikaci nefunguje bez úpravy `index.html` na `type="module"`.)

## Struktura projektu

```
.
├── index.html
├── css/style.css
├── js/
│   ├── app.js              # orchestrace UI
│   ├── pdf-viewer.js       # render PDF.js
│   ├── signature-pad.js    # canvas kreslení
│   ├── signature-overlay.js# drag/resize <div> nad stránkou
│   └── exporter.js         # pdf-lib zápis a download
├── vendor/                  # plněno za build-time (pdf.js, pdf-lib)
├── Dockerfile
├── docker-compose.yml       # pro Coolify Compose build pack
├── nginx.conf
├── .dockerignore
└── .gitignore
```

## Soukromí

- Žádná telemetrie, žádný backend, žádné externí volání za běhu.
- Soubor je čten přes `FileReader` → `ArrayBuffer` v paměti prohlížeče.
- Podpis i hotové PDF vznikají lokálně. Download jde přes `Blob URL`.
- `Content-Security-Policy` lze v nginx.conf doplnit pokud chcete uzamknout
  povolené zdroje (defaultně to není nutné — všechny zdroje jsou same-origin).

## Známá omezení

- Velmi velká PDF (stovky stránek, GB) mohou narazit na limity paměti prohlížeče.
- Stránky s rotací 90/180/270° fungují díky `viewport.convertToPdfPoint()`,
  ale stojí za to ověřit na konkrétním dokumentu.
- Podpis se vepisuje nad obsah; krycí výplň/redakce není cíl této aplikace.
