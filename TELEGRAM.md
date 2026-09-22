# Guia de Configuração: Notificações via Bot do Telegram

Este guia detalha como configurar notificações automáticas no seu Telegram para o **AliExpress Coin Collector & Task Runner**.

O recurso é **100% opcional** (desativado por padrão) e utiliza o cliente HTTP nativo do Node.js 22 (`fetch` nativo), sem instalar nenhuma biblioteca externa adicional.

---

## 📋 Recursos das Notificações

- **Status Automático em Tempo Real:** Notifica execuções com sucesso (+ moedas), coletas já realizadas hoje, falhas críticas e alertas de lockfile ativo.
- **Formatação Rica em HTML:** Apresenta saldo atualizado, sequência de dias (streak), moedas ganhas, lista de tarefas concluídas e tempo de execução.
- **Resiliente & Não-Bloqueante:** Se a API do Telegram oscilar ou estiver indisponível, a automação registra um aviso no log e preserva o código de saída original do job (nunca aborta o script).
- **Suporte Multi-Conta:** Agrupa e consolida o status de todas as contas em uma única mensagem elegante. Com `TELEGRAM_PER_ACCOUNT=true`, envia também o detalhe individual de cada conta.
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
7. Guarde também o link permanente de acesso direto ao seu bot gerado pelo @BotFather (exemplo: `t.me/meu_alicoins_bot`).

---

## 💬 Passo 2: Inicializar a Conversa com o Bot (Autorização Prévia Obrigatória)

> [!IMPORTANT]
> **Restrição de Arquitetura da Telegram Bot API:** Por políticas estritas de privacidade e combate a spam da plataforma Telegram, **bots são impossibilitados de iniciar conversas de forma ativa com usuários**. Uma aplicação não possui permissão técnica para enviar mensagens a um destinatário que nunca tenha interagido com o bot anteriormente. Caso uma tentativa de envio ocorra sem essa autorização prévia, a API do Telegram recusará a requisição com o erro `HTTP 403: Forbidden: bot can't initiate conversation with a user` ou `HTTP 400: Bad Request: chat not found`.

Antes de obter seu identificador ou preencher as configurações do sistema, é indispensável autorizar o bot através do primeiro contato:

1. No aplicativo do Telegram, acerte a conversa com seu bot recém-criado buscando pelo **username** definido no Passo 1 (exemplo: `@meu_alicoins_bot`) ou acessando diretamente o link permanente fornecido pelo `@BotFather` (`https://t.me/meu_alicoins_bot`).
2. Na janela de conversa, clique no botão **Começar** / **Iniciar** (ou envie manualmente a mensagem `/start`).
3. Com o envio desse comando inicial, o canal de comunicação estará formalmente aberto e o bot estará plenamente autorizado a despachar notificações e relatórios de execução para a sua conta.

---

## 🆔 Passo 3: Obter o seu `CHAT_ID`

Para que o bot envie mensagens para você, é necessário obter o identificador numérico exclusivo do seu chat (`TELEGRAM_CHAT_ID`).

### Método A: Mais rápido (via @userinfobot)

1. Pesquise por **`@userinfobot`** no Telegram e envie qualquer mensagem ou `/start`.
2. O bot responderá com seus dados cadastrais. Copie o valor numérico do campo **`Id`** (exemplo: `987654321` para contas individuais ou `-100...` para canais/grupos).

### Método B: Nativo via API do Telegram

Como você já inicializou o diálogo com o seu bot enviando `/start` no **Passo 2**, os dados da conversa já se encontram registrados nos servidores do Telegram:

1. No seu terminal, execute o comando `curl` substituindo `SEU_TOKEN` pelo token obtido no Passo 1:
   ```bash
   curl -s "https://api.telegram.org/botSEU_TOKEN/getUpdates"
   ```
2. Na resposta JSON retornada, localize a propriedade `"chat":{"id": 987654321, ...}`. Esse número é o seu `TELEGRAM_CHAT_ID`.

---

## ⚙️ Passo 4: Configurar o `credentials.env`

Abra o arquivo `credentials.env` e preencha as variáveis correspondentes:

```env
# Ativar o envio de notificações
TELEGRAM_ENABLED=true

# Token fornecido pelo @BotFather (formato: números:caracteres)
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456"

# Seu ID de usuário ou ID do grupo/canal
TELEGRAM_CHAT_ID="987654321"

# Chat IDs específicos para contas secundárias (opcional):
# Se omitidos, todas as contas herdam e notificam automaticamente no TELEGRAM_CHAT_ID principal:
# TELEGRAM_CHAT_ID_2="111222333"
# TELEGRAM_CHAT_ID_3="444555666"

# Enviar também a notificação INDIVIDUAL de cada conta, além do consolidado (padrão: false).
# Com false (padrão), contas que usam o mesmo chat do consolidado têm a mensagem individual
# suprimida (evita rajada); o consolidado é sempre enviado.
TELEGRAM_PER_ACCOUNT=false

# Enviar notificação sem som (notificação silenciosa) (padrão: false)
TELEGRAM_SILENT=false

# Timeout em milissegundos para requisição HTTP à API do Telegram (padrão: 5000)
TELEGRAM_TIMEOUT_MS=5000

# Identificação customizada do host nas mensagens (opcional, útil para Docker/VPS)
NOTIFY_HOST_LABEL="meu-servidor-vps"
```

> 💡 **Multi-Contas com Apenas 1 Bot / 1 Chat (Recomendado):**
> Se você deseja receber os relatórios de todas as contas no mesmo bot e na mesma conversa, declare apenas `TELEGRAM_CHAT_ID`. O sistema aplica fallback automático para todas as contas e envia o **resumo consolidado** no mesmo chat. Para evitar rajada de mensagens, a notificação **individual** de cada conta é suprimida quando o chat dela é igual ao `TELEGRAM_CHAT_ID` (comportamento padrão, `TELEGRAM_PER_ACCOUNT=false`). Ligue `TELEGRAM_PER_ACCOUNT=true` para receber também o detalhe de cada conta separadamente (ex.: com `TELEGRAM_CHAT_ID_2`/`TELEGRAM_CHAT_ID_3` próprios).

Garanta que as permissões do arquivo estejam restritas ao seu usuário:

```bash
chmod 0600 credentials.env
```

---

## 🧪 Passo 5: Como Testar a Integração

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
| **Falha Global (Crash)** |       `6`       |          Sim          | 💥 Erro fatal não tratado ou Promise rejeitada (uncaughtException / unhandled)     |

### Exemplo de Mensagem Recebida (Notificação Individual por Conta):

Enviada no modo conta única e, no modo multi-conta, somente com `TELEGRAM_PER_ACCOUNT=true`
(com o padrão `false`, o individual é suprimido quando o chat coincide com o consolidado).

```text
✅ ali-coins — 22/09/2026
👤 Conta: jo***@example.com
🖥️ Host: servidor-vps (v1.5.1)
🪙 Ganhas hoje: +111 moedas (check-in +40 / tarefas +71)
📅 Sequência: 219 dias
💰 Saldo: 3043 moedas
⏱️ Duração: 2m 27s
```

> Sem ação nova (check-in já coletado e sem tarefas pendentes), o título vira
> `ℹ️ ali-coins — ...` e os ganhos aparecem como `+0`.

### Exemplo de Mensagem Recebida (Consolidada Multi-Conta):

Sempre enviada no modo multi-conta (independente de `TELEGRAM_PER_ACCOUNT`):

```text
✅ AliExpress Moedas - Multi-Conta (Sucesso) — 22/09/2026
📊 Resumo: 2/2 contas processadas com sucesso

[1] jo***@example.com: 💰 3043 moedas | 🪙 +111 (+40/+71) | Streak: 219
[2] ma***@example.com: 💰 625 moedas | 🪙 +57 (+1/+56) | Streak: 7

⏱️ Duração Total: 5m 10s
📅 Data: 22/09/2026 15:28:28
🖥️ Host: servidor-vps (v1.5.1)
```

> Sem ação nova, o título vira `ℹ️ ... (Já Coletado)`. Se alguma conta falhar, o
> consolidado é enviado no formato de falha (🔴) e o detalhe por conta fica nas
> notificações individuais (com `TELEGRAM_PER_ACCOUNT=true`).

### Exemplo de Mensagem Recebida (Falha com Sessão Importada Expirada):

```text
🔴 ali-coins — 22/09/2026 15:23:38
⚠️ Erro: Erro ao efetuar o login: não foi possível obter streak e saldo para a conta "fe***@example.com".
👤 Conta: fe***@example.com
🖥️ Host: servidor-vps (v1.5.1)

⚠️ Aviso de Sessão Remota:
A sessão em uso foi importada de outro host (via import_session.js) e parece ter expirado ou sido invalidada pelo AliExpress.
💡 Ação necessária: É necessário gerar uma nova sessão executando node export_session.js no servidor de origem e importá-la neste host com node import_session.js.
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

### 3. `HTTP 400: Bad Request: chat not found` ou `HTTP 403: Forbidden: bot can't initiate conversation with a user`

- **Causa:** O `TELEGRAM_CHAT_ID` informado é inválido ou a etapa de inicialização prévia da conversa não foi realizada. Por arquitetura e diretrizes de privacidade da Telegram Bot API, bots não possuem permissão para iniciar conversas de forma ativa com nenhum usuário; o destinatário deve obrigatoriamente enviar a primeira mensagem.
- **Solução:** Acesse o diálogo com seu bot no Telegram (pesquise por seu `@username` ou acesse `https://t.me/<username_do_seu_bot>`), clique no botão **Iniciar** (`/start`) e verifique se o valor de `TELEGRAM_CHAT_ID` no `credentials.env` corresponde com exatidão ao identificador numérico obtido no Passo 3.

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

## 🚦 Códigos de Saída e Eventos Notificados

O bot do Telegram reporta os principais eventos associados aos códigos de saída do sistema:

| Código  | Evento no Telegram       | Descrição                                                                          |
| :-----: | :----------------------- | :--------------------------------------------------------------------------------- |
| **`0`** | `success`                | Execução concluída com sucesso e moedas adicionadas.                               |
| **`1`** | `failure`                | Falha crítica de execução ou autenticação.                                         |
| **`2`** | `already_collected`      | Execução idempotente: moedas já coletadas e sem tarefas pendentes.                 |
| **`3`** | `lock_active`            | Execução bloqueada: outra instância ativa no host.                                 |
| **`4`** | `streak_break`           | Alerta crítico: sequência diária interrompida.                                     |
| **`5`** | `2fa_required`           | Alerta de 2FA solicitado em ambiente não-interativo (cron/CI).                     |
| **`6`** | `failure` (Crash Global) | Notificação de emergência enviada por `uncaughtException` ou `unhandledRejection`. |

---

## 🛑 Como Desativar

Para desativar as notificações permanentemente, basta definir no seu `credentials.env`:

```env
TELEGRAM_ENABLED=false
```

Ou simplesmente remover ou comentar as linhas do Telegram. O script continuará funcionando normalmente sem disparar nenhuma requisição externa.
