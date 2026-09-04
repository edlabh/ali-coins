# AliExpress Coin Collector

Automação para coleta de moedas diárias e execução das tarefas da AliExpress com emulação de User-Agent mobile (Pixel 7 / Android) via Playwright.

Compatível com **Windows 10/11**, **macOS (Apple Silicon & Intel)** e **Ubuntu / Linux**.

---

## 1. Requisitos Gerais

- [Node.js](https://nodejs.org/) (>= 18)
- npm (>= 9, incluso com o Node.js)

---

## 2. Preparação e Uso no Windows

### Instalação
1. Abra o terminal (**CMD** ou **PowerShell**) na pasta do projeto.
2. Instale as dependências:
   ```cmd
   npm install
   ```
3. Instale o navegador Chromium do Playwright:
   ```cmd
   npx playwright install chromium
   ```

### Configuração
1. Crie seu arquivo `credentials.env` a partir do modelo:
   - No CMD: `copy credentials.env.example credentials.env`
   - No PowerShell: `Copy-Item credentials.env.example credentials.env`
2. Abra `credentials.env` e preencha suas credenciais:
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```

### Execução no Windows
- **Via npm (Recomendado):**
  ```cmd
  npm start          :: Check-in diário
  npm run tasks      :: Tarefas "Ganhe mais moedas"
  ```
- **Via CMD (Batch files):**
  ```cmd
  run.bat            :: Check-in diário
  run_tasks.bat      :: Tarefas "Ganhe mais moedas"
  ```
- **Via PowerShell:**
  ```powershell
  .\run.ps1          # Check-in diário
  .\run_tasks.ps1    # Tarefas "Ganhe mais moedas"
  ```

---

## 3. Preparação e Uso no macOS (Apple Silicon & Intel)

### Instalação
1. Abra o aplicativo **Terminal**.
2. Certifique-se de ter o Node.js instalado (via `brew install node` ou pelo instalador do site oficial).
3. Instale as dependências do projeto:
   ```bash
   npm install
   ```
4. Baixe o navegador Chromium do Playwright:
   ```bash
   npx playwright install chromium
   ```

### Configuração
1. Crie seu arquivo `credentials.env`:
   ```bash
   cp credentials.env.example credentials.env
   chmod 600 credentials.env
   ```
2. Edite `credentials.env` com suas credenciais:
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```

### Execução no macOS
- **Via npm (Recomendado):**
  ```bash
  npm start          # Check-in diário
  npm run tasks      # Tarefas "Ganhe mais moedas"
  ```
- **Via scripts Bash/Zsh:**
  ```bash
  ./run.sh           # Check-in diário
  ./run_tasks.sh     # Tarefas "Ganhe mais moedas"
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
   - **Com sudo / root:**
     ```bash
     sudo npx playwright install-deps
     # ou:
     sudo apt-get update && sudo apt-get install -y libnss3 libnspr4 libasound2t64
     ```
   - **Sem root (espaço de usuário):**
     ```bash
     mkdir -p libs && cd libs
     apt-get download libnss3 libnspr4 libasound2t64
     for f in *.deb; do dpkg -x "$f" extracted; done
     rm -f *.deb
     cd ..
     ```

### Configuração
1. Crie seu arquivo `credentials.env`:
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
- **Via npm:**
  ```bash
  npm start          # Check-in diário
  npm run tasks      # Tarefas "Ganhe mais moedas"
  ```
- **Via Bash:**
  ```bash
  ./run.sh           # Check-in diário
  ./run_tasks.sh     # Tarefas "Ganhe mais moedas"
  ```

---

## 5. Persistência de Sessão

- No primeiro login, os cookies e tokens são armazenados automaticamente em `session.json`.
- Nas execuções futuras, a sessão é reutilizada diretamente, evitando novas telas de login.
