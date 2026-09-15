# Guia de Configuração: Notificações via Bot do Telegram

Este guia detalha como configurar notificações automáticas no seu Telegram para o **AliExpress Coin Collector & Task Runner**.

O recurso é **100% opcional** (desativado por padrão) e utiliza o cliente HTTP nativo do Node.js 22 (`fetch` nativo), sem instalar nenhuma biblioteca externa adicional.

---

## 📋 Recursos das Notificações

- **Status Automático em Tempo Real:** Notifica execuções com sucesso (+ moedas), coletas já realizadas hoje, falhas críticas e alertas de lockfile ativo.
- **Formatação Rica em HTML:** Apresenta saldo atualizado, sequência de dias (streak), moedas ganhas, lista de tarefas concluídas e tempo de execução.
- **Resiliente & Não-Bloqueante:** Se a API do Telegram oscilar ou estiver indisponível, a automação registra um aviso no log e preserva o código de saída original do job (nunca aborta o script).
- **Suporte Multi-Conta:** Agrupa e consolida o status de todas as contas em uma única mensagem elegante.
- **Modo Silencioso:** Opção de envio sem sinal sonoro (`TELEGRAM_SILENT=true`), ideal para execuções na madrugada via Cron.

---

## 🤖 Passo 1: Criar o Bot no Telegram com o @BotFather

1. No seu aplicativo do Telegram (celular ou computador), pesquise por **`@BotFather`** (verifique o selo azul de verificado) ou acesse [t.me/BotFather](https://t.me/BotFather).
2. Envie o comando `/start` e em seguida:
   ```text
   /newbot
   ```
3. O BotFather solicitará um **nome** de exibição para o bot (exemplo: `Ali Coins Notifier`):
   ```text
   Alright, a new bot. How are we going to call it? Please choose a name for your bot.
   > Ali Coins Notifier
   ```
4. Agora informe um **username** único, que obrigatoriamente deve terminar em `bot` (exemplo: `meu_alicoins_bot`):
   ```text
   Good. Now let's choose a username for your bot. It must end in `bot`. Like this, for example: TetrisBot or tetris_bot.
   > meu_alicoins_bot
   ```
5. O BotFather responderá com a mensagem de confirmação contendo o seu **HTTP API Token**:
   ```text
   Done! Congratulations on your new bot.
   Use this token to access the HTTP API:
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456

   Keep your token secure and store it safely, it can be used by anyone to control your bot.
   ```
6. **Copie e guarde esse token.** Ele será o seu `TELEGRAM_BOT_TOKEN`.

---

## 🆔 Passo 2: Obter o seu `CHAT_ID`

Para que o bot envie mensagens para você, você precisa descobrir o ID numérico do seu chat.

### Método A: Mais rápido (via @userinfobot)

1. Pesquise por **`@userinfobot`** no Telegram e envie qualquer mensagem ou `/start`.
2. O bot responderá com seus dados. Copie o valor numérico do campo **`Id`** (exemplo: `987654321` ou `-100...` para canais/grupos).

### Método B: Nativo via API do Telegram

1. Abra uma conversa com o seu próprio bot recém-criado (pesquise pelo username `meu_alicoins_bot`) e clique em **Iniciar** (`/start`).
2. No seu terminal, execute o comando `curl` substituindo `SEU_TOKEN` pelo token obtido no Passo 1:
   ```bash
   curl -s "https://api.telegram.org/botSEU_TOKEN/getUpdates"
   ```
3. Na resposta JSON retornada, localize a propriedade `"chat":{"id": 987654321, ...}`. Esse número é o seu `TELEGRAM_CHAT_ID`.

---

## ⚙️ Passo 3: Configurar o `credentials.env`

Abra o arquivo `credentials.env` e preencha as variáveis correspondentes:

```env
# Ativar o envio de notificações
TELEGRAM_ENABLED=true

# Token fornecido pelo @BotFather (formato: números:caracteres)
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456"

# Seu ID de usuário ou ID do grupo/canal
TELEGRAM_CHAT_ID="987654321"

# Enviar notificação sem som (notificação silenciosa) (padrão: false)
TELEGRAM_SILENT=false

# Timeout em milissegundos para requisição HTTP à API do Telegram (padrão: 5000)
TELEGRAM_TIMEOUT_MS=5000

# Identificação customizada do host nas mensagens (opcional, útil para Docker/VPS)
NOTIFY_HOST_LABEL="meu-servidor-vps"
```

Garanta que as permissões do arquivo estejam restritas ao seu usuário:

```bash
chmod 0600 credentials.env
```

---

## 🧪 Passo 4: Como Testar a Integração

O projeto oferece maneiras rápidas e seguras para testar as notificações sem abrir o navegador nem realizar login real:

### 1. Teste Direto de Conectividade com o Bot:

Execute o script utilitário de teste:

```bash
npm run notify:test
# ou diretamente via node:
node -e "require('./libs/notify').test()"
```

_Se as credenciais estiverem corretas, você receberá instantaneamente no Telegram uma mensagem de boas-vindas: `🔔 AliExpress Moedas - Teste de Notificação Telegram`._

### 2. Teste via Validação Dry-Run do CLI:

O modo `--dry-run` valida todo o ambiente. Quando combinado com a flag `--notify`, ele também dispara uma notificação de teste:

```bash
npm start -- --dry-run --notify
```

---

## 📊 Eventos Notificados e Formatação

| Evento                   | Código de Saída | Notificação Disparada | Exemplo de Conteúdo                                                                |
| :----------------------- | :-------------: | :-------------------: | :--------------------------------------------------------------------------------- |
| **Sucesso**              |       `0`       |          Sim          | Saldo final, moedas ganhas hoje, sequência de streak e lista de tarefas concluídas |
| **Já Coletado**          |       `2`       |          Sim          | Informa que as moedas já haviam sido coletadas e não há tarefas pendentes          |
| **Falha Crítica**        |       `1`       |          Sim          | Detalhes do erro ocorrido (login expirado, timeout de rede ou seletor inacessível) |
| **Lock Ativo**           |       `3`       |          Sim          | Alerta de sobreposição (outra instância já está em execução no host)               |
| **Streak Quebrado**      |       `4`       |          Sim          | 🚨 Alerta crítico de quebra de sequência (ontem → hoje + saldo atual)              |
| **2FA Requerido (Cron)** |       `5`       |          Sim          | 🔐 Interrupção rápida (<5s) em cron sem TTY com instruções de export/import        |

### Exemplo de Mensagem Recebida (Modo Unificado):

```text
✅ AliExpress Moedas - Sucesso

👤 Conta: ag***@gmail.com
💰 Saldo Atualizado: 1555 moedas
🔥 Sequência (Streak): 200 dias seguidos
📅 Check-in: Coletado com sucesso (+40 moedas)

📋 Tarefas Realizadas:
 • Explore sponsored items: Concluída (+5 moedas)
 • Pesquise por "fone bluetooth gamer": Concluída (+5 moedas)

⏱️ Duração: Check-in: 5s | Tarefas: 10s | Total: 15s
📅 Data: 14/09/2026 16:15:00 | 🖥️ Host: servidor-vps
```

### Exemplo de Mensagem Recebida (Modo Multi-Conta):

```text
✅ AliExpress Moedas - Multi-Conta (Sucesso)
📊 Resumo: 2/2 contas processadas com sucesso

[1] jo***@gmail.com: 💰 1555 moedas | Streak: 200d (+40) | Tarefas: 2
[2] ma***@gmail.com: 💰 320 moedas | Streak: 12d (+20) | Tarefas: 1

⏱️ Duração Total: 38s
📅 Data: 14/09/2026 16:15:00 | 🖥️ Host: servidor-vps
```

---

## 🚩 Parâmetros de Linha de Comando (CLI)

Você pode controlar o envio de notificações diretamente ao rodar qualquer comando:

- **`--notify`**: Força a ativação das notificações, mesmo se `TELEGRAM_ENABLED=false` no `credentials.env`:
  ```bash
  npm start -- --notify
  ```
- **`--no-notify`**: Desativa as notificações para aquela execução pontual, mesmo que estejam habilitadas no `credentials.env`:
  ```bash
  npm start -- --no-notify
  ```

### Agendamento no Cron e Rotação Periódica

Ao agendar tarefas automatizadas no servidor via `crontab`, você pode alternar livremente o comportamento de envio:

- **Execução Diária Normal (com Telegram):**
  ```bash
  15 4 * * * cd /home/ubuntu/ali-coins && /usr/bin/node all.js >> /home/ubuntu/ali-coins/cron.log 2>&1
  ```
- **Execução Diária Silenciada (sem alertas no Telegram):**
  ```bash
  15 4 * * * cd /home/ubuntu/ali-coins && /usr/bin/node all.js --no-notify >> /home/ubuntu/ali-coins/cron.log 2>&1
  ```
- **Rotação Mensal de Chaves Criptográficas at-rest (`--rotate`):**
  ```bash
  # Rotação no dia 1 de cada mês às 03:00 com backup em scratch/ e pruning automático de 7 dias
  0 3 1 * * cd /home/ubuntu/ali-coins && /usr/bin/node export_session.js --rotate --new-secret-from-env=SESSION_SECRET_NEW >> /home/ubuntu/ali-coins/rotation.log 2>&1
  ```

---

## 🔍 Resolução de Problemas (Troubleshooting)

### 1. `HTTP 401: Unauthorized`

- **Causa:** O token configurado em `TELEGRAM_BOT_TOKEN` está digitado incorretamente, contém espaços extras ou foi revogado no `@BotFather`.
- **Solução:** Copie novamente o token exato gerado pelo `@BotFather`.

### 2. `HTTP 403: Forbidden: bot was blocked by the user`

- **Causa:** Você bloqueou o bot nas opções de conversa do Telegram ou excluiu a conversa.
- **Solução:** Abra o bot no Telegram, desbloqueie-o e clique em `Reiniciar` ou envie `/start`.

### 3. `HTTP 400: Bad Request: chat not found`

- **Causa:** O `TELEGRAM_CHAT_ID` está incorreto ou você **nunca iniciou uma conversa** com o bot. Bots não podem enviar mensagens primeiro para um usuário sem que ele dê `/start`.
- **Solução:** Abra o bot no Telegram, clique em `Iniciar` (`/start`) e certifique-se de que o `CHAT_ID` é idêntico ao fornecido pelo `@userinfobot`.

### 4. Timeout / Erro de Rede

- **Causa:** Seu servidor ou VPS está com bloqueio de tráfego de saída para `api.telegram.org` (ou censura em países como Rússia/Irã/China).
- **Solução:** Verifique a conectividade executando `curl -I https://api.telegram.org`. Se necessário, utilize um proxy ou aumente o tempo limite com `TELEGRAM_TIMEOUT_MS=10000`.

### 5. `⚠️ Aviso de Sessão Remota` recebido no Telegram

- **Causa:** A automação está rodando em um servidor remoto/VPS com uma sessão que foi recebida de outro host (`node import_session.js`), e essa sessão expirou ou foi invalidada pelo AliExpress. Como o servidor está em um IP de datacenter, o login interativo com usuário/senha não pode ser concluído automaticamente devido a proteções anti-bot (captcha deslizante ou 2FA).
- **Solução:** No computador pessoal de origem (IP residencial com sessão ativa):
  ```bash
  node export_session.js
  ```
  E importe o novo token no servidor remoto:
  ```bash
  node import_session.js < session_token.txt
  ```

---

## 🛑 Como Desativar

Para desativar as notificações permanentemente, basta definir no seu `credentials.env`:

```env
TELEGRAM_ENABLED=false
```

Ou simplesmente remover ou comentar as linhas do Telegram. O script continuará funcionando normalmente sem disparar nenhuma requisição externa.
