# AliExpress Coin Collector

Automação para coleta de moedas diárias e execução das tarefas da AliExpress com emulação de User-Agent mobile (Pixel 7 / Android) via Playwright.

## Requisitos

- Node.js (>= 18)
- Playwright Chromium

## Configuração

1. Copie o arquivo de exemplo para configurar suas credenciais:
   ```bash
   cp credentials.env.example credentials.env
   ```
2. Preencha seu usuário (e-mail/telefone) e senha no arquivo `credentials.env`:
   ```env
   ALI_USER="seu_email"
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
