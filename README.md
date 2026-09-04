# AliExpress Coin Collector

Automação para coleta de moedas diárias e execução das tarefas da AliExpress com emulação de User-Agent mobile (Pixel 7 / Android) via Playwright.

## Requisitos

- Node.js (>= 18)
- npm (>= 9)

## Preparação do Ambiente

1. **Instalar dependências do Node.js:**
   ```bash
   npm install
   ```

2. **Instalar navegador Chromium:**
   ```bash
   npx playwright install chromium
   ```

3. **Instalar bibliotecas do sistema para o Chromium:**
   - **Com sudo:**
     ```bash
     sudo npx playwright install-deps
     # ou:
     sudo apt-get install -y libnss3 libnspr4 libasound2t64
     ```
   - **Sem sudo (espaço de usuário):**
     ```bash
     mkdir -p libs && cd libs
     apt-get download libnss3 libnspr4 libasound2t64
     for f in *.deb; do dpkg -x "$f" extracted; done
     rm -f *.deb
     cd ..
     ```

## Configuração

1. Copie o arquivo de exemplo para configurar suas credenciais:
   ```bash
   cp credentials.env.example credentials.env
   chmod 600 credentials.env
   ```
2. Preencha seu usuário e senha no arquivo `credentials.env`:
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```

## Uso

- **Check-in diário de moedas:**
  ```bash
  ./run.sh
  ```

- **Execução de tarefas adicionais ("Ganhe mais moedas"):**
  ```bash
  ./run_tasks.sh
  ```
