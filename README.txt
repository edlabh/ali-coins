================================================================================
                    ALIEXPRESS COIN COLLECTOR & TASK RUNNER
================================================================================

Automação completa para check-in diário de moedas e execução automática das
tarefas ("Ganhe mais moedas") do AliExpress com emulação mobile via Playwright.

Compatível com: Windows 10/11, macOS (Apple Silicon & Intel) e Linux (Ubuntu/Debian).

--------------------------------------------------------------------------------
1. NOVIDADES E RECURSOS
--------------------------------------------------------------------------------

- NOVO MODO UNIFICADO (1 CHAMADA ÚNICA):
  Executa o check-in diário e em sequência roda todas as tarefas do painel
  "Ganhe mais moedas", exibindo o status em tempo real e o relatório consolidado final.

- CHECK-IN DIÁRIO INTELIGENTE:
  Compatível com o layout de cartões diários do AliExpress. Reconhece sequências
  ativas de 200+ dias e valores de check-in (+40 moedas diárias após o 7º dia consecutivo).

- VALIDAÇÃO AUTOMÁTICA DE LOGIN:
  Confirma e exibe o status da autenticação antes da coleta. Detecta se a conta
  no credentials.env mudou e renova a sessão sem conflitos.

- EXECUÇÃO DE TAREFAS APRIMORADA:
  • Explore itens surpresa: Toque automatizado real em 3 itens por rodada com
    permanência para consolidação do tracking de moedas.
  • Itens patrocinados, retrospectiva e super descontos: visualização por 15s.
  • Pesquisa ativa: digitação e busca por palavra-chave por 15s.
  • Itens de US$ 0.10 (Prize Land) & Minigames: identificação transparente de
    tarefas exclusivas do app móvel no extrato.

- EXTRATO E SALDO FIDEDIGNOS:
  Consulta o histórico oficial da conta em mycoin.html, garantindo valores
  reais sem distorções de preços de vitrine.

--------------------------------------------------------------------------------
2. TABELA DE MODOS DE EXECUÇÃO
--------------------------------------------------------------------------------

[Modo Unificado (Recomendado - Check-in + Tarefas)]
- Windows CMD:        run_all.bat
- Windows PowerShell: .\run_all.ps1
- Linux / macOS:      ./run_all.sh
- Via npm:            npm run all  (ou npm start)

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
3. INSTALAÇÃO RÁPIDA
--------------------------------------------------------------------------------

[LINUX - UBUNTU 20.04 / 22.04 / 24.04 E DEBIAN]
- Modo Automático (Recomendado):
    chmod +x setup_linux.sh
    ./setup_linux.sh

- Modo Manual:
  1. Instale Node.js 20 LTS (o Node padrão do Ubuntu 22.04 é antigo/incompatível):
     curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
     sudo apt-get install -y nodejs git
  2. Dê permissão aos scripts e instale dependências:
     chmod +x *.sh
     npm install
     npx playwright install chromium
  3. Instale as bibliotecas do sistema para o Chromium:
     sudo npx playwright install-deps chromium

[WINDOWS]
  npm install
  npx playwright install chromium

[MACOS]
  brew install node
  npm install
  npx playwright install chromium

--------------------------------------------------------------------------------
4. CONFIGURAÇÃO DAS CREDENCIAIS
--------------------------------------------------------------------------------

Crie o arquivo credentials.env a partir de credentials.env.example:

  No Windows CMD:        copy credentials.env.example credentials.env
  No Windows PowerShell: Copy-Item credentials.env.example credentials.env
  No Linux / macOS:      cp credentials.env.example credentials.env

Abra o arquivo credentials.env e preencha suas informações:

  ALI_USER="seu_email_ou_telefone"
  ALI_PASSWORD="sua_senha"

--------------------------------------------------------------------------------
5. AGENDAMENTO DIÁRIO AUTOMÁTICO
--------------------------------------------------------------------------------

- NO LINUX / MACOS (CRON):
  Abra com 'crontab -e' e configure, por exemplo, para as 08:00 todos os dias
  (inclua PATH no topo do crontab para garantir que o node seja encontrado):
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
6. SEGURANÇA E PERSISTÊNCIA
--------------------------------------------------------------------------------

- A sessão autenticada é guardada em 'session.json' para evitar telas de login
  nas próximas execuções.
- Se alterar o usuário no credentials.env, a troca é automática.
- Os arquivos 'credentials.env' e 'session.json' nunca devem ser compartilhados.
================================================================================
