================================================================================
                    AliExpress Coin Collector - Guia de Uso
================================================================================

Automação para coleta de moedas diárias e execução das tarefas da AliExpress 
com emulação de User-Agent mobile (Pixel 7 / Android) via Playwright.

--------------------------------------------------------------------------------
1. REQUISITOS PRÉVIOS
--------------------------------------------------------------------------------
- Node.js (versão 18 ou superior)
- npm (versão 9 ou superior)

--------------------------------------------------------------------------------
2. PREPARAÇÃO DO AMBIENTE
--------------------------------------------------------------------------------

Passo 2.1: Instalar dependências do projeto Node.js
$ npm install

Passo 2.2: Baixar os binários do Chromium do Playwright
$ npx playwright install chromium

Passo 2.3: Instalar dependências de sistema para o Chromium
Opção A (com acesso root / sudo):
$ sudo npx playwright install-deps
# ou:
$ sudo apt-get install -y libnss3 libnspr4 libasound2t64

Opção B (sem acesso root / espaço de usuário):
$ mkdir -p libs && cd libs
$ apt-get download libnss3 libnspr4 libasound2t64
$ for f in *.deb; do dpkg -x "$f" extracted; done
$ rm -f *.deb
$ cd ..

(Os scripts run.sh e run_tasks.sh já incluem automaticamente o caminho
das bibliotecas extraídas em LD_LIBRARY_PATH).

--------------------------------------------------------------------------------
3. CONFIGURAÇÃO DAS CREDENCIAIS
--------------------------------------------------------------------------------

Passo 3.1: Criar o arquivo de credenciais a partir do modelo
$ cp credentials.env.example credentials.env

Passo 3.2: Configurar permissões de segurança
$ chmod 600 credentials.env

Passo 3.3: Editar o arquivo credentials.env com seus dados de login da AliExpress
ALI_USER="seu_email_ou_telefone"
ALI_PASSWORD="sua_senha"

(Obs: após o primeiro login bem-sucedido, a sessão fica salva em session.json,
não sendo necessário digitar a senha novamente nas próximas execuções).

--------------------------------------------------------------------------------
4. EXECUÇÃO DA APLICAÇÃO
--------------------------------------------------------------------------------

- Para realizar apenas o check-in diário de moedas:
  $ ./run.sh

- Para executar todas as tarefas adicionais ("Ganhe mais moedas"):
  $ ./run_tasks.sh
================================================================================
