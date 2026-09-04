================================================================================
       AliExpress Coin Collector - Guia de Uso (Windows, macOS & Ubuntu)
================================================================================

Automação para coleta de moedas diárias e execução das tarefas da AliExpress 
com emulação de User-Agent mobile (Pixel 7 / Android) via Playwright.

Compatível com Windows 10/11, macOS (Apple Silicon e Intel) e Ubuntu / Linux.

--------------------------------------------------------------------------------
1. REQUISITOS GERAIS
--------------------------------------------------------------------------------
- Node.js (versão 18 ou superior): https://nodejs.org/
- npm (versão 9 ou superior, já incluso com o Node.js)

================================================================================
2. INSTALAÇÃO E CONFIGURAÇÃO NO WINDOWS
================================================================================

Passo W1: Abrir o terminal (Prompt de Comando - CMD ou PowerShell) na pasta do projeto.

Passo W2: Instalar dependências do Node.js
> npm install

Passo W3: Instalar o navegador Chromium do Playwright
> npx playwright install chromium

(No Windows, o Playwright já baixa o Chromium com todas as DLLs necessárias
de forma autônoma, sem necessidade de pacotes externos do sistema).

Passo W4: Configurar as credenciais
No Prompt de Comando (CMD):
> copy credentials.env.example credentials.env

No PowerShell:
> Copy-Item credentials.env.example credentials.env

Edite o arquivo credentials.env no Bloco de Notas (Notepad) ou editor de texto:
ALI_USER="seu_email_ou_telefone"
ALI_PASSWORD="sua_senha"

Passo W5: Executar a aplicação no Windows
- Opção 1 (via npm - recomendado):
  > npm start          (para o check-in diário)
  > npm run tasks      (para as tarefas "Ganhe mais moedas")

- Opção 2 (via CMD - Batch files):
  > run.bat            (para o check-in diário)
  > run_tasks.bat      (para as tarefas "Ganhe mais moedas")

- Opção 3 (via PowerShell):
  > .\run.ps1          (para o check-in diário)
  > .\run_tasks.ps1    (para as tarefas "Ganhe mais moedas")

================================================================================
3. INSTALAÇÃO E CONFIGURAÇÃO NO MACOS (APPLE SILICON & INTEL)
================================================================================

Passo M1: Abrir o aplicativo Terminal na pasta do projeto.

Passo M2: Verificar/instalar Node.js
Se ainda não tiver o Node.js instalado, instale via Homebrew:
$ brew install node
Ou baixe o instalador oficial para macOS em https://nodejs.org/

Passo M3: Instalar dependências do projeto
$ npm install

Passo M4: Baixar o navegador Chromium do Playwright
$ npx playwright install chromium

(No macOS, o Playwright baixa a versão compatível com a arquitetura do seu Mac
- ARM64 para chips M1/M2/M3/M4 ou x64 para processadores Intel).

Passo M5: Configurar as credenciais
$ cp credentials.env.example credentials.env
$ chmod 600 credentials.env

Edite o arquivo credentials.env com seu e-mail e senha:
ALI_USER="seu_email_ou_telefone"
ALI_PASSWORD="sua_senha"

Passo M6: Executar a aplicação no macOS
- Opção 1 (via npm - recomendado):
  $ npm start          (para o check-in diário)
  $ npm run tasks      (para as tarefas "Ganhe mais moedas")

- Opção 2 (via scripts de Terminal):
  $ ./run.sh           (para o check-in diário)
  $ ./run_tasks.sh     (para as tarefas "Ganhe mais moedas")

================================================================================
4. INSTALAÇÃO E CONFIGURAÇÃO NO UBUNTU / LINUX
================================================================================

Passo U1: Abrir o terminal na pasta do projeto.

Passo U2: Instalar dependências do Node.js
$ npm install

Passo U3: Instalar o navegador Chromium do Playwright
$ npx playwright install chromium

Passo U4: Instalar dependências de sistema para o Chromium no Ubuntu
- Opção com acesso root / sudo:
  $ sudo npx playwright install-deps
  # ou:
  $ sudo apt-get update && sudo apt-get install -y libnss3 libnspr4 libasound2t64

- Opção sem root (espaço de usuário):
  $ mkdir -p libs && cd libs
  $ apt-get download libnss3 libnspr4 libasound2t64
  $ for f in *.deb; do dpkg -x "$f" extracted; done
  $ rm -f *.deb
  $ cd ..

Passo U5: Configurar as credenciais
$ cp credentials.env.example credentials.env
$ chmod 600 credentials.env

Edite o arquivo credentials.env com seu e-mail e senha:
ALI_USER="seu_email_ou_telefone"
ALI_PASSWORD="sua_senha"

Passo U6: Executar a aplicação no Ubuntu / Linux
- Opção 1 (via npm):
  $ npm start          (para o check-in diário)
  $ npm run tasks      (para as tarefas "Ganhe mais moedas")

- Opção 2 (via scripts Bash):
  $ ./run.sh           (para o check-in diário)
  $ ./run_tasks.sh     (para as tarefas "Ganhe mais moedas")

================================================================================
5. OBSERVAÇÕES IMPORTANTES E PERSISTÊNCIA DE SESSÃO
================================================================================
- No primeiro acesso, a aplicação realiza o login utilizando as credenciais
  configuradas no arquivo credentials.env.
- Após o login com sucesso, os tokens e cookies de autenticação são salvos
  automaticamente no arquivo session.json.
- Nas execuções seguintes, a sessão é reutilizada diretamente, evitando novas
  telas de login ou desafios de verificação.
- Não envie nem comite os arquivos credentials.env e session.json (eles já
  estão listados no .gitignore).
================================================================================
