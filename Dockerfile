# Multi-arch build com Docker Buildx:
# docker buildx build --platform linux/amd64,linux/arm64 -t ali-coins:latest .
#
# NOTA DE SEGURANÇA (AppArmor / Permissões / Custom User):
# - O container roda por padrão como usuário não-root 'appuser' (UID 10001 / GID 10001).
# - Se executar com --user <uid>:<gid> customizado do host, monte os arquivos de usuários:
#   docker run --rm -u $(id -u):$(id -g) \
#     -v /etc/passwd:/etc/passwd:ro \
#     -v /etc/group:/etc/group:ro \
#     -v $(pwd)/credentials.env:/app/credentials.env:ro \
#     -v $(pwd)/session.json:/app/session.json \
#     ali-coins
#   Isso previne o erro 'uv_os_get_passwd ENOENT' do Node.js (os.userInfo()).
# - Chromium roda com sandbox ativada (seccomp/AppArmor). Não utilize --no-sandbox
#   a menos que estritamente necessário em ambientes CI sem privilégios de namespace.
# Imagem base oficial pinada por digest multi-plataforma (amd64/arm64)
# Para atualizar o digest: docker buildx imagetools inspect node:22-slim
FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

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

# Cache compartilhado de binários do navegador Playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Criar usuário e grupo de sistema dedicados 'appuser' (UID 10001 / GID 10001)
RUN groupadd -g 10001 appuser && \
    useradd -u 10001 -g appuser -m -s /bin/bash appuser && \
    mkdir -p /ms-playwright /app/scratch && \
    chown -R appuser:appuser /ms-playwright /app

# Instalar dependências de produção
# Nota BuildKit: Para compilações mais velozes com cache local de navegadores, pode-se usar:
# RUN --mount=type=cache,target=/ms-playwright npx playwright install chromium
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npx playwright install chromium && \
    chown -R appuser:appuser /ms-playwright /app

# Copiar código-fonte da aplicação
COPY --chown=appuser:appuser . .

# Permissões de execução dos scripts
RUN chmod +x run_*.sh setup_*.sh push_to_github.sh 2>/dev/null || true

# Executar como usuário não-root dedicado para máxima segurança em containers
USER appuser

# Verificação de saúde da configuração e ambiente
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD test -f credentials.env && node all.js --dry-run --json || node -e "require('./config').loadConfig(false)" || exit 1

CMD ["npm", "start"]
