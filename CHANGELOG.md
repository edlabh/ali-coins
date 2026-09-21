# Changelog

Todas as alterações notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

> Alterações destinadas às próximas versões (1.0.x / 1.1.0) devem ser registradas aqui e
> migradas para a seção `## [X.Y.Z] - AAAA-MM-DD` no momento do release. O processo
> completo está em [RELEASING.md](RELEASING.md).

## [1.4.4] - 2026-09-21

### Corrigido

- **Check-in fantasma no relatório (`libs/report.js`):** `computeCheckinCoinsGained` caía no fallback por streak quando `coinsGainedToday` era `'0'` (nenhuma coleta), anunciando “+40 moedas” sem check-in. Agora valor presente e não-positivo retorna 0; o fallback só vale para ausente/`N/D`. Afetava relatório unificado, multi-conta, Telegram, webhook e `--json`.
- **Check-in contado sem confirmação (`collect.js`):** `justCollected` era marcado após o clique sem verificar o efeito (timeout do `waitForSelector` engolido; `.e2e_normal_task_right_btn` sempre presente como falso positivo). Agora o check-in só é contabilizado quando o marcador de “hoje” aparece; caso contrário registra aviso e não incrementa streak/moedas.
- **Saldo truncado com separador de milhar (`libs/ui/balance.js`):** `"Minhas moedas\n2.917"` virava `"2"` e `"My coins\n12,345"` virava `"12"`, contaminando saldo, `initialBalance`/`finalBalance` e o ganho das tarefas.
- **Histórico de check-in cruzava datas (`libs/ui/balance.js`):** o gap `[\s\S]{0,120}?` associava o valor do dia seguinte à data anterior (check-in falso e quebra de streak mascarada). O histórico agora é processado por blocos de data.
- **Seção “hoje” usava a primeira data do extrato (`libs/ui/balance.js`):** quando a grafia de hoje não casava, a primeira data do documento era tratada como hoje. Agora só é aceita se corresponder à data atual (PT), tolerando zero à esquerda.
- **Rótulo de check-in na mesma linha da data virava “missão” (`libs/ui/balance.js`):** o teste ancorado (`^...$`) não reconhecia `"21/09/2026 PT App daily check-in"`, zerando o bônus do dia.
- **Valor do check-in pego de qualquer elemento `aecoin-` (`collect.js`):** o scan agora filtra elementos visíveis, evitando usar o primeiro `+N` do calendário como crédito do check-in.
- **Tarefa errada clicada (`libs/tasks/verifier.js`):** `findTaskElement` devolvia o elemento do índice antigo quando o título não era encontrado, executando a ação em outra tarefa. Agora retorna `null` (a tentativa é contabilizada e a tarefa é excluída após o limite).
- **Ação contada sem execução (`do_tasks.js`):** `totalActions` era incrementado antes de localizar elemento/botão, consumindo o teto global de 25 sem executar nada. Agora só conta com elemento e botão localizados (a tentativa continua sendo contabilizada antes, garantindo a terminação do loop).
- **Reabertura de tarefas concluídas (`do_tasks.js`):** `selectReopenableTasks` era chamado sem `tasks`, reabrindo títulos `isDone`. Agora recebe a última extração do painel.
- **Backoff segurava o lock da conta (`all.js`):** a espera de até 30s acontecia antes do `finally` que libera o lock, fazendo outra instância receber `LockActiveError`. O sleep agora ocorre após a liberação.
- **`openDrawerBtn` clicava no check-in (`libs/selectors.js`):** `#signButton` (botão de check-in) estava na lista de abertura do painel “Ganhe mais moedas”; removido (os candidatos específicos e o fallback semântico permanecem).
- **`closeModals` clicava fora de contexto (`libs/ui/navigation.js`):** `[class*="close"]` podia fechar gaveta/banner legítimo ou acionar “Confirm” genérico. Agora só clica em elementos visíveis dentro de diálogo/modal/overlay.
- **Slider reportava sucesso sempre (`libs/ui/navigation.js`):** `trySolveSlider` retornava `true` mesmo com o captcha na tela; agora retorna `true` apenas se o track desapareceu.
- **Cache desktop morto/desatualizado (`libs/ui/balance.js`, `collect.js`):** a página cacheada agora é validada (`isClosed`) e o cache é invalidado após login novo, evitando leituras `N/D` silenciosas e cookies antigos.
- **`+70 moedas/dia` inventado (`libs/report.js`):** quando o tier era desconhecido, o relatório exibia 70 fixo; agora exibe `N/D`.

### Segurança

- **`sessionData` (cookies) fora do stdout do `--json` (`libs/report.js`):** o storageState era impresso em claro (vai para `cron.log`/Docker logs) e permitia sequestrar a sessão. O valor continua no retorno interno, mas não é impresso.
- **Redação de `Cookie` multivalorado (`logger.js`):** `cookie: a=1; xman_us_t=SEGREDO; ...` só mascarava o primeiro par; agora a linha inteira é redigida (inclui `set-cookie`).
- **Migração legada não destrói `.enc` válido (`libs/session.js`):** `migrateLegacySession` sobrescrevia um `session.json.enc` existente sem backup; agora preserva como `.bak-<ts>` e aborta se não conseguir. O erro de JSON não interpola mais o conteúdo do arquivo.
- **`session_meta.json` corrompido não apaga a sessão (`libs/session.js`):** meta ilegível era tratado como conta divergente e disparava `clearSession`; agora a sessão é preservada.
- **Permissões reforçadas na sessão (`libs/session.js`, `export_session.js`):** `.enc`/plaintext/meta existentes recebem `0600` no load, e a exportação chmoda o `.enc` realmente lido (antes chmodava o plaintext, que normalmente não existe).
- **Backups de sessão ignorados no git/imagem (`.gitignore`, `.dockerignore`):** adicionados `*.bak-*` e `*.tmp-*` (os padrões `*.bak` não casavam com `session.json.enc.bak-<ts>`).
- **`isPrivateIp` mais rígido (`libs/url_guard.js`):** 6to4 agora extrai o IPv4 dos hextets 2-3 (antes usava os 32 bits finais e deixava passar `2002:a9fe:a9fe::` → `169.254.169.254`), multicast `ff00::/8` e faixas reservadas IPv4 (benchmark/TEST-NET) bloqueados, e IPv6 é canonicalizado (`0:0:0:0:0:0:0:1` → loopback).
- **Erro multi-conta sanitizado (`libs/notify.js`):** a mensagem individual de falha passava só por `escapeHtml`; agora passa pelo redator de query/headers, evitando `?token=`/`code=` no Telegram.
- **Lockfile anti-TOCTOU (`lockfile.js`):** a remoção de lock stale/órfão/inválido agora move para um caminho privado e só apaga se a geração (`lockId`/`pid+createdAt`) ainda bater — antes um `unlink` incondicional podia destruir o lock recém-publicado por outro processo e permitir duas execuções na mesma conta. `LOCK_STALE_TIMEOUT_MS` inválido (`0`/negativo/`NaN`) passa a cair no default seguro.
- **Multi-conta: falha parcial não é mais “sucesso” (`all.js`):** com pelo menos uma conta OK e outra falhando (erro ou 2FA), o processo saía 0 e enviava heartbeat `success`, mascarando a falha no dead man's switch. Agora encerra com exit 1 e heartbeat de falha.

### Testes

- **Seletores de login/2FA específicos (`libs/selectors.js`, `libs/ui/login.js`, `collect.js`, `do_tasks.js`):** `input[type="text"]`/`input[type="email"]`/`input.cosmos-input` genéricos disparavam re-login falso com sessão válida (e alerta falso de sessão expirada); o 2FA exigia apenas um input com “code” no nome/classe, causando falso 2FA e aborto em cron/CI. Agora os seletores são específicos e a detecção exige input **visível**; a checagem de login é condicionada à URL de login/passport.
- **`skipWebhook` implementado (`libs/report.js`):** a opção passada pelos testes era ignorada e relatórios sintéticos podiam ser POSTados para o webhook de produção; agora é respeitada.
- **`cleanupIsolatedTestDir` com allowlist (`tests/test_helper.js`):** a remoção recursiva agora exige caminho sob o `os.tmpdir()`, evitando apagar arquivos do projeto por engano.
- **`docker-run.example.sh` valida `credentials.env`:** montagem de arquivo inexistente criava diretório `root` no host; agora falha com mensagem clara e cria `scratch/` antes.
- **Dependabot não auto-mergeia workflows (`.github/workflows/dependabot-automerge.yml`):** PRs que alteram `.github/workflows/**` exigem revisão humana (supply chain).
- **Heartbeat não fatia JSON (`libs/heartbeat.js`):** payload acima do teto agora vira resumo em texto puro, em vez de JSON truncado inválido.
- **Testes de regressão:** +8 testes (contabilização `'0'`, confirmação de check-in, datas relativas, saldo com separador, seletores específicos, cookie multivalorado, 6to4/multicast/canonicalização, `skipWebhook`), total **372**.

## [1.4.3] - 2026-09-21

### Segurança

- **SSRF: guard não é mais contornável por redirecionamento (`libs/url_guard.js`, `libs/report.js`, `libs/heartbeat.js`):** o `fetch` nativo seguia redirects (`redirect: 'follow'`), então um destino público podia responder `302` para rede privada/metadata (`169.254.169.254`) e o guard nunca via o alvo. Novo `safeFetch` segue os redirects manualmente, **revalidando cada hop** com o mesmo guard, com limite de saltos e sem propagar credenciais entre origens. Webhook e heartbeat passam a usá-lo.
- **SSRF: DNS falha fechada (`libs/url_guard.js`):** quando o hostname não resolve, o destino agora é **bloqueado** (antes a falha de resolução era tolerada, permitindo que um hostname só resolvesse no momento do fetch). Adicionado timeout de DNS.
- **SSRF: IPv6 especiais bloqueados (`libs/url_guard.js`):** link-local via faixa `fe80::/10` (antes só o prefixo literal `fe80`), site-local `fec0::/10`, e prefixos que **embutem IPv4** — NAT64 `64:ff9b::/96`, 6to4 `2002::/16` e Teredo `2001::/32` (em rede com DNS64, `[64:ff9b::a9fe:a9fe]` alcança o metadata da nuvem).
- **PII em webhook: telefone/ID mascarado (`libs/report.js`):** a sanitização só mascarava identificadores contendo `@`; login por telefone era enviado em claro ao webhook externo. Agora qualquer string em contexto de usuário é mascarada, e o objeto cru **não é mais devolvido** além do limite de profundidade (antes vazava segredos aninhados).
- **`accounts.json`: `passwordEnv` não resolve mais propriedades herdadas (`config.js`):** `passwordEnv: "constructor"`/`"toString"` resolvia função herdada como senha; agora exige propriedade própria e tipo string.
- **`accounts.json`: `passwordFile` confinado ao diretório (`config.js`):** impede path traversal (`../../etc/passwd`) e `chmod 0600` em arquivo arbitrário do sistema.
- **Poda de artefatos confinada ao `scratch/` (`libs/session.js`):** a política de retenção só apaga dentro do scratch esperado; antes, apontar `PW_OUTPUT_DIR` para um diretório de dados do usuário apagava arquivos silenciosamente.
- **Segredos redigidos em Telegram/heartbeat (`libs/notify.js`, `libs/heartbeat.js`, `logger.js`):** mensagens de erro enviadas a canais externos passam pelo redator de query/headers (`?token=`, `code=`, `Bearer`, `authorization:`/`cookie:`) e o corpo do heartbeat ganhou teto de 32 KB. Também corrigida injeção de HTML no alerta de streak quebrado (valores agora passam por `toSafeStreak`/`escapeHtml`).
- **Escrita atômica não segue symlink (`security.js`):** o fallback de escrita direta (bind mount) agora rejeita/remove symlink no destino e abre com `O_NOFOLLOW`, e `safeChmod600` não altera a permissão do alvo de um link — evita escrever sessão em arquivo arbitrário via link plantado.
- **Migração legada não sobrescreve `.enc` válido e verifica round-trip (`libs/session.js`):** se já existe `session.json.enc`, ele é preservado como backup antes da migração; o `.enc` recém-gravado é **decifrado e reconferido** antes de apagar o único `session.json` em texto claro.
- **Mutações de sessão serializadas por caminho (`libs/session.js`):** `saveSession`/`clearSession`/`updateSessionStreak` passam a usar um mutex por caminho, eliminando a corrida em que um `clear` apagava o arquivo recém-gravado por um `save` no mesmo processo.
- **Comparação de segredos em tempo constante na rotação (`libs/session.js`):** `oldSecret === newSecret` substituído por `crypto.timingSafeEqual`.
- **Redação de segredos no logger ampliada (`logger.js`):** chaves `pass`/`pwd`/`accessKey`/`private_key`/`bearer`/`senha`; redator cobre fragmento (`#token=`), `Bearer` e `authorization:`/`cookie:`; preserva referências compartilhadas (não trata reuso como circular) e mantém `stack`/`type` do `Error`.
- **PII mascarada no log de rotação (`export_session.js`):** o resumo agregado passa a usar `maskUser`.
- **Injeção no Discord neutralizada (`libs/report.js`):** menções (`@everyone`/`@here`/`@&`) e markdown em valores raspados são escapados; teto do webhook medido em **bytes** (`Buffer.byteLength`), não code units.
- **Poda do storage: `localStorage` não-array tratado como vazio (`libs/storage_filter.js`):** impede que uma entrada malformada escape da allowlist.
- **Relatórios no fuso do negócio (`time_utils.js`):** `formatDate`/`formatTime` usam `America/Los_Angeles` (configurável via `REPORT_TIMEZONE`), evitando divergência de virada de dia em VPS UTC.
- **`--from-file` com teto e timeout (`import_session.js`):** limita a 2 MB, exige arquivo regular e aplica timeout (antes um FIFO travava o processo).
- **`crash.js` garante o exit code 6:** o timer de emergência não é mais `unref()`, evitando encerramento com código 0 em crash.
- **Credenciais de proxy sem esquema removidas (`browser.js`):** `user:pass@host` também é sanitizado antes de ir ao Chromium.

### Testes

- Novos testes de regressão: prefixos IPv6 especiais, DNS fail-closed, `safeFetch` bloqueando redirect para rede privada, mascaramento de telefone no webhook, profundidade do sanitizador, `passwordEnv`/`passwordFile`, escopo da poda, redigitação/escaping no Telegram, symlink na escrita/chmod, mutex de sessão, backup/round-trip da migração, tempo constante na rotação, chaves sensíveis do logger, storage não-array, menções do Discord, fuso dos relatórios, `crash.js` e proxy sem esquema — **364/364**.

## [1.4.2] - 2026-09-21

### Corrigido

- **Webhook não vaza mais a sessão nem PII (`libs/report.js`):** o envio a webhooks externos passa por sanitização (defesa em profundidade) que **remove `sessionData`/`cookies`/`storageState`** e mascara e-mails em campos de usuário. Antes, o relatório de check-in em `--json` enviava os cookies de autenticação do AliExpress ao webhook. O `stdout` local continua com o valor cru (compatibilidade).
- **E-mail cru no webhook unificado (`libs/report.js`):** o relatório unificado passa a mascarar o usuário antes do envio externo.
- **Escrita direta em bind mount não corrompe mais a sessão (`security.js`):** o fallback (quando o `rename` falha com `EBUSY`) cria backup `.bak-<ts>`, faz escrita completa (loop sobre `bytesWritten`) e restaura o backup em caso de falha, evitando sessão vazia/parcial se o processo for morto (OOM) durante a gravação.
- **Scrypt considera o limite do cgroup (`security.js`):** `getEffectiveDefaultScryptN` usa `min(os.totalmem(), limit)` com leitura de `/sys/fs/cgroup/memory.max` (v2) e `memory.limit_in_bytes` (v1), evitando pico de ~128 MB em container com `--memory` reduzido.
- **Renovação do lockfile não sobrescreve mais lock alheio (`lockfile.js`):** o refresh periódico passou a usar o mesmo padrão atômico-condicional do `release` (rename para caminho privado, confere `lockId`/`pid` e só então reescreve e devolve). Elimina o TOCTOU em que um takeover por stale entre a leitura e a escrita "ressuscitava" o lock antigo e sobrescrevia o do novo dono, permitindo execução concorrente.
- **SSRF no heartbeat considera DNS (`libs/heartbeat.js`):** `validateExternalUrl` passa a resolver o hostname, bloqueando destinos que resolvem para IP loopback/privado (ex.: metadata interna via DNS). Opt-in `ALLOW_PRIVATE_WEBHOOKS=true` continua disponível para ambientes que precisam de destino privado.
- **Webhook revalida o destino antes do envio (`libs/report.js`):** segunda validação imediatamente antes do `fetch`, reduzindo a janela de DNS rebinding entre validação e envio.
- **Histórico reconhece todos os rótulos de check-in (`libs/ui/balance.js`):** o cálculo do streak no histórico desktop passa a usar o mesmo padrão de rótulos do extrato (inclui "Bônus diário"/"Daily bonus"), que antes não eram contados.
- **Detecção de formato de data não confunde mais rótulo com locale (`libs/ui/balance.js`):** a heurística de mês/dia deixou de usar "App daily check-in" (rótulo em inglês mesmo na UI pt-BR) como sinal de locale, comparando cabeçalhos reais de interface ("Minhas moedas" vs "My coins") e a data de hoje.
- **Valores com separador de milhar são contabilizados (`libs/ui/balance.js`):** o parser do extrato aceita `+1.000`/`+2,500`, remontando o valor corretamente em vez de truncá-lo.
- **Retry do Telegram cancela o corpo e respeita `retry_after` (`libs/notify.js`):** em 429 o corpo é cancelado (libera o socket) e a espera segue o `retry_after` informado pelo servidor (teto de 30s), evitando rajadas que agravam o rate-limit.
- **Truncamento de mensagem seguro (`libs/notify.js`):** o corte passa a ser por code points (não parte emojis/pares substitutos) e remove tags HTML abertas sem fechamento, evitando `HTTP 400` do Telegram por entidades inválidas.
- **Sessão em texto puro exige opt-out explícito (`libs/session.js`):** com `ENCRYPT_LOCAL_SESSION` ativo (padrão) e `SESSION_SECRET` ausente/curto, a gravação passa a ser **recusada** com `logger.error` (antes gravava em claro com apenas um `warn`). Para permitir texto puro, use `ENCRYPT_LOCAL_SESSION=false`.
- **Ambiente do Chromium sem segredos e sem credenciais de proxy (`browser.js`):** a lista de chaves sensíveis cobre `PASS`/`PWD`/`PRIVATE_KEY` e o userinfo embutido em `HTTP(S)_PROXY`/`ALL_PROXY` é removido antes de repassar ao navegador.
- **URL de ação do heartbeat preserva a query string (`libs/heartbeat.js`):** `buildActionUrl` insere o segmento `start`/`fail` antes da query (ex.: `.../uuid?k=v` → `.../uuid/start?k=v`), em vez de anexar após ela.
- **Migração de sessão legada unificada (`libs/session.js`, `import_session.js`):** as duas implementações de `migrateLegacySession` foram unificadas em uma única função canônica em `libs/session.js`. A CLI delega em modo estrito (lança `SessionMigrationError`→`ImportSessionError`, valida o schema e retorna `cookiesCount`/`encrypted`), enquanto a biblioteca mantém o contrato tolerante (`{ migrated: false }` sem lançar). Elimina a divergência de comportamento entre os dois fluxos.

### Segurança

- **SSRF: IPv6 literal privado/loopback agora é bloqueado (`libs/url_guard.js`):** `validateExternalUrl` deixava passar **qualquer** IPv6 literal (ex.: `http://[::1]/`, `[fd00::1]`, `[fe80::1]`, `[::ffff:7f00:1]` = `127.0.0.1` e `[::ffff:a9fe:a9fe]` = `169.254.169.254`/metadata da nuvem), anulando o controle introduzido na 1.4.0 para `NOTIFY_WEBHOOK_URL`/`HEARTBEAT_URL`. Duas causas: (1) `URL.hostname` devolve IPv6 entre colchetes, então `net.isIP` retornava 0 e o host caía no ramo de DNS, cuja falha era tolerada (`ok: true`); (2) o classificador só reconhecia IPv4 mapeado na forma decimal, mas `new URL()` normaliza para hexadecimal. Corrigido removendo colchetes/ponto final do hostname e decodificando IPv4 mapeado/compatível em hexadecimal.
- **Menor privilégio no workflow de release (`.github/workflows/release.yml`):** permissão global passa a `contents: read`, elevando para `contents: write` apenas no job que publica a release.
- **Hardening do container de cron (`docker-run.example.sh`):** `--cap-drop=ALL` e `--security-opt=no-new-privileges`, além de rotação simples do `cron.log` (5 MB, configurável via `ALI_COINS_LOG_MAX_BYTES`) para evitar crescimento indefinido em VPS pequena.

### Testes

- Novos testes para sanitização de webhook (sem `sessionData`/PII), fallback com backup, cgroup, `buildActionUrl`/`normalizeBaseUrl`, separador de milhar no extrato, reconhecimento de "Bônus diário" no histórico, truncamento seguro de mensagem, saneamento do ambiente do Chromium, paridade dos contratos de migração (CLI estrita vs. biblioteca tolerante) e bloqueio de IPv6 literal privado no SSRF — **342/342**.

## [1.4.1] - 2026-09-21

### Corrigido

- **Contabilização do extrato fiel ao site (`libs/ui/balance.js`, `collect.js`, `libs/report.js`, `all.js`):** o parser do extrato desktop passou a somar **todos** os créditos do dia que não são check-in como ganho de tarefas (antes `Widget coins` era ignorado — tarefas reportadas 66 em vez de 71), e o **check-in real do dia** passa a ser contabilizado mesmo quando já constava como coletado (ex.: feito pelo usuário no app), usando a seção de HOJE do extrato como fonte de verdade. O evento da notificação também considera esse crédito como nova ação.

### Testes

- Novo caso com o extrato real da VM (Widget coins) e `computeCheckinCoinsGained` com `checkinCoinsFromLedger` — **328/328**.

## [1.4.0] - 2026-09-21

### Segurança

- **Bloqueio de SSRF em destinos externos (`libs/url_guard.js`):** webhooks (`NOTIFY_WEBHOOK_URL`) e heartbeat (`HEARTBEAT_URL`) passam a validar o destino e **bloquear loopback/redes privadas/link-local/metadata** (`127.0.0.1`, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.169.254`, `::1`, `fc00::/7` etc.). Hostnames são resolvidos para impedir que um domínio público aponte para IP privado (DNS rebinding). Opt-in para testes locais: `ALLOW_PRIVATE_WEBHOOKS=true`.
- **Teto de payload do webhook:** corpos acima de 32 KB são substituídos por um resumo truncado (`{ truncated: true, originalSize, summary }`), protegendo memória e destinos em execuções multi-conta grandes.
- **Senhas fora do `accounts.json` (`config.js`):** cada conta pode usar `passwordEnv` (nome de variável de ambiente) ou `passwordFile` (arquivo `0600`, relativo ao `accounts.json`) em vez de `password` em texto puro, reduzindo a exposição de credenciais em backups/sincronizações. O campo `password` inline continua suportado (retrocompatível).

### Testes

- Novos testes para `libs/url_guard.js` (IP privado/público, opt-in, protocolos e hostnames), bloqueio SSRF de webhook/heartbeat, truncamento de payload e `passwordEnv`/`passwordFile` — **326/326**.

## [1.3.4] - 2026-09-21

### Corrigido

- **Valor real do check-in ("Bônus diário") e ganho real das tarefas ("Missões de moedas") (`libs/ui/balance.js`, `collect.js`, `do_tasks.js`, `libs/report.js`):** o extrato desktop passa a ser a **fonte de verdade** dos valores efetivamente creditados:
  - `getBalanceDesktop` agora extrai `todayBonusCoins` (linha **Bônus diário** / _Daily bonus_) e `todayMissionsCoins`/`todayMissionsCount` (linhas **Missões de moedas** / _Coin missions_) da seção de hoje, bilíngue.
  - O valor do check-in passa a priorizar o **real do extrato** sobre a estimativa pelo tier do streak (o site às vezes promete 40 e credita 1); divergências são logadas em `warn`.
  - O ganho das tarefas passa a ser a **soma das "Missões de moedas"** do extrato, e não a diferença de saldo — que absorvia o crédito do check-in e inflava o valor das tarefas (ex.: `+96` em vez de `+56`).
  - `computeTasksCoinsGained` respeita `coinsFromLedger` e não desconta o check-in quando o valor já vem isolado do extrato.
- **Check-in reconhecido pelo rótulo novo:** o check-in do dia é considerado realizado também quando o extrato traz **"Bônus diário"** (antes só `App daily check-in`).

### Testes

- `extractTodayLedger` (pt/en), `getBalanceDesktop` expondo os campos do extrato e `coinsFromLedger` no relatório — **317/317**.

## [1.3.3] - 2026-09-19

### Adicionado

- **Versão do app no log e nas notificações:** a versão (`package.json`) passa a ser exibida:
  - **Log por conta**: linha `[Versão] ali-coins vX.Y.Z` no início de cada execução de check-in/tarefas (`collect.js`, `do_tasks.js`) e sufixo `(versão vX.Y.Z)` na linha de início de cada conta no fluxo multi-conta (`all.js`).
  - **Notificação Telegram**: todas as mensagens passam a exibir o host como `host (vX.Y.Z)`.

## [1.3.2] - 2026-09-19

### Adicionado

- **Segunda passada configurável (`TASK_RETRY_UNFINISHED`, padrão `false`):** habilita passadas extras focadas **apenas** nas tarefas que não coletaram nenhuma rodada/falharam por falta de progresso. Ao final da passada normal, as tarefas esgotadas e ainda incompletas são reabertas (tentativas/rodadas zeradas) e reprocessadas — sem repetir tarefas concluídas nem as desativadas por exigirem o app. Controlado por `TASK_RETRY_PASSES` (número de passadas, padrão `1`) e `TASK_RETRY_DELAY_MS` (espera entre passadas, padrão `5000`). Respeita o teto global `TASK_MAX_ACTIONS`, não repete claims e é limitado (sem loop infinito).
  - Nova função pura `selectReopenableTasks()` (`libs/tasks/state.js`) define quais tarefas podem ser reabertas (exclui `APP_ONLY_DISABLED_STATUS` e `isDone`).
  - Documentado em `credentials.env.example`.

## [1.3.1] - 2026-09-19

### Adicionado

- **`DESKTOP_REUSE_CONTEXT` (padrão `false`):** permite compartilhar um único `BrowserContext` desktop (`mycoin`) por conta nas leituras de saldo/streak, em vez de criar/fechar um contexto por leitura. **Desligado por padrão**: medição na VM mostrou que manter o contexto desktop vivo durante o fluxo mobile **eleva** o pico de RAM/PIDs (contextos concorrentes), o que é pior em host de 1 GB. Fica disponível para hosts com folga de memória. O contexto é sempre fechado ao fim de cada conta (não vaza cookies entre contas).

## [1.3.0] - 2026-09-19

### Adicionado

- **`TELEGRAM_PER_ACCOUNT` (padrão `false`):** torna **opcional** o envio da notificação individual de cada conta além do relatório consolidado. Por padrão permanece **desligado**, preservando o comportamento anti-rajada (quando todas as contas usam o mesmo chat, apenas o consolidado é enviado). Ligue com `TELEGRAM_PER_ACCOUNT=true` no `credentials.env` para receber o detalhe de cada conta separadamente.
  - O **relatório consolidado continua sendo sempre enviado**, independentemente da flag.
  - A flag é validada pelo schema Zod (boolean), exibida no resumo do `--dry-run` e documentada em `credentials.env.example`.
  - `shouldSkipAccountNotification()` agora recebe `{ perAccountEnabled }`: com a flag ligada nunca suprime a mensagem individual; desligada, mantém a supressão por chat duplicado.

## [1.2.2] - 2026-09-19

### Corrigido

- **Check-in contabilizado no extrato das tarefas (`collect.js`, `libs/report.js`):** o valor recebido no check-in não é mais somado ao ganho das tarefas. `collect.js` deixa de inflar o saldo base e só o sincroniza quando o ledger do desktop está **defasado** (não refletiu o crédito), garantindo que o saldo usado como `initialBalance` das tarefas já contenha o check-in. Assim `computeTasksCoinsGained` reporta estritamente o ganho das tarefas, enquanto o check-in é contabilizado à parte por `computeCheckinCoinsGained`.
- **Check-in contabilizado apenas quando ainda não ocorreu no dia (`libs/report.js`):** `computeCheckinCoinsGained` retorna 0 quando `alreadyCollected === true`; em execuções no mesmo dia o extrato mostra `check-in +0` e apenas as tarefas.
- **Incremento determinístico do streak (`collect.js`, `libs/report.js`):** nova função pura `resolveStreakDays()` centraliza a lógica (antes inline e divergente). Garante `+1` ao realizar o check-in no dia, usa `previousStreakDays` **ou** a leitura do desktop como base (a maior), preserva o streak consolidado em re-execução e evita regressão pelo ciclo semanal espúrio. Funciona igual em conta única e multi-conta (mesma função usada no fluxo).

### Testes

- Novos testes para isolamento contábil do check-in (`computeTasksCoinsGained`/`buildUnifiedReportPayload`/`buildMultiAccountReportPayload`), cenários de saldo creditado/defasado e `resolveStreakDays` (incremento, base via desktop, re-execução, ciclo semanal, primeira execução) — **306/306**.

## [1.2.1] - 2026-09-19

### Corrigido

- **Notificações do Telegram perdidas por timeout (`libs/notify.js`):** `sendTelegram` agora faz **retry com backoff exponencial + jitter** (até 3 tentativas) para falhas transitórias de rede/timeout/HTTP 5xx/429; erros 4xx permanecem sem retry. O timeout padrão por tentativa subiu de 5000ms para **15000ms** (`config.js`, `credentials.env.example`), evitando descartes em VPS com DNS/TLS lentos.
- **Rajada de mensagens no mesmo chat (`all.js`):** quando o `telegramChatId` de uma conta é igual ao `TELEGRAM_CHAT_ID` global, a mensagem individual daquela conta é suprimida (o consolidado já cobre o mesmo destino); os envios restantes são espaçados por ~3s (`NOTIFY_MIN_SPACING_MS`) para não competir pelo limite de taxa do Telegram.
- **`Browse surprise items` sem confirmação do site (`libs/tasks/surprise.js`):** novo fallback best-effort (`SURPRISE_DETAIL_FALLBACK`, padrão on) que, quando os cliques no feed não navegam, abre **um card não-tocado em detalhe** (nova aba ou retorno via `goBack`) para tentar contabilizar a rodada. Conservador: só roda com `context` real, feed confirmada, sem navegação prévia e respeita o `AbortSignal`.

### Testes

- Novos testes para retry do Telegram (`postToTelegramWithRetry`), supressão de chat duplicado (`shouldSkipAccountNotification`) e fallback de detalhe do surprise — **301/301**.
- Validação na VM: run real com retry acionado (tentativa 1 `fetch failed` → sucesso na 2), **uma única** notificação Telegram consolidada, 2/2 contas, 0 riscos, pico 512MiB.

## [1.2.0] - 2026-09-18

### Corrigido

- **Exit code não-determinístico em `export_session.js --all` (`export_session.js:410`):** faltava `return` após `flushAndExit(1)` quando não havia sessões ativas, e o fluxo ainda chamava `flushAndExit(0)` — o código de saída dependia da corrida entre os dois `process.exit`.
- **Erro de configuração em `--dry-run` virava crash (`collect.js`, `do_tasks.js`):** a IIFE principal não tinha `.catch`, então uma `ConfigValidationError` lançada por `handleDryRun()` escalava ao crash handler e encerrava com código 6; agora é tratada como falha crítica de execução (exit 1).
- **Lock removido de processo vivo sob `EPERM` (`lockfile.js`):** `isProcessAlive` tratava `EPERM` ("sem permissão para sinalizar" = processo existe) como processo morto, podendo remover o lock de outra instância legítima; agora `EPERM` é considerado vivo.
- **`customMessage` sem escape no Telegram (`libs/notify.js`):** mensagens customizadas enviadas em `parse_mode: HTML` não passavam por `escapeHtml`.
- **Lock órfão com configuração inválida (`all.js`):** `loadConfig(true)` passou a rodar **antes** de `acquireLock`, então uma config inválida encerra com exit 1 sem deixar lock preso.
- **Refresh do lock silencioso (`lockfile.js`):** falhas ao renovar o `createdAt` agora emitem `logger.warn` (sem travar o run), evitando que um lock ativo seja considerado obsoleto por outra instância sem qualquer sinal.
- **Webhooks podiam ser perdidos no encerramento (`libs/report.js`, `libs/exit.js`):** notificações fire-and-forget são rastreadas e aguardadas (com teto de 5 s) antes do `process.exit`.
- **Abas/popups órfãos durante as tarefas (`do_tasks.js`):** abas abertas por tarefas são fechadas a cada ação e o listener `context.on('page')` é removido ao final.
- **Contexto desktop órfão em falha de setup (`browser.js`):** `newMobileContext`/`newDesktopContext` fecham o `BrowserContext` se `addInitScript`/rotas/tracing falharem após `newContext`.
- **STDIN sem limite/timeout na importação (`import_session.js`):** leitura de token via pipe agora tem teto de 2 MB e timeout de inatividade de 60 s, evitando OOM/travamento com entrada infinita.
- **Ordem sessão/meta invertida na importação (`import_session.js`):** metadados passam a ser gravados **antes** da sessão, igual a `saveSession`, evitando `.enc` órfão sem meta.
- **Contagem de "Tarefas executadas" inflada (`libs/report.js`):** passa a usar `totalActions` (ações reais) em vez de `results.length` (inclui tarefas puladas/desativadas), com fallback compatível.
- **Falha da etapa de tarefas invisível no relatório (`all.js`, `libs/report.js`):** `tasksError` agora é propagado no `meta` do relatório (sem alterar exit codes).
- **Flush de streams sem observabilidade (`libs/exit.js`):** `flushStream` sinaliza timeout e o encerramento emite aviso quando a saída pode ter sido truncada.
- **Token com buffers malformados (`security.js`):** `parseSessionToken` valida tamanhos canônicos de iv/tag/salt e rejeita cedo (mesma mensagem pública de autenticação).
- **`formatDuration`/backoff com valores não finitos (`time_utils.js`):** `Number.isFinite` evita saídas `NaN`/`Infinity`.
- **Falha genérica de lock virava "lock ativo" (`all.js`):** o fluxo multi-conta agora distingue lock ativo (exit 3) de erro genérico de `acquireLock` (exit 1), contando cada caso em vez de uma flag única.
- **Par meta/sessão podia aprovar sessão de outra conta (`libs/session.js`, `import_session.js`):** a sessão passa a ser gravada **antes** do meta; em crash entre as escritas o par fica sessão-nova + meta-antigo, que `validateSession` rejeita por divergência de conta (re-login seguro).
- **Falha de tarefas invisível em multi-conta (`all.js`, `libs/report.js`):** `tasksError` agora é propagado por conta (item e `meta`) no relatório multi-conta, mantendo campos opcionais.
- **Exit 5 (2FA) ausente nos entrypoints standalone (`collect.js`, `do_tasks.js`):** `node collect.js`/`node do_tasks.js` passam a sair com código 5 em 2FA não-interativo, alinhados ao `all.js`.
- **Flush de webhooks podia não aguardar (`libs/webhooks.js`):** removido `unref()` do timer de flush; o encerramento espera o teto curto.
- **Crash handler truncava o flush (`libs/crash.js`):** timer de emergência ampliado de 5 s para 15 s, evitando cortar o log fatal/relatório no meio do flush (webhooks + streams).

### Segurança

- **`accounts.json` com credenciais em texto puro sem restrição (`config.js`):** o arquivo passa a receber `chmod 0600` em runtime, com aviso quando estava legível por outros usuários.
- **`credentials.env` sem reforço de permissão em runtime (`config.js`):** `chmod 0600` aplicado no boot, cobrindo arquivos criados manualmente fora do instalador.
- **Dry-run expondo dados sensíveis (`config.js`):** o Chat ID do Telegram agora é mascarado e os comprimentos de `SESSION_SECRET`/senha/token foram removidos da saída (apenas `[CONFIGURADO]`).
- **Segredos poderiam ir ao Chromium (`browser.js`):** `options.env` passou a ser mesclado sobre o env sanitizado, em vez de substituí-lo.
- **Mensagem de erro de descriptografia vazava detalhe interno (`security.js`):** detalhe vai apenas para `logger.debug`; o prefixo público permanece estável.
- **Sessão em texto puro sem aviso (`libs/session.js`):** quando `ENCRYPT_LOCAL_SESSION` está ativo sem `SESSION_SECRET` válido, emite aviso explícito.
- **localStorage de telemetria persistido/injetado (`libs/storage_filter.js`, `libs/session.js`):** allowlist compartilhada com o `export_session` filtra chaves de telemetria (centenas de KB) no `saveSession`, preservando cookies de autenticação; opt-out `SESSION_STRICT_STORAGE=false`.

### Desempenho

- **`pino-pretty` evitado fora de TTY (`logger.js`):** o modo colorido (que sobe worker thread do pino) só é usado em terminal interativo; em cron/systemd sem TTY os logs saem como JSON estruturado, economizando CPU/RAM.
- **`closeModals` consolidado (`libs/ui/navigation.js`):** seletores CSS resolvidos em um único `evaluate` (antes até 8 `page.$` + sleeps de 300 ms por chamada); seletores `:has-text` do Playwright permanecem suportados, com fallback para mocks/ambientes sem `evaluate`.
- **Payloads JSON compactos (`libs/heartbeat.js`, `libs/session.js`):** heartbeat e metadados/sessão deixam de usar `JSON.stringify(..., null, 2)`, reduzindo bytes trafegados/gravados.
- **scrypt auto-dimensionado por RAM (`security.js`):** em host com ≤1.5 GB de RAM total, novas criptografias usam `N=2^15` (~32 MB de pico em vez de ~128 MB); `SCRYPT_N` explícito continua tendo precedência e tokens existentes não são afetados.
- **`findTaskElement` com um único `$$eval` (`libs/tasks/verifier.js`):** resolve o índice da tarefa em um round-trip CDP, eliminando N+1 `$eval`; fallback para o caminho antigo é mantido.
- **`config` propagado para `runCheckin`/`runTasks` (`all.js`):** evita re-parse de Zod/Commander por conta em multi-conta.
- **`fsync` opcional em metadados (`security.js`, `libs/session.js`, `import_session.js`):** `safeWriteFile(..., { durable: false })` dispensa fsync em metadados descartáveis, preservando a escrita atômica.
- **Reuso opcional de contexto desktop (`libs/ui/balance.js`):** `options.context`/`options.reuseContext` + `closeCachedDesktopContext()`; **desligado por padrão** para não manter contexto vivo e elevar o pico de RAM durante o fluxo mobile.
- **Webhooks em módulo leve (`libs/webhooks.js`):** `libs/exit.js` deixa de carregar o Playwright (via `report.js`) em toda saída, reduzindo latência/memória de `import_session`, `export_session`, `--help` e `--dry-run`.

### Onda 5 (endurecimento final)

- **Revalidação de card em `findTaskElement` (`libs/tasks/verifier.js`):** o caminho otimizado por `$$eval` revalida o título do elemento resolvido antes de retornar, evitando clicar em outro card se a lista re-renderizar entre as duas consultas.
- **Cancelamento do Prize Land (`libs/tasks/prizeland.js`, `libs/tasks/dispatcher.js`):** o `AbortSignal` agora é propagado e o clique é abortado se a tarefa estourar o tempo.
- **Cache de contexto desktop fechado no teardown (`collect.js`, `do_tasks.js`, `libs/ui/balance.js`):** `closeCachedDesktopContext()` é chamado ao final, evitando reter RAM/cookies entre contas quando o reuso opt-in está ativo.
- **`export_session` com caminho explícito (`export_session.js`):** `options.sessionPath`/`sessionMetaPath` têm precedência sobre os caminhos derivados de `--account`.
- **`accounts.json`/storage filtrados de forma null-safe (`export_session.js`):** reutiliza `filterStorageState`, eliminando `TypeError` com entradas `null` e a divergência com `libs/storage_filter.js`.
- **`libs/crash.js`:** motivo de crash não-`Error` passa a ser serializado (e não `[object Object]`).
- **`security.js`:** `fsync` best-effort do diretório após o rename (durabilidade do rename) e pré-checagem de memória do scrypt (`128*N*r*p + 128*r*p`) impedindo que `maxmem` clampeado gere "memory limit exceeded".
- **`config.js`:** locks de contas secundárias seguem o `baseDir` (antes ignoravam baseDir customizado); primária mantém o lock global.
- **`.dockerignore`:** exclui `libs/extracted/` (libs locais não devem sobrepor as libs do apt no container).
- **Rótulos de formato de token (`export_session.js`, `import_session.js`, `libs/session.js`):** textos passam a `AES-256-GCM`/`v3` em vez de "v2".
- **`--account` não gera mais falso aviso de argumento posicional (`import_session.js`).**
- **`dependabot-automerge.yml`:** trigger migrado para `pull_request_target` (sem checkout/execução do código do PR), evitando 403 do `GITHUB_TOKEN` rebaixado em PRs do Dependabot.

### Adicionado

- **`SESSION_STRICT_STORAGE`** (padrão `true`), **`SCRYPT_N`** auto, **`options.durable`** em `safeWriteFile`, **`options.context`/`options.reuseContext`/`closeCachedDesktopContext()`** em `getBalanceDesktop`, **`flushWebhooks()`**, **`tasksError`** no `meta` do relatório unificado e exportação de `isProcessAlive`/`getEffectiveDefaultScryptN`.

### Testes

- Cobertura nova/estendida em `tests/navigation.test.js`, `tests/lockfile.test.js`, `tests/logger.test.js`, `tests/config.test.js`, `tests/multi_account.test.js`, `tests/notify.test.js`, `tests/heartbeat.test.js`, `tests/exit.test.js`, `tests/security.test.js`, `tests/session.test.js`, `tests/tasks.test.js`, `tests/balance.test.js`, `tests/report.test.js`, `tests/time_utils.test.js`, `tests/import_stdin.test.js`, `tests/webhooks.test.js` e `tests/dockerignore.test.js` — **296/296**; `actionlint` sem erros nos workflows.
- Validação na VM (container reconstruído): `exit=2` (2º run do dia sem ação), ~5m30s, pico **~520MiB**, 2/2 contas, 0 riscos; host de 1024 MB autodetectado para scrypt `N=32768`; filtro de storage manteve apenas chaves permitidas; `libs/webhooks.js` não carrega Playwright.

## [1.1.0] - 2026-09-18

### Adicionado

- **`SKIP_APP_ONLY_TASKS` (padrão `true`):** nova flag que desliga a verificação das tarefas que exigem o app nativo do AliExpress e nunca concluem via web — Prize Land/Fazenda Mágica (regar), minigames (ex: "Complete 1 Merge Boss game order"), quizzes ("Daily quiz challenge") e avaliações de pedidos ("review"/"avalia"). Quando ligada, essas tarefas são ignoradas no loop, **sem consumir tentativas/ações**, e aparecem no relatório final como `Desativada (tarefas que exigem o app desligadas)`. Um aviso é emitido no início da etapa e outro por tarefa ignorada. Defina `SKIP_APP_ONLY_TASKS=false` no `credentials.env` para restaurar o comportamento anterior (tentar todas as tarefas). Documentado em `credentials.env.example` e exibido no resumo do `--dry-run`.

### Notas

- Mudança de comportamento padrão: por ser uma alteração compatível com o fluxo do bot (apenas deixa de insistir em tarefas impossíveis via web), a versão é minor (`1.1.0`).

## [1.0.2] - 2026-09-18

### Corrigido

- **PII no webhook de tarefas (`libs/report.js`):** `renderTasksReport()` em modo `--json` agora mascara `userEmail` antes do despacho a webhooks externos, mantendo a política já aplicada ao check-in e o valor cru apenas no `stdout` local.
- **Falso positivo de "Sign in" com sessão válida (`collect.js`, `do_tasks.js`):** os indícios textuais de tela de login (`Email or phone number`, `Sign in`, `Entrar`) só são considerados quando a URL confirma página de login/passport, evitando re-login desnecessário (e risco de 2FA) em rodapés/menus.
- **Comparação de conta case-insensitive (`security.js`, `libs/session.js`):** e-mails/IDs com caixa diferente não invalidam mais sessões legítimas.
- **Fallback de sessão importada em multi-conta (`libs/notify.js`):** o fallback que lê o `session_meta.json` primário não é mais aplicado a relatórios multi-conta; os flags por conta continuam sendo a fonte de verdade.
- **Clique de card em "Browse surprise items" (`libs/tasks/surprise.js`):** um card só é marcado como tocado quando o clique foi de fato disparado (nativo ou fallback via `evaluate`); falhas totais de clique não "queimam" o card e permitem nova tentativa.
- **HEALTHCHECK do container (`Dockerfile`):** timeout ampliado para 30s e `--retries=5` para não marcar `unhealthy` sob pressão de CPU/RAM durante a execução.
- **Lock roubado em execuções longas (`lockfile.js`):** `acquireLock()` agora renova o `createdAt` do lock periodicamente enquanto o dono está vivo (a cada `staleTimeout/3`, teto de 5 min), impedindo que um run acima de 30 minutos seja tratado como órfão e permita duas execuções concorrentes. O refresh é atômico e só renova o lock se a geração (`lockId`) ainda for a nossa.
- **Streak de histórico antigo (`libs/ui/balance.js`):** `getStreakFromDesktopHistory()` descarta sequências cujo registro mais recente não seja de hoje/ontem no fuso do histórico (PT), evitando reportar um streak antigo como atual e mascarar uma quebra real quando a leitura mobile retorna `N/D`.
- **Release workflow (`release.yml`):** a release passa a ser ancorada preferencialmente na tag sem `v` (padrão do projeto) quando ambas existem, e a criação ganhou fallback idempotente para a corrida entre as execuções das tags `X.Y.Z` e `vX.Y.Z`.

### Desempenho

- **Tracing do Playwright desligado por padrão em modo de baixo consumo (`libs/ui/diagnostics.js`):** as opções `PW_TRACE`/`PW_SCREENSHOT`/`PW_VIDEO` passam a ser resolvidas em um único ponto, com default `off` de tracing quando `CHROMIUM_LOW_MEMORY` está habilitado (padrão). A env explícita continua tendo precedência. Elimina gravação contínua de screenshots e snapshots de DOM em hosts de 1 GB.
- **Sessão em memória não é descriptografada duas vezes (`libs/session.js`):** `validateAndRefresh()` agora usa `skipSession` quando recebe `existingSessionData`, evitando um segundo scrypt (N=2^17) por conta no fluxo unificado check-in → tarefas, sem alterar a migração/rotação do caminho padrão.
- **Screenshots de falha apenas do viewport (`libs/ui/diagnostics.js`):** por padrão os screenshots de diagnóstico não usam mais `fullPage`, evitando imagens gigantes e picos de RAM em páginas infinitas no caminho de erro; o documento completo continua disponível com `PW_SCREENSHOT_FULL_PAGE=true`.
- **Service workers bloqueados e flags de segundo plano no Chromium (`browser.js`):** contextos passam a iniciar com `serviceWorkers: 'block'` (opt-out `PW_BLOCK_SERVICE_WORKERS=false`) e o Chromium recebe flags de economia de CPU/rede (`--disable-background-networking`, `--disable-component-update`, `--disable-sync`, `--disable-breakpad`, `--mute-audio`, `--no-first-run`, `--disable-features=Translate,...`). BackForwardCache é preservado para não alterar o `goBack()` das surpresas.
- **Assinaturas de cards em lote (`libs/tasks/surprise.js`):** as assinaturas de todos os cards são obtidas em um único `$$eval` por consulta (com fallback individual), eliminando 1 roundtrip CDP por card candidato a cada toque.
- **Remoção dos `networkidle` (`collect.js`):** esperas pós-login deixam de usar `networkidle` (que podia aguardar até 30s por telemetria) e passam a usar `domcontentloaded` + espera curta, com a estabilização garantida pelos waits explícitos de seletor.
- **scrypt assíncrono (`security.js`, `libs/session.js`):** novas variantes `encryptSessionAsync`/`decryptSessionAsync` são usadas no fluxo de sessões, liberando o event loop durante a derivação (~200ms no N padrão) enquanto o Chromium está ativo; API síncrona e formato dos tokens permanecem inalterados.
- **Fast-path do logger (`logger.js`):** registros planos (sem objetos aninhados nem chaves sensíveis) deixam de passar pela cópia recursiva de scrub/sanitização, mantendo a sanitização de strings e de `err.message`.
- **Documentação de sincronização segura para a VM (`CLOUD_SESSIONS.md`):** novo método com `rsync` e excludes ancorados, alertando que padrões sem `/` (ex: `session*`) excluem `libs/session.js` e deixam a VM rodando código antigo.

## [1.0.1] - 2026-09-18

### Corrigido

- **Contagem de tarefas executadas no relatório multi-conta (`libs/report.js`):** Correção da referência ao campo inexistente `res.tasksResult.totalActions` em `renderMultiAccountReport()`, que causava exibição constante de `"Tarefas executadas: 0"` mesmo com tarefas concluídas. O log agora consome `res.tasksResult.results.length`, exibindo a quantidade correta de tarefas processadas por conta.
- **Proteção de PII no webhook de check-in em modo JSON (`libs/report.js`):** Em `renderCheckinReport()` com `options.json = true`, o e-mail da conta agora passa por `maskUser` antes do despacho a `sendWebhookNotification()`, prevenindo vazamento de credenciais a webhooks externos (Discord/Telegram) e mantendo o valor cru apenas no `stdout` local para consumidores de pipeline.

- **Isolamento de abas, recuperação pós-timeout e auto-cura em "Browse surprise items" (`libs/tasks/surprise.js`, `do_tasks.js`, `libs/tasks/verifier.js`):**
  - O fallback de captura de novas abas via `context.pages()` em `surprise.js` agora armazena um snapshot (`pagesBeforeClick`) antes de cada toque e filtra estritamente por páginas abertas _após_ o clique. Isso elimina o fechamento acidental da página principal de execução (`mainPage`) e da página de feed de surpresas (`activePage`), que causava o erro catastrófico `page.$$eval: Target page, context or browser has been closed`.
  - Nova rotina de auto-cura `ensureMainPage` (`libs/tasks/verifier.js`, exportada em `do_tasks.js` e `libs/ui/tasks.js`): detecta se a página principal foi fechada ou navegou para fora da central de moedas, recriando a página transparentemente a partir do contexto do browser e reabrindo o msite sem interromper o loop de tarefas.
  - O listener `context.on('page')` em `do_tasks.js` é registrado após a inicialização da página principal e ignora recriações (`isRecreatingPage`), prevenindo que a página principal seja confundida com nova aba e indevidamente fechada após timeouts.
  - **Eliminação de encerramento silencioso do loop de tarefas (Risco 1):** `extractTasksFromDrawer` agora anexa `error` como propriedade não-enumerável ao array de retorno em falhas de extração (preservando igualdade estrita em testes legados) e suporta `throwOnError`. Introduzida a função `getDrawerTasksWithRetry` que realiza até 2 tentativas acionando `ensureMainPage` e reabrindo o painel quando ocorrem falhas transientes, garantindo que o loop e o extrato final de tarefas não sejam abortados prematuramente como vazios.
- **Orçamento de tempo, diferenciação de feed vs anúncio e prevenção de repetição de cards em "Browse surprise items" (`libs/tasks/surprise.js`, `libs/tasks/dispatcher.js`, `do_tasks.js`):**
  - Otimização das esperas em `surprise.js` (espera de seletor para 12s, pré-toque de 200ms, teto de 3s para `domcontentloaded`, permanência de 1s e pós-toque de 400ms), reduzindo o tempo por toque para 3–6 segundos e concluindo as 3 ações bem abaixo do orçamento de 180s.
  - **Diferenciação precisa entre feed e anúncios (Risco 2):** Introduzido `normalizeFeedUrl` para desconsiderar parâmetros voláteis de tracking (`_immersiveMode`, `spm`, `aecmd`, `ts`, etc.). `isFeedUrl` agora valida tanto a igualdade da URL normalizada quanto a presença física de cards de produto no DOM (`cardCount > 0`), além de revalidar a URL base de navegação após redirecionamento inicial.
  - **Eliminação de repetição de cards por rotação circular (Risco 3):** Substituição do cálculo de índice por módulo por rastreamento determinístico de assinaturas únicas (`getCardSignature`) via `touchedCardsSet` persistido durante a execução da conta. A automação seleciona estritamente cards inéditos, rola o feed se necessário e interrompe a rodada de forma limpa caso todos os cards disponíveis já tenham sido tocados, impedindo re-toques inócuos não pontuados pelo AliExpress.

- **Despacho de tarefas na fachada de UI (`libs/ui/tasks.js`):** Correção da incompatibilidade de assinatura em `executeTaskAction` (que recebia 4 parâmetros posicionais em `libs/ui/tasks.js` enquanto `do_tasks.js` passava um objeto de parâmetros `{ page, context, task, config, signal }`). A fachada agora propaga os argumentos transparentemente via `...args` para `dispatcher.executeTaskAction` (e em `executeSurpriseItems`, `openTaskDrawer` e `extractTasksFromDrawer`), restaurando a identificação da tarefa "Browse surprise items" (que caía indevidamente no fallback genérico de scroll com título vazio `""`), além de garantir a propagação do `AbortSignal`.
- **Navegação e retorno de anúncios em "Browse surprise items" (`libs/tasks/surprise.js`):** Correção da inversão lógica booleana (`!page.url().includes('adclick.html')`) que impedia o retorno via `page.goBack()` quando o toque em um card de produto navegava na mesma aba para URLs de anúncio/redirecionamento (`adclick.html`). O fluxo agora detecta redirecionamento para `adclick.html`, páginas de item (`/item/`, `/detail/`) ou URLs que saem do feed, aguarda o registro de tracking (1,5s), executa `page.goBack()` e, caso o histórico fique retido em `adclick.html`, força `page.goto(feedUrl)`.
- **Captura resiliente de novas abas em ambientes de baixa memória (`libs/tasks/surprise.js`):** Adicionado fallback via `context.pages()` para capturar e fechar abas filhas quando `context.waitForEvent('page')` expira por latência ou concorrência em hosts restritos (como instâncias com 1 GB de RAM).

- **Incremento de streak (+1) ao realizar check-in com sucesso (`collect.js`):** Quando o check-in é realizado hoje (`justCollected === true`), se a interface móvel/desktop do AliExpress reportar leitura espúria (<= 7), ausente ou não atualizada ainda pelo DOM (<= `previousStreakDays`), o streak anterior é incrementado com segurança (`previousStreakDays + 1`), garantindo que o streak não fique congelado no dia anterior nem seja confundido com quebra de sequência. Em re-execuções no mesmo dia (`alreadyCollected === true`), a sequência consolidada é preservada sem incremento repetido.
- **Isolamento de moedas do check-in no extrato de tarefas (`collect.js`, `libs/report.js`, `libs/notify.js`):** Correção da regressão da versão 1.0.0 em que o valor recebido no check-in estava sendo somado ao total do extrato das tarefas:
  1. `collect.js` sincroniza o saldo total pós-checkin (`totalBalance`) considerando as moedas recebidas caso a página desktop ainda não tenha registrado a transação no momento da checagem pós-mobile.
  2. `computeTasksCoinsGained` (`libs/report.js`) detecta se o saldo inicial das tarefas correspondeu ao saldo pré-checkin e desconta as moedas do check-in, garantindo que o extrato e relatórios de tarefas reflitam estritamente as moedas ganhas pelas tarefas tanto em conta única quanto em multi-contas.
  3. `libs/notify.js` prioriza o cálculo centralizado e validado de `meta.tasksCoinsGained`, eliminando sobrescrevimento indevido por deltas brutos.
  4. Nova função `getCheckinCoinsFromStreak` (`libs/ui/balance.js`) para inferir a tabela oficial de moedas do AliExpress a partir do dia do streak como fallback caso o ledger desktop venha temporariamente como `N/D`, impedindo que novo check-in contabilize zero moedas.
- **Contabilização de check-in zerada quando já coletado no dia (`collect.js`, `libs/report.js`, `libs/notify.js`):** Em re-execuções no mesmo dia (`alreadyCollected === true`), o extrato no console (`renderCheckinReport`, `renderUnifiedReport`, `renderMultiAccountReport`), webhooks e notificações do Telegram reportam explicitamente `check-in +0` / `Já coletado (+0 moedas)` e não contabilizam valor fantasma no total diário de moedas ganhas, preservando integralmente o extrato das tarefas tanto em execuções de conta única quanto multi-contas.

## [1.0.0] - 2026-09-17

> **Notas de migração (0.9.x → 1.0.0):** o contrato público está congelado — CLI e exit
> codes `0–6`, formato de `session*.json(.enc)`, tokens `v3:N:r:p:...` (com leitura
> transparente de `v1`/`v2`), variáveis de ambiente e relatórios `--json`. Mudanças de
> comportamento relevantes:
>
> - **Lockfile no diretório do projeto** (`ali-coins-<uid>.lock`), não mais em `/tmp`;
>   execuções nativas e via Docker **não compartilham** o lock (evite rodá-las juntas).
> - **Flags de baixo consumo do Chromium ativas por padrão** (opt-out
>   `CHROMIUM_LOW_MEMORY=false`; heap ajustável via `CHROMIUM_JS_HEAP_MB`, 64–2048 MB).
>   `--no-zygote` só é aplicado com sandbox desabilitado; há fallback automático de
>   sandbox apenas quando o erro indica sandbox indisponível.
> - **Importação em lote remove `session_token*.txt` após o sucesso** — use
>   `--keep-tokens` (ou `KEEP_SESSION_TOKENS=true`) para preservá-los.
> - **Logs mascaram PII e segredos em query strings** (tokens/apikeys em URLs deixam de
>   aparecer em claro no `cron.log`).
> - **`SCRYPT_N` com piso 16384 e teto 1048576**; parâmetros embutidos em tokens `v3` são
>   sanitizados na decifragem.
> - **`PW_SCREENSHOT` passou a ser aplicado de fato** (captura automática em falha ou
>   sempre, conforme configuração).
> - **Node.js >= 22** é obrigatório.
> - Sessões e tokens existentes continuam válidos; a rotação de chaves agora cobre todas
>   as contas (`export_session.js --rotate`).

### Corrigido

- **Lockfile em diretório privado do projeto:** o lock (primário e secundários) saiu de
  `/tmp` para o diretório do projeto, eliminando o vetor de DoS/adulteração por outros
  usuários (diretório no caminho do lock, symlink ou timestamp forjado). Se o caminho
  estiver ocupado por item não removível, a falha agora é imediata e explícita (antes
  repetia 5 rodadas de carência até falhar).
- **Race de liberação do lockfile (detectada no CI Windows):** o arquivo ganhou um
  `lockId` de geração e o `release()` só remove o lock se o `lockId` ainda for o nosso,
  eliminando a janela em que uma liberação atrasada apagava o lock de outra instância
  recém-adquirida.
- **Erro transitório de I/O no lockfile tratado como lock ativo:** falhas de leitura
  (`EBUSY`/`EPERM`/`EACCES`, comuns com antivírus/indexador no Windows) não removem mais o
  arquivo; a execução é adiada de forma fail-safe (`LOCK_ACTIVE`). Diretório no caminho
  continua com falha rápida e clara.
- **Valor fantasma de check-in no relatório multi-conta
  (`buildMultiAccountReportPayload`):** `alreadyCollected: true` voltou a ser respeitado —
  o `coinsGainedToday` é apenas eco informativo do check-in já feito e não infla mais
  `checkinCoinsGained`/`totalCoinsGained` na notificação de contas secundárias (mesma
  correção aplicada ao caminho unificado na 0.9.1).
- **Cálculo de moedas centralizado:** `computeCheckinCoinsGained`, `computeTasksCoinsGained`
  e `computeFinalBalance` (`libs/report.js`) são a fonte única usada pelos payloads e pelos
  fallbacks do Telegram (`libs/notify.js`), eliminando a divergência por cópia de código.
  `computeTasksCoinsGained` ignora `NaN`/`Infinity` e `computeFinalBalance` retorna `N/D`
  (em vez de `"undefined moedas"`) quando o saldo não foi lido.
- **`notify.js` multi-conta sem `meta`:** o fallback local também não contabiliza mais o
  check-in quando `alreadyCollected` é true.
- **`setup_linux.sh`/`setup_macos.sh` não expõem mais o `SESSION_SECRET` gerado no `argv`**
  (visível via `ps`): a chave é passada por variável de ambiente ao processo Node.
- **Sinais propagados nos scripts de execução:** `run.sh`/`run_tasks.sh` usam `exec` e o
  `run_all.sh` encaminha `TERM`/`INT` ao Node filho, evitando Node/Chromium órfãos em
  `kill`/stop do systemd.
- **Encerramento nunca trava no flush (`libs/exit.js`):** teto de 5s para stdout/stderr e
  flush síncrono do destino do pino (`--json`).
- **Fallback de launch não desabilita o sandbox por falha genérica:** a tentativa sem
  `--no-sandbox` só ocorre quando o erro indica sandbox/zygote indisponível; falhas
  transitórias repetem apenas sem as flags de baixo consumo, preservando o sandbox. O erro
  final preserva a causa original (1ª tentativa).
- **Segredos em URLs não vazam mais nos logs:** `maskHeartbeatUrl` mascara token em
  segmento intermediário do path, limpa credenciais embutidas (`user:senha@host`) e remove
  fragmento; o logger sanitiza **todos os valores string** de campos estruturados (ex:
  `{ url }`), não apenas `msg`/`err`.
- **PII com local part curto:** `maskUser('a@b.co')` passa a retornar `***@b.co` (antes o
  e-mail inteiro vazava por a regex exigir 2 caracteres antes do `@`).
- **Botão de tarefa desconhecido não é mais tratado como “Concluída”:** a conclusão exige
  sinais positivos (estilo desabilitado ou texto DONE/CONCLUÍDO/COMPLETED); rótulos novos
  (A/B test) ficam como `Requer verificação manual (botão "X" não reconhecido)`, e o
  progresso informado (`statusText`, ex: `1/3`) tem prioridade na classificação.
- **Heurística textual `cover` removida da detecção de botão desabilitado:** um estilo com
  `background-size: cover` podia marcar uma tarefa **ativa** como concluída; agora apenas
  `opacity: 0.5` (e rounds completos/texto DONE) indicam conclusão.
- **`decryptSession` reporta parâmetros scrypt inválidos como falha de autenticação:** o
  `scryptSync` foi movido para dentro do bloco protegido (com limpeza segura da chave).
- **`saveSession` grava metadados antes da sessão:** uma falha de escrita da sessão não
  deixa metadados órfãos nem descarta uma sessão válida no próximo ciclo.
- **Screenshot automático sem duplicação:** páginas que já tiveram print manual de falha
  não recebem captura automática duplicada em `closeContextWithDiagnostics`.
- **`CHROMIUM_JS_HEAP_MB` com clamp em `[64, 2048]` MB** — typos não geram flags absurdas.
- **Telegram:** `streakDays`, saldo e durações agora passam por `escapeHtml`.
- **Crash handler faz flush dos logs** antes do `exit 6`.
- **`os.userInfo()` protegido:** containers com `--user` sem entrada em `/etc/passwd` não
  quebram mais o boot (tratado como não-root).
- **Exportação tolerante a caixa da conta:** `expectedUser` e `meta.user` são comparados
  sem diferenciar maiúsculas/minúsculas quando representam o mesmo identificador.
- **`positiveInt` rejeita valores não numéricos** (ex: `10abc` deixa de ser aceito como 10).
- **`PW_SCREENSHOT` funcional:** captura automática de screenshot no encerramento de
  contexto com falha (`only-on-failure`) ou sempre (`on`) — antes era config morta.

### Adicionado

- **Flags de baixo consumo do Chromium (padrão) e `CHROMIUM_JS_HEAP_MB` configurável:**
  `--disable-gpu`, `--disable-software-rasterizer`, `--renderer-process-limit=1`,
  `--js-flags=--max-old-space-size=128` (ajustável, valores inválidos voltam ao padrão) e
  `--disk-cache-size=10485760`; desativável via `CHROMIUM_LOW_MEMORY=false`. `--no-zygote`
  só é aplicado com sandbox desabilitado (exigência do Chromium). Documentado no
  `credentials.env.example`.
- **Job `Docker Build & Smoke` no CI:** build da imagem, validação dos padrões de
  segurança do `.dockerignore`, `--dry-run` e launch do `chrome-headless-shell` dentro do
  container — pega regressões de Dockerfile/.dockerignore antes do merge.
- **Allowlist `files` no `package.json`:** evita publicar acidentalmente arquivos de
  sessão/credenciais em um eventual `npm pack/publish`.
- **`docker-run.example.sh`:** wrapper de cron recomendado para hosts pequenos, com
  `--init`, `--pids-limit=256`, limites `--memory`/`--memory-swap` (768m/1536m), rotação de
  log e registro do **pico real** de memória/PIDs de cada execução.
- **Guia de host com 1 GB RAM:** `README.md` e `CLOUD_SESSIONS.md` passam a recomendar
  swap de 1–2 GB, `SCRYPT_N=32768` (~33 MB de pico em vez de ~134 MB) e as flags
  `--shm-size=256m --memory=768m --memory-swap=1536m` no `docker run`. O guia também
  documenta que execuções nativas e via Docker **não compartilham o lockfile**.
- **Workflow `Release` testável manualmente:** `workflow_dispatch` com input `tag`
  (checkout no ref informado), permitindo ensaiar/republicar releases sem criar tag nova.
- **Novos testes (226 no total):** `.dockerignore`, `PW_SCREENSHOT` (deduplicação),
  fallback progressivo (sandbox e memória), falha genérica sem desabilitar sandbox, heap
  configurável com clamp e erro com `cause`, segredos em URL/query string (logger e
  heartbeat, incluindo token no meio do path e credenciais), escape do Telegram,
  crash/flush, `positiveInt` estrito, `exportSession` case-insensitive, falha rápida do
  lock em diretório, release por `lockId` e I/O fail-safe, rótulo DONE vs. botão
  desconhecido, prioridade de `statusText`, estilo `cover` não conclui tarefa, metadados
  antes da sessão, token compacto com `SCRYPT_N` alto, valor fantasma de check-in nos três
  caminhos, `maskUser` com local part curto e saldo ausente/N/D.

### Alterado

- **Imagem Docker mais enxuta e leve:** instala apenas o `chrome-headless-shell`
  (`playwright install --only-shell chromium`, ~390 MB a menos, já que a imagem sempre
  roda headless), remove o `curl` do runtime, limpa o cache do npm na mesma camada e
  define `NODE_OPTIONS=--max-old-space-size=192` (GC mais agressivo em hosts de 1 GB).
- **Contexto de build reduzido (`.dockerignore`):** `tests/`, arquivos Windows
  (`*.bat`, `*.ps1`, `setup_windows.*`, `generate_secret.*`), documentação extensa
  (`INSTALL_*.md`, `TELEGRAM.md`, `README.md`, `CLOUD_SESSIONS.md` etc.), ferramentas de
  dev/CI (`.github/`, `.husky/`, `eslint.config.js`) ficam fora da imagem — mantendo todas
  as exclusões de segurança de sessões/credenciais/tokens.
- **HEALTHCHECK a cada 5 minutos** (antes 30s): evita ~2.600 execuções diárias
  desnecessárias de um processo Node em um job que roda 1×/dia.
- **Recomendação de `PW_TRACE=off` em hosts apertados** documentada no
  `credentials.env.example` (os screenshots manuais de falha continuam ativos).

## [0.9.7] - 2026-09-17

### Corrigido

- **Rotação Multi-Conta Isolada por `baseDir` (`rotateAllSessions`):** os backups de rotação das contas secundárias passam a ser gravados no `scratch/` do diretório alvo (ex: diretório do projeto sob teste), nunca no `scratch/` real do projeto. Regressão coberta por teste que compara a listagem do scratch real antes/depois.
- **Compatibilidade Windows do Teste de Env do Chromium:** a asserção de preservação de `PATH` agora compara sem diferenciar maiúsculas/minúsculas (Windows expõe `Path`), mantendo a validação de que variáveis sensíveis não são propagadas.
- **Anti-DoS do Lockfile por Timestamp Forjado:** locks com `createdAt` no futuro (além de 5 min de tolerância de skew) ou inválido/ausente agora são tratados como stale e substituídos, eliminando bloqueio permanente por lock malicioso/corrompido. O lockfile passou a ser **isolado por usuário** (`ali-coins-<uid>.lock` no tmpdir), impedindo interferência entre usuários em hosts compartilhados.
- **Encerramento Gracioso no `all.js`:** novo `gracefulExit` fecha o browser Playwright e libera o lockfile antes de sair em todos os caminhos (o `process.exit()` não executa o bloco `finally`), evitando processos do Chromium órfãos e locks presos em falhas.
- **Marcação de PII em Logs:** e-mails/telefones deixam de ser logados em claro (`[Login] Usuário`, autenticação, salvamento/carga/rotação/migração de sessão, import/export) e passam a usar `maskUser`.
- **Heartbeat Sem Stack Trace:** `pingFail` envia apenas `Nome: mensagem` (limite de 2000 chars) ao monitor externo, sem caminhos internos/URLs sensíveis da stack.
- **Poda de Diagnósticos Sem Efeito Colateral:** `pruneSessionBackups({ scratchDir })` não limpa mais temporários do diretório padrão do projeto quando nenhum caminho de sessão explícito foi informado.
- **Exportação Valida a Conta Alvo:** `exportSession` aceita `expectedUser` (usado por `--account` e `--all`) e falha se o `meta.user` da sessão não corresponder à conta solicitada, em vez de validar contra o próprio metadado (checagem tautológica).
- **Push Sem Token no `argv`:** `push_to_github.sh` autentica via `GIT_CONFIG_KEY_0=http.extraHeader` em variável de ambiente, evitando que o header Basic/PAT apareça na linha de comando do git (visível a outros usuários locais via `ps`).
- **PII Residual em Logs e Relatórios (varredura final):** e-mails completos também foram mascarados em `libs/ui/login.js` (falha de autenticação), `libs/report.js` (relatório unificado) e `collect.js` (contexto de erro e mensagem de falha de saldo), fechando os últimos pontos que ainda logavam o identificador em claro.
- **Encerramento Nunca Trava no `browser.close()`:** o `gracefulExit` limita o fechamento do Chromium a 10s (com `unref` no timer), garantindo que um browser travado não impeça o encerramento do cron nem deixe o lock preso.
- **Locks Secundários Isolados por Usuário:** as contas além da primária também usam o sufixo de uid no nome do lock (`ali-coins-<uid>-<hash>.lock`), eliminando colisão entre usuários com contas homônimas.

### Adicionado

- **Testes (191 no total):** lock com `createdAt` futuro/inválido/ausente, isolamento do lockfile por usuário, heartbeat sem stack, validação de conta alvo na exportação e mascaramento de PII nos logs de sessão. Removidas sobras locais sensíveis (dumps de DOM pré-privacidade, `mobile_body.html`, tokens exportados antigos e `credentials.env.bak`).

## [0.9.6] - 2026-09-17

### Corrigido

- **Lockfile com Publicação Atômica por Hardlink:** o lock agora é gravado completo em arquivo temporário (com `fsync`) e publicado via `fs.link` (falha com `EEXIST` sem sobrescrever). Elimina a janela de leitura parcial do fix anterior, na qual um concorrente podia ler o lock vazio entre `open('wx')` e a escrita, removê-lo e ambos se considerarem donos (reproduzido: 12 sobreposições sob stress). Fallback `wx` com carência de leitura de 900 ms em filesystems sem hardlink.
- **`.dockerignore` Completo para Segredos:** cobertura de `session*.json`, `session_meta*.json`, `session_token*.txt`, `accounts.json`, `*.enc`, `credentials.env*` e `sbom.json`, evitando que sessões secundárias em texto puro, metadados e tokens sejam assados nas camadas da imagem.
- **Ambiente do Chromium Sem Segredos:** `getChromiumEnv` passou a filtrar variáveis sensíveis (`SESSION_SECRET`, `ALI_PASSWORD`, `TELEGRAM_*`, `GITHUB_*`, `NOTIFY_*`, `HEARTBEAT_*`, `*_TOKEN`, `*SECRET*`, `*PASSWORD*`, `api_key`) antes de repassar o env aos subprocessos do navegador.
- **Preservação de Sessão em Falha de DOM:** `collect.js` não remove mais `session.json.enc`/metadados quando streak/saldo não são lidos — a falha pode ser apenas de layout. A limpeza continua ocorrendo em `validateAndRefresh` somente com cookie de autenticação comprovadamente expirado.
- **Login Novo Limpa Marcadores de Sessão Remota:** `saveSession({ freshLogin: true })` (usado por `performMobileLogin`) remove `isImported`/`importedAt`, evitando alertas falsos de "sessão remota expirada" após login local com senha/2FA.
- **Rotação de Chave Multi-Conta:** `export_session.js --rotate` agora usa `rotateAllSessions`, rotacionando todas as contas configuradas (antes só a primária era migrada, deixando as secundárias presas à chave antiga); falha parcial retorna exit code 1.
- **Container com Healthcheck Real:** `HEALTHCHECK` valida de fato `node all.js --dry-run --json` (sem fallback enganoso) e o `Dockerfile` define `NODE_ENV=production` (logs JSON sem depender de `pino-pretty`).
- **Correções Pontuais:** `User-Agent` do heartbeat derivado da versão real do `package.json`; `--from-file`/`--account` preservam valores com `=`; schema multi-conta alinhado com `isImportedSessionExpired`; `push_to_github.sh` não repassa mais argumentos (ex: `--force`) ao push da `main`; warning de piso do `SCRYPT_N` emitido uma única vez.

### Adicionado

- **Testes de Regressão (187 no total):** stress de concorrência do lock com 6 processos (zero sobreposições), sanitização de env do Chromium, `freshLogin`, rotação multi-conta e descoberta dos smoke tests de seletores (`selectors.smoke.test.js`). A guarda anti-destruição do `test_helper` agora cobre dinamicamente todas as sessões/tokens/contas reais (incluindo secundárias).

## [0.9.5] - 2026-09-17

### Corrigido

- **Cancelamento Cooperativo de Ações em Timeout (`withTimeout` + `AbortSignal`):** O timeout por tentativa de tarefa (`TASK_MAX_DURATION_MS`) agora fornece um `AbortSignal` que é abortado no disparo, propagado por `executeTaskAction`, `waitWithScroll`, `executeSurpriseItems` e `executeSearchTask`. A ação órfã deixa de continuar manipulando o mesmo `page` em segundo plano, encerrando nos checkpoints de scroll/clique.
- **Privacidade do Dump de DOM (`captureDomHashAndArtifacts`):** O artefato `dom-*.hash.txt` passa a gravar somente hash SHA-256, timestamp, alvo e tamanho do HTML. O HTML normalizado completo (que pode conter dados de conta/CSRF) só é anexado com opt-in explícito via `PW_DUMP_DOM=true` em depuração local. O diretório `scratch/` é restringido a `0o700`.
- **Truncamento Universal de Mensagens do Telegram:** `sendTelegram` agora aplica `truncateMessageIfNeeded` a **todas** as mensagens (inclusive falhas com stack traces longos do Playwright) e ao fallback de texto puro, evitando HTTP 400 silencioso por exceder 4096 caracteres.
- **Alerta de Sessão Remota no Modo Multi-Conta:** `buildMultiAccountReportPayload` passou a propagar `isImportedSessionExpired`, reativando o bloco de aviso "Sessão Remota Expirada" na notificação consolidada (antes era código morto).
- **Mensagens de Validação PT-BR no Zod 4:** `ALI_USER`/`ALI_PASSWORD` usam a opção `error` (que substituiu `required_error`/`invalid_type_error`), restaurando as mensagens em português no `credentials.env` inválido.
- **Gitleaks Sem Allowlist de Diretório:** a exclusão genérica de `tests/` foi removida e substituída por allowlist de **valores exatos** fictícios. O scan completo do histórico agora cobre qualquer segredo real, inclusive em testes.
- **Supply-Chain do CI:** todas as GitHub Actions (`checkout`, `setup-node`, `upload-artifact`, `gitleaks-action`, `codeql-action`, `fetch-metadata`) foram pinadas por SHA de commit com comentário de versão; o workflow passou a declarar `permissions: contents: read` por padrão e `persist-credentials: false` nos checkouts.

### Adicionado

- **Higiene de Tokens de Importação:** `import_session.js --all` remove cada `session_token*.txt` após importação bem-sucedida (uso único), com opt-out via `--keep-tokens` ou `KEEP_SESSION_TOKENS=true`. Documentado no `README.md` e `CLOUD_SESSIONS.md`.
- **Testes de Regressão:** aborto do `AbortSignal` no timeout, encerramento imediato do `waitWithScroll` por abort, ação em task já abortada sem tocar no browser, artefato DOM sem HTML por padrão (+ opt-in), diretório de diagnóstico `0700`, truncamento de erros longos no Telegram, flag multi-conta de sessão remota, mensagens Zod PT-BR, remoção/preservação de tokens (179 testes no total).

## [0.9.4] - 2026-09-17

### Corrigido

- **Aquisição Atômica do Lockfile (`acquireLock`):** Eliminação da janela TOCTOU (_time-of-check to time-of-use_) que permitia duas instâncias adquirirem o mesmo lock simultaneamente sob concorrência real (reproduzido em 2/25 execuções com 6 processos). A criação agora usa a flag exclusiva `wx` (`O_CREAT|O_EXCL`) com `fsync`, inspeção de lock existente e até 5 tentativas após remoção de locks órfãos/stale. Adicionada defesa contra symlink no caminho do lock: o link é removido sem nunca seguir o alvo (impedindo truncamento malicioso de arquivos em `/tmp`).
- **Encerramento Correto em SIGINT/SIGTERM:** Os handlers de sinal do lockfile não suprimem mais o comportamento padrão do Node. Ao receber `SIGINT`/`SIGTERM`, o lock é liberado, os listeners são removidos e o sinal é reemitido, encerrando o processo imediatamente (antes, o processo permanecia vivo em segundo plano com o Chromium em execução). Após liberação normal do lock, os listeners também são removidos, restaurando o `Ctrl+C` padrão.
- **Flush de stdout/stderr Antes do Encerramento (`libs/exit.js`):** Novo helper `flushAndExit()` aguarda o flush físico de `stdout`/`stderr` antes de chamar `process.exit()`. Elimina o truncamento silencioso de relatórios JSON e tokens (`--json`, `--show-token`) no limite do buffer de pipe (~64 KB), mantendo os exit codes 0–6 inalterados.
- **Mascaramento de Segredos no Logger (`redact` + scrub recursivo):** Caminhos inválidos do fast-redact (`*secret*`, `*passwd*`) foram substituídos por caminhos válidos e uma varredura recursiva (`scrubSensitiveFields`) passou a mascarar chaves sensíveis por prefixo/sufixo (`my_secret_field`, `userToken`, `apiKey`, objetos aninhados) sem mutar o objeto original do chamador.
- **Leitura Não-Destrutiva de Sessões (`loadSessionFiles`):** Erros transitórios de I/O (`EACCES`/`EMFILE`/`EINTR`) não removem mais `session.json.enc`, `session.json` ou `session_meta.json`. A remoção de arquivos só ocorre quando a migração é concluída com sucesso; JSON malformado é preservado para diagnóstico em vez de excluído automaticamente.

### Adicionado

- **Testes de Regressão de Concorrência e Encerramento:** Cobertura dedicada para dupla aquisição sob 6 processos concorrentes, defesa contra symlink, encerramento por `SIGINT` com liberação de lock, ausência de truncamento de `stdout` acima de 64 KB, scrub de chaves sensíveis e preservação de arquivos de sessão sob `EACCES`/JSON malformado/falha de migração (171 testes no total).

## [0.9.3] - 2026-09-17

### Corrigido

- **Escrita Atômica de Sessões (`safeWriteFile`):** Eliminação do risco de arquivos de sessão e tokens truncados por encerramento abrupto do processo (`SIGKILL`, exit 137 / OOM em ambientes com pouca memória). O método agora grava inicialmente em arquivo temporário com permissão `0o600` (`<destino>.tmp-<pid>-<rand>`), realiza `fsync` físico e conclui a operação através de substituição atômica (`fs.promises.rename`). Em caso de falha, o arquivo de destino permanece 100% íntegro e temporários órfãos são removidos automaticamente no boot.
- **Handler Global de Falhas e Crash Handler (`setupGlobalCrashHandler`):** Tratamento global para exceções não capturadas (`uncaughtException`) e promessas rejeitadas sem captura (`unhandledRejection`) em `all.js`, `collect.js` e `do_tasks.js`. O handler registra log em nível `fatal`, efetua despacho best-effort de notificação parcial ao Telegram e sinal de falha no heartbeat, finalizando o processo com o novo código de saída padronizado **`6`** (com timeout de segurança de 5s para prevenir qualquer possibilidade de travamento).
- **Resiliência de Testes em CI Windows (`--test-timeout=35000` e `SCRYPT_N`):** Aumento do timeout nativo da suíte de testes de 15s para 35s nos scripts `test` e `test:coverage`, prevenindo timeouts espúrios no executor virtual `windows-latest` do GitHub Actions causados pela maior carga de computação scrypt v3 (`N=131072`). Adicionado suporte à variável de ambiente `SCRYPT_N` e setter programático em `SCRYPT_PARAMS_V3` para ajuste em hosts com recursos restritos.
- **Desduplicação Case-Insensitive de Contas (`loadAccounts`):** Comparação normalizada com `.toLowerCase()` no cadastro e agrupamento de contas em `config.js` (`accounts.json`, `ALI_USER` primário e `ALI_USER_2..20`), alinhando o comportamento ao importador de sessões e prevenindo a geração espúria de locks e arquivos duplicados para a mesma conta (ex: `Foo@x` e `foo@x`). Preserva integralmente o primeiro cadastro (usuário, `maskedUser`, índice, lock e caminhos) e herda `telegramChatId` se ausente.
- **Sanitização e Normalização no Template Multi-Conta (`libs/notify.js`):** Coerção defensiva de `streakDays` para número ou `'N/D'`, valores de moedas (`totalCoins`, `checkinCoins`, `tasksCoins`) para inteiros seguros `>= 0` via `toSafeInt`, e aplicação de `escapeHtml` nas interpolações do bloco multi-conta. Impede que valores malformados ou caracteres exóticos quebrem o parser HTML do Telegram Bot API (`400 can't parse entities`), preservando a saída idêntica byte-a-byte para entradas válidas.
- **Piso Criptográfico de Segurança em `SCRYPT_N` (`security.js`):** Estabelecido piso mínimo obrigatório de $N \ge 16384$ ($2^{14}$) para derivação de chaves scrypt. Valores inferiores configurados via variável de ambiente `SCRYPT_N` ou opções programáticas emitem alerta estruturado (`logger.warn`) e são clampeados de forma defensiva para o padrão seguro de $131072$ ($2^{17}$), impedindo o enfraquecimento acidental da criptografia AES-256-GCM sem causar falhas fatais no processo.
- **Gate de Supply-Chain no Auto-Merge do Dependabot:** Atualização do workflow `.github/workflows/dependabot-automerge.yml` com etapa de verificação ativa via `gh api` que aguarda a conclusão com sucesso do workflow `CI` (matriz Linux, macOS e Windows) no SHA exato do PR antes de autorizar o merge automático (`squash`), prevenindo merges prematuros mesmo sem regras de branch protection ativas.
- **Sanitização de Parâmetros scrypt em Tokens Não Confiáveis (`sanitizeScryptParams`):** O `decryptSession` não confia mais cegamente nos marcadores `N:r:p` embutidos em tokens `v3`. Novos tetos defensivos (`N <= 2^20`, `r/p <= 16`) e limite de memória combinada (`128*N*r <= 256 MB`, com redução progressiva e fallback seguro) impedem esgotamento de memória/CPU a partir de um token forjado ou corrompido, mantendo a compatibilidade integral com `v1`, `v2` e `v3` legítimos.
- **Coerção Numérica de `options.N` na Criptografia:** `encryptSession` agora aceita `N` em formato string numérico (ex: `'16384'`) e aplica a mesma sanitização da decifragem, garantindo que qualquer token gerado seja sempre decifrável e eliminando o erro críptico `The "N" argument must be of type number`.
- **Máscara de Telefone/Identificador (`maskUser`):** Usuários sem `@` (telefones/IDs) não expõem mais os dígitos finais nas notificações e logs (`11999887766` passa a exibir `11***` em vez de `11***66`). E-mails permanecem inalterados.
- **Documentação de Quoting de Credenciais:** `credentials.env.example` e guias `INSTALL_LINUX/WINDOWS/MACOS.md` agora alertam explicitamente que senhas com `#`, espaços ou `!` exigem aspas duplas, evitando o truncamento silencioso do `dotenv` (ex: `ALI_PASSWORD="abc#123!"`).

### Adicionado

- **Criptografia com Marcador de Parâmetros e Suporte v3:** Novos tokens de sessão gerados no formato versionado `v3:N:r:p:salt:iv:tag:ciphertext:base64` com parâmetros robustos (`scrypt N=131072` / 2¹⁷, `r=8`, `p=1`). O deserializador (`decryptSession`) oferece suporte transparente e retrocompatibilidade cruzada total entre versões `v3`, `v2` e `v1`.
- **Sincronização de Variáveis no `credentials.env.example`:** Documentação detalhada com exemplos e explicações para as variáveis `DIAGNOSTICS_RETENTION_DAYS` (retenção de artefatos e traces em `scratch/`, padrão 7 dias) e `NOTIFY_HOST_LABEL` (customização do rótulo do host nas mensagens do Telegram).
- **Documentação de Race em Reuso de PIDs no Lockfile:** Análise de segurança no código de `lockfile.js` documentando o comportamento fail-safe em eventuais reciclagem de PIDs pelo sistema operacional e a mitigação definitiva via `staleTimeoutMs` (30 min).

## [0.9.2] - 2026-09-17

### Corrigido

- **Anti-Travamento do Dispatcher de Tarefas (Rodadas Repetidas):** Rastreamento granular de tentativas por rodada (`getRoundKey`, combinando `taskTitle + statusText`). Ao atingir o limite configurável (`TASK_ROUND_MAX_ATTEMPTS=3`, padrão 3) sem avanço em `statusText` ou `completedRounds` (ex: travamento por throttling de msite/servidor), o despachante desiste da tarefa com o status descritivo `'Falhou (sem progresso após 3 tentativas)'` e a exclui do ciclo, eliminando repetições desnecessárias.
- **Timeout Estrito por Tentativa de Tarefa (`TASK_MAX_DURATION_MS`):** Implementação de encapsulamento com `withTimeout` (`TASK_MAX_DURATION_MS=180000`, padrão 3 minutos / 180s) abortando pontualmente tentativas congeladas, contabilizando a ação gasta, fechando abas filhas órfãs ou forçando cancelamento de navegações penduradas com `page.goto(coin-index, { waitUntil: 'commit', timeout: 10000 })` para garantir isolamento da próxima ação.
- **Fail-Fast em Páginas Lentas (`TASK_SCROLL_MAX_MS`):** Inclusão de teto defensivo em `waitWithScroll` (`TASK_SCROLL_MAX_MS=30000`, padrão 30 segundos) e saída antecipada quando nenhum sinal de tracking for detectado (`earlyExitOnNoProgress`, com suporte retrocompatível e depreciação dos aliases `earlyExitOnNoTracking` e `noTrackingTimeoutMs`).
- **Transparência e Integridade no Relatório Final:** Tarefas que desistirem ou falharem são categorizadas estritamente como `Falhou (...)` via `classifyTaskStatus(t, { failedTasks })` e nunca como `Concluída`, refletindo fielmente os dados no resumo impresso, no payload JSON e nas notificações enviadas ao Telegram e multi-conta.
- **Duração Real nas Notificações do Telegram:** Eliminação do valor estático `'0s'` em `all.js` no envio de relatórios individuais de contas em ambiente multi-conta, adicionando medição precisa de tempo por conta/etapa e resolução defensiva e inteligente de `totalDuration` em `buildUnifiedReportPayload`, `buildMultiAccountReportPayload` e `libs/notify.js` a partir dos timestamps reais de início/fim e etapas executadas.

## [0.9.1] - 2026-09-16

### Corrigido

- **Cálculo de Moedas no Check-in Já Coletado (Bug 12):** Na função `buildUnifiedReportPayload()` (`libs/report.js`), adicionada a condição `checkinResult.alreadyCollected === false` no cálculo de `checkinCoinsGained`. Evita duplicação ou contagem de moedas informativas em execuções subsequentes no mesmo dia.
- **Proteção de Sessão Multi-Conta no Importador (Bug 13):** Em `import_session.js`, lança `ImportSessionError` explícito quando o e-mail do token não coincide com nenhuma conta configurada em `credentials.env` ou `accounts.json` em ambientes com mais de uma conta (`accounts.length > 1`), impedindo a sobrescrita acidental da Conta 1 primária.
- **Isolamento de Streak Entre Contas (Bug 14):** Em `collect.js`, `previousStreakDays` passa a validar se `sessionStatus.previousMeta?.user === userEmail` antes de reutilizar o streak anterior, impedindo que contas novas herdem a sequência de dias de contas antigas e emitam alertas falsos de quebra de streak.
- **Roteamento de Alertas no Telegram (Bug 15):** Em `libs/notify.js`, `resolveUser()` retorna `null` para relatórios consolidados multi-conta (`multi_account_report`) e omite a linha `👤 Conta:` em alertas de escopo global (`streak_break`, `lock_active`, `failure`, `2fa_required`).
- **Confiabilidade da Suíte de Testes no Node.js 22:** Desativação de worker threads assíncronas do `pino.transport` durante testes (`NODE_TEST_CONTEXT` / `NODE_ENV=test`) em `logger.js`, inclusão de timeout defensivo de 15 segundos (`--test-timeout=15000`) em `package.json` e ajuste de timeout para 500ms no teste de 2FA não-interativo (`tests/non_interactive_2fa.test.js`).

## [0.9.0] - 2026-09-16

### Corrigido

- **Divergência de Sessão e Limpeza Indevida no Multi-Conta:** Correção da causa raiz do erro `Conta da sessão ativa ("conta1") não corresponde à conta configurada ("conta2")`. A função `resolveSessionPaths` (`libs/session.js`) agora deriva dinamicamente o caminho de metadados correspondente (`session_meta_<hash>.json` ou `session_meta.json`) a partir do `sessionPath` da conta. O arquivo `collect.js` removeu o fallback rígido para caminhos globais, e `validateAndRefresh` não executa mais `clearSession` destrutivo se o cache pertencer a outra conta configurada no `credentials.env`. Adicionada migração transparente e não destrutiva de sessões legadas via `syncAccountSessions` (`config.js`) e isolamento rigoroso de contextos de navegador Playwright entre iterações de contas em `all.js`.

### Adicionado

- **Exportação Multi-Conta (`export_session.js`):** Suporte nativo a múltiplas contas com as opções `--all` e `--account <id|email>`. Ao executar em ambiente com mais de uma conta configurada, o utilitário exporta todas as contas ativas gerando tokens criptografados individuais (`session_token.txt`, `session_token_2.txt`, etc.) ou exporta estritamente a conta solicitada.
- **Importação com Auto-Roteamento Inteligente (`import_session.js`):** Suporte nativo a `--all` e `--account <id|email>`. O importador inspeciona o payload descriptografado (`meta.user`) e roteia a gravação automaticamente para o arquivo isolado da respectiva conta (`session.json.enc` para a Conta 1, `session_<hash>.json.enc` para contas secundárias), impedindo sobrescritas acidentais. O comando `node import_session.js --all` importa e protege todas as contas de uma única vez no servidor remoto.

## [0.8.3] - 2026-09-16 (atualizada em 2026-09-16)

### Corrigido

- **Scripts Batch do Windows (`setup_windows.bat`, `run_all.bat`, `run.bat`, `run_tasks.bat`):** Correção da validação da versão do Node.js (`set NODE_MAJOR` com operador `LSS`) eliminando o erro de parsing do interpretador `cmd.exe` causado por `< 22` e operadores `||` em comandos inline que interrompiam a execução logo nas primeiras linhas. Adição de `chcp 65001 >nul` para UTF-8 nativo no CMD, ancoragem de diretório com `cd /d "%~dp0"`, eliminação de `||` no teste do Chromium e mecanismo defensivo com `pause` ao detectar falha em execuções por duplo-clique no Explorador de Arquivos.
- **Encoding UTF-8 no Windows PowerShell (`run_all.ps1`, `run.ps1`, `run_tasks.ps1`, `setup_windows.ps1`):** Configuração nativa de suporte completo a UTF-8 (`chcp 65001`, `[Console]::OutputEncoding`, `[Console]::InputEncoding` e `$OutputEncoding = [System.Text.Encoding]::UTF8`) e repasse de argumentos via splatting (`@args`), eliminando problemas de caracteres corrompidos/mojibake na exibição de logs, acentuações e emojis (`🪙`, `💰`, `⏱️`, `✅`, `🚨`).

### Adicionado

- **Retenção Automática de Diagnósticos em `scratch/`:** Expansão do mecanismo `pruneSessionBackups` (`libs/session.js`) para expirar artefatos de diagnóstico em `scratch/` (`*-trace-*.zip`, `*.png`, `dom-*.hash.txt`, `mobile_body.html`, `*.jpeg`) compartilhando a política de `SESSION_BACKUP_RETENTION_DAYS` ou `DIAGNOSTICS_RETENTION_DAYS` (padrão de 7 dias) e suporte integral a `--dry-run`. Proteção estrita garantida: arquivos essenciais de sessão e agendamento (`session.json`, `session.json.enc`, `session_meta.json`, `session_token.txt`, `cron.log`, `credentials.env`) permanecem 100% protegidos contra remoção acidental.
- **Gerador de Chave SESSION_SECRET no Windows (`generate_secret.bat`, `generate_secret.ps1`):** Utilitários dedicados para gerar chaves de 32 bytes em Base64 para `SESSION_SECRET` suportando opcionalmente OpenSSL (`openssl rand -base64 32`) com detecção automática do binário no sistema ou no Git for Windows, e solução complementar nativa via Node.js crypto (`crypto.randomBytes(32)`) e .NET `RandomNumberGenerator`, dispensando a instalação avulsa do OpenSSL no Windows.
- **Configuração Automática de Chave no Setup do Windows:** `setup_windows.bat` e `setup_windows.ps1` passam a gerar e pré-configurar automaticamente a chave `SESSION_SECRET` em `credentials.env` recém-criado, com orientações detalhadas em `INSTALL_WINDOWS.md`.
- **Configuração Automática de Chave no Setup do Linux e macOS (`setup_linux.sh`, `setup_macos.sh`):** Integração da geração automática de chave `SESSION_SECRET` (AES-256 de 32 bytes em Base64) na criação de `credentials.env` a partir do modelo, com detecção de `openssl` e fallback nativo para `crypto.randomBytes(32)` do Node.js, garantindo paridade multiplataforma completa (Linux, macOS e Windows) e sincronização com os manuais (`INSTALL_LINUX.md`, `INSTALL_MACOS.md`).

### Alterado

- **Manutenção de Dependências:** Atualização de `prettier` de `3.9.6` para `^3.9.7` em `devDependencies`.

## [0.8.2] - 2026-09-15

### Corrigido

- **Importação Criptografada At-Rest:** `import_session.js` agora salva por padrão em `session.json.enc` (AES-256-GCM v2, permissão `0o600`) respeitando `ENCRYPT_LOCAL_SESSION=true`, com opt-out explícito via `--plaintext` e migração segura de `session.json` legado com remoção do texto plano apenas após gravação e criptografia bem-sucedidas.
- **Streak-Break Guard Resiliente:** Prevenção de falso-positivo de streak quebrado causado por leitura espúria de ciclo semanal de 7 dias da interface móvel quando a sequência anterior no histórico for muito superior (`isStreakBreak`, commit `15d2725`).
- **Notificações de Erro no Telegram:** Extração da causa raiz (`extractRelevantErrorMessage`) isolando a mensagem de erro antes dos delimitadores de logs de encerramento do Playwright (`cleanup`, etc.) (commit `b1293ac`).
- **Contabilidade de Tarefas no Telegram:** Fallback determinístico por diferença de saldo (`balanceFinal - balanceAfterCheckin`) quando `meta.tasksCoinsGained` estiver ausente (commit `b1293ac`).
- **Montagem de Sessão Docker:** Exemplos de `docker run` no `README.md` atualizados montando `session.json.enc`, `session_meta.json` e `session.json` com `touch` e `chmod 600` prévios (commit `b1293ac`).
- **Instaladores Multiplataforma:** Correção de execução no Windows com ancoragem de diretório (`cd /d "%~dp0"`), validação nativa de Node.js `>= 22` sem parsing frágil de strings em batch, chamada direta do CLI do Playwright, permissões ACL via `icacls`, criação de instalador nativo PowerShell (`setup_windows.ps1`), ajuste de numeração e permissões em `setup_linux.sh` e `setup_macos.sh`, e sincronização completa dos manuais de instalação (`INSTALL_WINDOWS.md`, `INSTALL_LINUX.md`, `INSTALL_MACOS.md`).
- **Manual do Telegram e Inicialização de Conversa:** Documentação formal da etapa obrigatória de autorização inicial via `/start` antes do cadastro de credenciais, refletindo a restrição de arquitetura da Telegram Bot API que impede bots de originar conversas com usuários (`TELEGRAM.md`, `README.md`, `CLOUD_SESSIONS.md`), e inclusão de dica proativa no logger (`libs/notify.js`).

### Adicionado

- **Rótulo de Host Customizado:** Variável `NOTIFY_HOST_LABEL` no `config.js` e `libs/notify.js` para identificação legível da máquina/servidor em containers descartáveis (`--rm`).
- **Confirmação de Envio no Log:** Emissão de log informativo (`logger.info`) ao despachar notificações no Telegram com sucesso (`libs/notify.js`), facilitando o acompanhamento visual da entrega nos logs de console e agendadores (cron).
- **Exemplo de Logrotate para Cron:** Seção em `CLOUD_SESSIONS.md` com modelo de configuração do `logrotate` (`copytruncate weekly rotate 4`) para gerenciamento de logs de agendamento em servidores de nuvem.

## [0.8.1] - 2026-09-15

### Corrigido

- **Contabilidade de moedas no Telegram:** relatório passa a usar delta de saldo (saldo final − saldo inicial) em vez de soma estimada, com template atualizado (`all.js`, `do_tasks.js`, `libs/notify.js`, `libs/report.js`, `libs/tasks/verifier.js`).

## [0.8.0] - 2026-09-14

### Adicionado

- **Criptografia At-Rest da Sessão:** Persistência de `session.json.enc` usando AES-256-GCM v2 com derivação `scrypt` e salt dinâmico (`ENCRYPT_LOCAL_SESSION=true`).
- **Migração Transparente:** Leitura automática de `session.json.enc` com fallback para `session.json` legado e migração automática.
- **Rotação de Chaves:** Suporte à variável `SESSION_SECRET_OLD` e comando CLI `node export_session.js --rotate --new-secret-from-env=VAR` via `rotateSessionSecret`.
- **Backups Versionados & Retenção:** Geração de backup seguro em `scratch/session.bak-<timestamp>.json.enc` (0o600) e política de expiração automática (`pruneSessionBackups`, `SESSION_BACKUP_RETENTION_DAYS=7`).
- **Observable Selectors & Diagnósticos:** Captura automática de hash SHA-256 do HTML normalizado (`scratch/dom-<timestamp>.hash.txt`) e screenshot (`scratch/tasks_drawer_failed.png`) em falhas do drawer de tarefas (`captureDomHashAndArtifacts`).
- **Notificações Telegram:** Suporte nativo completo a notificações via Bot do Telegram (`libs/notify.js`, flags `--notify` / `--no-notify`), suporte multi-conta com chat IDs dedicados (`TELEGRAM_CHAT_ID_${i}` / `telegramChatId` em `accounts.json`), formatação resiliente com resumo limpo e tratamento de erro sem interromper a automação.
- **Alerta de Sessão Remota Expirada:** Diagnóstico imediato no log e Telegram quando uma sessão importada de outro host expira, orientando a renovação com `node export_session.js`.
- **Resiliência Multi-Conta:** Fila sequencial com backoff exponencial com jitter (base 2s a teto 30s) entre falhas de contas (`calculateAccountBackoff`, `ACCOUNT_BACKOFF_BASE_MS`) e chamadas de notificação 100% blindadas contra exceções.
- **Smoke Tests de Seletores:** Suíte `tests/selectors.smoke.js` com fixture HTML sem dependência de navegador real e guia de atualização via dump.
- **Segurança Docker & BuildKit:** Imagem base pinada por digest multi-plataforma (`node:22-slim@sha256:...`), usuário dedicado não-root `appuser` (UID 10001 / GID 10001), nota de cache mount BuildKit `/ms-playwright` e HEALTHCHECK inteligente (`CMD-SHELL [ -f credentials.env ] && node all.js --dry-run --json ...`).
- **CI & Cobertura:** Elevação do threshold de cobertura de linhas nativo para `>= 80%`, geração de SBOM CycloneDX, scan de segredos com Gitleaks, CodeQL básico e dependabot auto-merge.
- **Supply-Chain & Upgrades:** Atualização para `commander` v15 e `eslint` v10 (com `globals`), auditoria zero vulnerabilidades e permissão estrita `0o600` auditada em todos os artefatos de segredos.
- **Streak-Break Guard (P1):** Rastreamento de histórico de sequência com persistência segura (`updateSessionStreak`, `lastStreakDays`, `lastCheckinDate` em `session_meta.json`). Detecção determinística de reset de sequência (ex: 200 ➔ 1 dias) com zero falso-positivo na primeira execução (`isStreakBreak`), alerta crítico no Telegram (`🚨 STREAK QUEBRADO`) e encerramento com **exit code 4**.
- **2FA Fail-Fast em Cron / CI (P2):** Detecção automática de ambiente não-interativo (`!process.stdin.isTTY`). Quando o AliExpress solicita verificação 2FA, encerra imediatamente em `<5s` com erro tipado `TwoFactorRequiredNonInteractive`, alerta no Telegram com passo a passo de renovação de sessão e encerramento com **exit code 5** (eliminando bloqueio de 120s no cron).
- **Dead Man's Switch / Heartbeat:** Integração nativa com monitores de uptime (Healthchecks.io, Uptime Kuma) via `HEARTBEAT_URL` e `HEARTBEAT_TIMEOUT_MS`. Envio de pings de início (`/start`), sucesso com relatório e falha (`/fail`), mascaramento seguro de tokens/UUIDs em logs e flags de controle CLI (`--heartbeat` / `--no-heartbeat`), prevenindo falhas silenciosas em servidores/VPS sem alterar códigos de saída.

### Modificado

- Otimização do loop de tarefas para classificar "Write reviews" como especial e evitar 4 tentativas sem pedido entregue.
- Isolamento estrito de `--json` direcionando logs operacionais para `stderr` (`pino.destination(2)`).
- Relatório de check-in reportando honestamente `N/D` quando o extrato de moedas do dia não puder ser extraído.

### Corrigido

- **Detecção e Resiliência de Streak (Sequência):** Suporte multilíngue abrangente (pt-BR, en-US, es-ES) com expressões regulares flexíveis ("Sequência de X dias", "X dias seguidos", "X-day streak", "Dia X/7"); captura do streak no modal pós-checkin antes do seu fechamento; fallback automático no desktop via contagem de datas consecutivas no histórico e mapeamento determinístico por tier de recompensa (+10 a +40 moedas), eliminando o falso `N/D`.
- **Execução Completa de Tarefas Multi-Rodadas (Explore Itens Surpresa e Super Descontos):**
  - **Re-query Dinâmico de Cards:** Em tarefas de itens surpresa, re-consulta dinâmica de elementos no DOM a cada clique e scroll incremental de cards, eliminando referências desanexadas (_stale element reference_) causadas por navegação `goBack()` e completando todas as rodadas (ex: 2/2).
  - **Permanência Real em SuperDeals/Descontos:** Remoção do corte prematuro aos 5s por detecção de tracking em `waitWithScroll`, garantindo tempo de permanência mínimo de 16 segundos com scroll gradual exigido pelo AliExpress para validar as rodadas (ex: 3/3).
  - **Resgate de Recompensas Intermediárias:** Suporte a botões de coleta (`Coletar`, `Collect`, `Claim`, `Receber`, `+5 moedas`), realizando o resgate imediato antes de prosseguir para a próxima rodada da tarefa.
  - **Reset de Tentativas por Progresso de Rodada:** Limpeza automática do contador de tentativas consecutivas da tarefa quando há avanço de rodadas, prevenindo o bloqueio prematuro por teto de `TASK_MAX_ATTEMPTS`.
  - **Sincronização Aprimorada pós-Tarefa:** Aumento do tempo de estabilização pós-retorno para 2500ms, permitindo que as animações de moedas e requisições AJAX do msite terminem de atualizar o DOM.
- **Auto-Cura de Skeleton e Resiliência na Abertura do Painel de Tarefas:**
  - **Correção da Sintaxe do Seletor (`openDrawerBtn`):** Eliminação de prefixos de engine inválidos (`text=...`) em listas separadas por vírgula que causavam erro de parse no Playwright e retorno silencioso de `null`. Inclusão de `#signButton` e classes dedicadas de tarefas (`.aecoin-taskButton-3V41b`, `[class*="taskButton"]`), com fallback semântico via `page.getByRole('button')`.
  - **Paciência na Hidratação e Reload Defensivo Único:** Auto-cura com aguardo paciente de hidratação pós-carregamento e no máximo um reload defensivo único, eliminando reloads em cascata concorrentes no meio das tentativas de clique que interrompiam a montagem do SPA do AliExpress.
  - **Navegação Móvel Direta:** Acesso direto à URL móvel com parâmetros imersivos (`_immersiveMode=true&from=pc302`) em `do_tasks.js`, eliminando conflitos de redirecionamento 302 que cancelavam o carregamento de scripts do SPA.
  - **Eliminação de Conflito em Modais:** Remoção do seletor de botão de tarefa (`.e2e_normal_task_right_btn`) de `SELECTORS.modals.closeButtons`, impedindo que `closeModals` interfira nas ações de tarefas.

---

## [0.7.0] - 2026-09-14

### Adicionado

- Orquestrador unificado (`all.js`) integrando check-in e tarefas em lote.
- Suporte a multi-contas sequencial (`ALI_USER_2`, `accounts.json`).
- Suporte à flag `--json` estruturada para pipelines e scripts.
- Tratamento resiliente de desafios de segurança e 2FA móvel.
- Permissões estritas 0o600 em todos os arquivos de segredos.
- Criptografia AES-256-GCM v2 com salt dinâmico.
