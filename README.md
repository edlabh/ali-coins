# AliExpress Coin Collector & Task Runner

Automação completa para **check-in diário de moedas** e **execução automática das tarefas ("Ganhe mais moedas")** do AliExpress com emulação mobile (Google Pixel 7 / Android) via Playwright.

Compatível com **Windows 10/11**, **macOS (Apple Silicon & Intel)** e **Ubuntu / Linux**.

---

## Recursos Principais

- **Novo Modo Unificado (1 Único Comando):** Executa o check-in diário e em seguida roda todas as tarefas do painel em sequência na mesma rotina, apresentando um relatório consolidado com saldo inicial, ganho por tarefa e saldo final.
- **Check-in Diário Inteligente:** Compatível com o layout de cartões diários do AliExpress. Reconhece sequências ativas (inclusive de 200+ dias) e valores progressivos (+10, +15, +20 até +40 moedas diárias após o 7º dia consecutivo).
- **Validação Automática de Login:** Confirma e exibe o status da autenticação antes da coleta. Detecta se a conta configurada no `credentials.env` foi alterada e renova a sessão sem conflitos.
- **Automação Completa de Tarefas:** Executa em lote todas as tarefas da central de moedas:
  - **Explore itens surpresa / Browse surprise items (+5 moedas por rodada):** Toque automatizado e real em 3 produtos por rodada com permanência na página para consolidar o tracking de moedas.
  - **Explore itens patrocinados / Sponsored items (+5 moedas):** Navegação e permanência por 15s com rolagem ativa.
  - **Super descontos e Retrospectiva de economia (+5 moedas):** Visualização automática por 15s.
  - **Pesquisa ativa por palavras-chave (+5 moedas):** Pesquisa produtos reais e navega por 15s.
  - **Itens de US$ 0.10 / Prize Land & Minigames:** Identifica tarefas exclusivas do app móvel ou interativas e relata com transparência no extrato final.
  - **Cupons e créditos (+5 moedas):** Navegação e permanência ativa.
- **Extrato e Saldo Fidedignos:** Consulta o extrato oficial de transações da conta no AliExpress (`mycoin.html`), garantindo que o valor resgatado e o saldo total reflitam a realidade sem distorções de vitrine.

---

## Modos de Execução

Você pode rodar tudo junto de uma só vez ou os módulos individualmente:

| Modo | Descrição | Windows CMD | Windows PowerShell | Linux / macOS | npm |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Unificado (Recomendado)** | Faz check-in e roda todas as tarefas em sequência | `run_all.bat` | `.\run_all.ps1` | `./run_all.sh` | `npm run all` ou `npm start` |
| **Apenas Check-in** | Realiza apenas o check-in diário e consulta saldo | `run.bat` | `.\run.ps1` | `./run.sh` | `npm run collect` |
| **Apenas Tarefas** | Executa apenas o painel "Ganhe mais moedas" | `run_tasks.bat` | `.\run_tasks.ps1` | `./run_tasks.sh` | `npm run tasks` |

---

## 1. Requisitos Gerais

- [Node.js](https://nodejs.org/) (versão 18 ou superior)
- npm (versão 9 ou superior, já incluso no instalador do Node.js)

---

## 2. Preparação e Uso no Windows

### Instalação
1. Abra o terminal (**Prompt de Comando - CMD** ou **PowerShell**) na pasta do projeto.
2. Instale as dependências:
   ```cmd
   npm install
   ```
3. Instale o navegador Chromium do Playwright:
   ```cmd
   npx playwright install chromium
   ```

### Configuração das Credenciais
1. Crie o arquivo `credentials.env` a partir do modelo:
   - No CMD: `copy credentials.env.example credentials.env`
   - No PowerShell: `Copy-Item credentials.env.example credentials.env`
2. Abra o `credentials.env` no Bloco de Notas ou editor de código e insira suas credenciais:
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```

### Execução no Windows
- **Modo Unificado (Check-in + Tarefas em uma chamada):**
  ```cmd
  run_all.bat
  # ou via PowerShell:
  .\run_all.ps1
  # ou via npm:
  npm run all
  ```
- **Execuções individuais:**
  ```cmd
  run.bat          :: Apenas Check-in diário
  run_tasks.bat    :: Apenas Tarefas "Ganhe mais moedas"
  ```

---

## 3. Preparação e Uso no macOS (Apple Silicon & Intel)

### Instalação
1. Abra o aplicativo **Terminal**.
2. Verifique se o Node.js está instalado (`node -v`). Se necessário, instale via Homebrew (`brew install node`) ou pelo site oficial.
3. Instale as dependências do projeto:
   ```bash
   npm install
   ```
4. Baixe o navegador Chromium compatível com sua arquitetura (M1/M2/M3/M4 ou Intel):
   ```bash
   npx playwright install chromium
   ```

### Configuração das Credenciais
1. Crie o arquivo `credentials.env`:
   ```bash
   cp credentials.env.example credentials.env
   chmod 600 credentials.env
   ```
2. Edite o arquivo `credentials.env`:
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```

### Execução no macOS
- **Modo Unificado (Check-in + Tarefas em uma chamada):**
  ```bash
  ./run_all.sh
  # ou via npm:
  npm run all
  ```
- **Execuções individuais:**
  ```bash
  ./run.sh         # Apenas Check-in diário
  ./run_tasks.sh   # Apenas Tarefas "Ganhe mais moedas"
  ```

---

## 4. Preparação e Uso no Ubuntu / Linux

### Instalação
1. Instale as dependências:
   ```bash
   npm install
   ```
2. Instale o navegador Chromium do Playwright:
   ```bash
   npx playwright install chromium
   ```
3. Instale as dependências de sistema para o Chromium:
   - **Com permissão sudo / root:**
     ```bash
     sudo npx playwright install-deps
     # ou:
     sudo apt-get update && sudo apt-get install -y libnss3 libnspr4 libasound2t64
     ```
   - **Sem root (espaço de usuário local):**
     O projeto já contém o mecanismo de fallback em `./libs` com `LD_LIBRARY_PATH` automático.

### Configuração das Credenciais
1. Crie o arquivo `credentials.env`:
   ```bash
   cp credentials.env.example credentials.env
   chmod 600 credentials.env
   ```
2. Preencha `credentials.env`:
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```

### Execução no Ubuntu / Linux
- **Modo Unificado (Check-in + Tarefas em uma chamada):**
  ```bash
  ./run_all.sh
  # ou via npm:
  npm run all
  ```
- **Execuções individuais:**
  ```bash
  ./run.sh         # Apenas Check-in diário
  ./run_tasks.sh   # Apenas Tarefas "Ganhe mais moedas"
  ```

---

## 5. Agendamento Automático Diário (Piloto Automático)

Para manter a sequência ativa de check-in ininterrupta sem precisar rodar manualmente todo dia:

### No Linux e macOS (via Cron)
Abra a edição do seu agendador:
```bash
crontab -e
```
Adicione a linha para executar todo dia, por exemplo, às 08:00 da manhã via modo unificado:
```cron
0 8 * * * cd /caminho/completo/para/ali-coins && ./run_all.sh >> coins_daily.log 2>&1
```

### No Windows (via Agendador de Tarefas / Task Scheduler)
1. Pressione `Win + R`, digite `taskschd.msc` e tecle `Enter`.
2. Clique em **Criar Tarefa Básica**.
3. Defina o disparador como **Diariamente** no horário desejado.
4. Na ação, selecione **Iniciar um programa**:
   - Programa/script: `cmd.exe`
   - Argumentos: `/c run_all.bat`
   - Iniciar em: pasta completa do projeto `ali-coins`.

---

## 6. Persistência de Sessão e Troca de Conta

- **Login inicial:** Na primeira execução, o script realiza a autenticação com as credenciais do `credentials.env` e salva os tokens e cookies em `session.json`.
- **Reutilização transparente:** Nas execuções seguintes, a sessão em `session.json` é aproveitada diretamente, evitando telas de login e verificações redundantes.
- **Troca de Conta:** Se você alterar o `ALI_USER` no arquivo `credentials.env`, o script detecta automaticamente a mudança e descarta a sessão antiga, realizando um novo login transparente com a nova conta.
- **Segurança:** Nunca envie nem comite os arquivos `credentials.env` ou `session.json`. Eles já estão protegidos pelo `.gitignore`.
