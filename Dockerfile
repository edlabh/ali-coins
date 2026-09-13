FROM node:18-slim

# Instalar dependências essenciais de runtime do Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libnss3 \
    libnspr4 \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache compartilhado de binários do navegador Playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV CI=true

# Instalar dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev && npx playwright install chromium

# Copiar código-fonte da aplicação
COPY . .

# Permissões de execução dos scripts
RUN chmod +x run_*.sh setup_*.sh push_to_github.sh 2>/dev/null || true

CMD ["npm", "start"]
