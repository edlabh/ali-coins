================================================================================
                    ALIEXPRESS COIN COLLECTOR & TASK RUNNER (v0.6)
================================================================================

Automação completa para check-in diário de moedas e execução automática das
tarefas ("Ganhe mais moedas") do AliExpress com emulação mobile via Playwright.

Compatível com: Windows 10/11, macOS (Apple Silicon & Intel) e Linux (Ubuntu/Debian).

--------------------------------------------------------------------------------
1. NOVIDADES E RECURSOS (VERSÃO 0.6)
--------------------------------------------------------------------------------

- DESEMPENHO OTIMIZADO (>40% MAIS RÁPIDO):
  • Inicialização de 1 único processo compartilhado do Chromium para check-in e tarefas.
  • Bloqueio inteligente de recursos pesados (imagens, vídeos, fontes e telemetrias).
  • Substituição de esperas fixas por detecção de eventos e estados DOM.

- SEGURANÇA REFORÇADA:
  • Permissões 0o600 automáticas em todos os arquivos de segredos (credentials, sessão, tokens).
  • Validação estrita de credenciais com Zod e leitura limpa via dotenv.
  • Isolamento seguro de sandbox do Chromium (--no-sandbox restrito a root/CI).
  • Suporte a 2FA interativo com mascaramento de senha e timeout de 120s.

- EXPORTAÇÃO E IMPORTAÇÃO CRIPTOGRAFADA (AES-256-GCM):
  • Derivação de chave via scrypt a partir de SESSION_SECRET (mínimo 32 caracteres).
  • Importação segura via STDIN ou flag --from-file (bloqueio de token em argv).
  • Validação de expiração da sessão (alerta se > 90 dias).

- MODO DE VALIDAÇÃO (DRY-RUN):
  • Valida o ambiente, arquivos e credenciais sem inicializar o navegador:
    npm start -- --dry-run

- PREVENÇÃO CONTRA CONCORRÊNCIA (LOCKFILE):
  • Lockfile exclusivo com checagem de PID para impedir execuções sobrepostas no Cron.
  • Flag --force disponível para desbloqueio manual se necessário.

--------------------------------------------------------------------------------
2. TABELA DE MODOS DE EXECUÇÃO
--------------------------------------------------------------------------------

[Modo Unificado (Recomendado - Check-in + Tarefas)]
- Windows CMD:        run_all.bat
- Windows PowerShell: .\run_all.ps1
- Linux / macOS:      ./run_all.sh
- Via npm:            npm run all  (ou npm start)

[Validação de Configuração (Dry-Run)]
- Windows CMD:        run_all.bat --dry-run
- Windows PowerShell: .\run_all.ps1 -d
- Linux / macOS:      ./run_all.sh --dry-run
- Via npm:            npm start -- --dry-run

[Apenas Check-in Diário]
- Windows CMD:        run.bat
- Windows PowerShell: .\run.ps1
- Linux / macOS:      ./run.sh
- Via npm:            npm run collect

[Apenas Tarefas "Ganhe mais moedas"]
- Windows CMD:        run_tasks.bat
- Windows PowerShell: .\run_tasks.ps1
- Linux / macOS:      ./run_tasks.sh
- Via npm:            npm run tasks

--------------------------------------------------------------------------------
3. INSTALAÇÃO (LINUX, WINDOWS, MACOS)
--------------------------------------------------------------------------------

[LINUX - UBUNTU 20.04 / 22.04 / 24.04 E DEBIAN]
Consulte o guia completo em INSTALL_LINUX.md.

- MODO AUTOMÁTICO (Recomendado - 1 comando):
    chmod +x setup_linux.sh
    ./setup_linux.sh

- MODO DOCKER (Opcional):
    docker build -t ali-coins .
    docker run --rm -v $(pwd)/credentials.env:/app/credentials.env ali-coins

[WINDOWS]
Consulte o guia completo em INSTALL_WINDOWS.md.

- MODO AUTOMÁTICO (Recomendado):
    Dê duplo clique no arquivo setup_windows.bat

[MACOS]
Consulte o guia completo em INSTALL_MACOS.md.

- MODO AUTOMÁTICO (Recomendado):
    chmod +x setup_macos.sh
    ./setup_macos.sh

--------------------------------------------------------------------------------
4. CONFIGURAÇÃO DAS CREDENCIAIS (credentials.env)
--------------------------------------------------------------------------------

Crie o arquivo credentials.env a partir de credentials.env.example:

  No Windows CMD:        copy credentials.env.example credentials.env
  No Windows PowerShell: Copy-Item credentials.env.example credentials.env
  No Linux / macOS:      cp credentials.env.example credentials.env && chmod 600 credentials.env

Abra o arquivo credentials.env e preencha suas informações:

  ALI_USER="seu_email_ou_telefone"
  ALI_PASSWORD="sua_senha"
  SESSION_SECRET="sua_chave_secreta_minimo_32_caracteres"
  ALLOW_MEDIA=false
  HEADLESS=true
  LOG_LEVEL=info

Dica para gerar SESSION_SECRET:
  openssl rand -base64 32

--------------------------------------------------------------------------------
5. AGENDAMENTO DIÁRIO AUTOMÁTICO
--------------------------------------------------------------------------------

- NO LINUX / MACOS (CRON):
  Abra com 'crontab -e' e configure, por exemplo, para as 08:00 todos os dias:
  SHELL=/bin/bash
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  0 8 * * * cd /caminho/para/ali-coins && ./run_all.sh >> coins_daily.log 2>&1

- NO WINDOWS (AGENDADOR DE TAREFAS / TASK SCHEDULER):
  1. Win + R -> taskschd.msc -> Criar Tarefa Básica.
  2. Disparador: Diariamente no horário de sua preferência.
  3. Ação: Iniciar um programa -> Programa: cmd.exe
     Argumentos: /c run_all.bat
     Iniciar em: pasta completa do projeto ali-coins.

--------------------------------------------------------------------------------
6. DELEGAÇÃO DE SESSÃO PARA SERVIDORES NA NUVEM (ORACLE CLOUD / AWS / VPS)
--------------------------------------------------------------------------------

Para servidores em nuvem com bloqueio de IP no login:
1. No PC pessoal, gere a sessão criptografada:
     export SESSION_SECRET="sua_chave_secreta_minimo_32_caracteres"
     node export_session.js
2. No servidor na nuvem, importe o token de forma segura:
     export SESSION_SECRET="sua_chave_secreta_minimo_32_caracteres"
     node import_session.js < session_token.txt

Os arquivos 'credentials.env', 'session.json' e 'session_token.txt'
estão no .gitignore e nunca devem ser compartilhados publicamente.
================================================================================
