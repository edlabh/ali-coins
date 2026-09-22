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

# Instalar dependências essenciais de runtime do Chromium (sem curl: não é usado em runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \
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

# Modo produção: logs em JSON direto no stdout (sem pino-pretty, que é devDependency)
ENV NODE_ENV=production

# Teto de heap V8 do processo Node: GC mais agressivo antes de pressionar hosts de 1 GB.
# 256 MB dá folga ao GC (menos pausas sob pressão) sem ameaçar hosts de 1 GB.
ENV NODE_OPTIONS=--max-old-space-size=256

WORKDIR /app

# Criar usuário e grupo de sistema dedicados 'appuser' (UID 10001 / GID 10001)
RUN groupadd -g 10001 appuser && \
    useradd -u 10001 -g appuser -m -s /bin/bash appuser && \
    mkdir -p /ms-playwright /app/scratch && \
    chown -R appuser:appuser /ms-playwright /app

# Instalar dependências de produção e APENAS o headless shell do Chromium.
# O app sempre roda headless (a imagem não tem Xvfb): com 'headless: true' o Playwright usa
# chrome-headless-shell, então o Chromium completo (~390 MB) seria peso morto.
# Nota BuildKit: Para compilações mais velozes com cache local de navegadores, pode-se usar:
# RUN --mount=type=cache,target=/ms-playwright npx playwright install --only-shell chromium
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npx playwright install --only-shell chromium && \
    npm cache clean --force && \
    rm -rf /root/.cache /tmp/* && \
    chown -R appuser:appuser /ms-playwright /app

# Copiar código-fonte da aplicação
COPY --chown=appuser:appuser . .

# Permissões de execução dos scripts
RUN chmod +x run_*.sh setup_*.sh push_to_github.sh 2>/dev/null || true

# Executar como usuário não-root dedicado para máxima segurança em containers
USER appuser

# Verificação de saúde real: valida credentials.env/schema sem fallback enganoso.
# Se o arquivo não estiver montado ou a configuração estiver inválida, o container fica unhealthy.
# Intervalo de 10 min: o job roda 1x/dia; checagens mais frequentes só gastariam CPU à toa.
# start-period de 90s dá margem ao primeiro dry-run sob CPU/RAM apertadas.
# Timeout/retries folgados: sob pressão de CPU/RAM durante o run, o dry-run pode passar de
# 15s e marcar o container como unhealthy sem falha real de configuração.
HEALTHCHECK --interval=10m --timeout=30s --start-period=90s --retries=5 \
    CMD node all.js --dry-run --json > /dev/null 2>&1

STOPSIGNAL SIGTERM

CMD ["node", "all.js"]
