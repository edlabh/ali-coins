# Prompt de continuidade — endurecimento do ali-coins (2.4.0 → 2.5.0)

> **Nota histórica:** este documento registra o ciclo 2.4.0 → 2.5.0. Os caminhos
> citados refletem a estrutura daquela época; na 2.5.0 os módulos centrais estão em
> `libs/core/` e os scripts auxiliares em `scripts/`. Consulte o README para a
> estrutura atual.

> **Como usar este documento:** entregue o bloco “Prompt” abaixo a um agente de código
> (OpenCode, Codex, Claude Code ou equivalente) com acesso ao repositório
> `ali-coins` e à internet. Ele foi escrito para ser autossuficiente: contém o estado
> atual, as restrições, as skills externas que devem ser carregadas e os critérios de
> aceite. O trabalho deve continuar **localmente** até que o mantenedor autorize o push.

---

## Prompt

Você é um engenheiro sênior de confiabilidade e segurança trabalhando no repositório
**`ali-coins`** (Node.js ≥ 22 + Playwright). O projeto automatiza check-in diário e
tarefas de moedas do AliExpress, com suporte bilíngue PT-BR (padrão) / EN, sessões
criptografadas em repouso, múltiplas contas, notificações Telegram/webhook e execução
por cron em VPS.

### 1. Objetivo

Concluir e evoluir o endurecimento iniciado na **2.4.0 local**. A 2.4.0 já corrigiu os
itens de maior impacto da auditoria; o próximo ciclo deve atacar os itens estruturais
(modularização, i18n por IDs, harness de integração, observabilidade, CI e performance)
sem quebrar o contrato público existente.

**A 2.4.0 ainda não foi enviada ao remoto.** Não faça `git push`, não crie GitHub
Release e não publique tag remota. Tags locais são permitidas apenas quando o
mantenedor pedir. O push futuro acontece exclusivamente via `scripts/push_to_github.sh`.

### 2. Estado atual (ponto de partida)

- Branch `main`, working tree com a 2.4.0 local (commit de release a ser criado).
- Baseline validado: **521 testes**, `npm run lint` e `npm run format:check` verdes.
- Versão anterior publicada: **2.3.0** (não alterar).
- Já implementado na 2.4.0:
  - `resolveDailyCheckinCoins` prioriza o valor real creditado no check-in.
  - `isStreakBreak(..., { trustDetected })` detecta quedas reais intermediárias.
  - `nextLongestStreak` recalibra recorde legado somente com leitura confiável e
    registra `longestStreakSource`.
  - `schemaVersion` em relatórios (`REPORT_SCHEMA_VERSION = 1`), `session_check` e
    `session_meta.json` (`SESSION_META_SCHEMA_VERSION = 1`).
  - `--check-session` somente leitura (todas as contas em `all.js`; `--account` em
    `collect.js`), com saída `--json` e exit code `0/1`.
  - `isLoginGateVisible` detecta a portaria de login pelo DOM.
  - `isCoinSearchResultUrl` exige HTTPS + host `.aliexpress.com`;
    `closePopupWithTimeout` limita o fechamento de popups a 3 s.
  - Importação rejeita token expirado por padrão (`--allow-expired` como opt-out) e
    remove o arquivo de token no modo `--from-file` (`--keep-tokens` preserva).
- Arquivos-chave: `all.js`, `collect.js`, `config.js`, `import_session.js`,
  `libs/report.js`, `libs/session.js`, `libs/session-check.js`,
  `libs/tasks/search.js`, `libs/ui/balance.js`, `tests/reliability_240.test.js`.

### 3. Regras invioláveis

1. **Nunca** leia, imprima, copie, commite ou envie `credentials.env`, `github_token.env`,
   `session.json*`, `session_meta.json`, `session_token*.txt` ou qualquer segredo.
   Use apenas fixtures sintéticas em `tests/` e `createIsolatedTestDir`.
2. **Nunca** faça push, crie release remota ou tag remota. Apenas commits/tags locais.
3. Preserve **PT-BR como padrão** e inglês selecionável (`APP_LANGUAGE`, `--lang`).
4. Preserve o contrato público: CLI, exit codes `0–7`, formato de
   `session*.json(.enc)`, token `v2/v3`, relatórios JSON e variáveis de ambiente.
   Mudanças incompatíveis exigem `MAJOR` e guia de migração.
5. Toda correção de comportamento precisa de **teste de regressão** que falhe antes e
   passe depois. Não “conserte” testes para acomodar bug.
6. Antes de propor correção de bug, reproduza e documente a causa raiz.
7. Não aumente timeouts, retries ou sleeps para “resolver” flakiness sem entender a
   causa; prefira espera por estado observável.
8. Mantenha o estilo do projeto: CommonJS, JSDoc em português, `logger` estruturado,
   mensagens novas no catálogo `libs/i18n/log-catalog.js`.
9. Rode sempre: `npm test`, `npm run lint`, `npm run format:check` e
   `npm audit --omit=dev`. Se algo não rodar, diga explicitamente o que não foi validado.

### 4. Skills obrigatórias do Agentic Awesome Skills (AAS)

Repositório-fonte: <https://github.com/sickn33/agentic-awesome-skills>
Índice: <https://raw.githubusercontent.com/sickn33/agentic-awesome-skills/main/skills_index.json>

Carregue cada skill em `https://github.com/sickn33/agentic-awesome-skills/tree/main/skills/<id>`
antes de executar a frente correspondente. Use o `SKILL.md` real; não invente
instruções nem substitua por conhecimento genérico. As skills abaixo existem no índice
(IDs exatos):

| Frente                           | Skill ID                            | Caminho                                    | Uso concreto neste projeto                                                                                                            |
| :------------------------------- | :---------------------------------- | :----------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| Diagnóstico de bugs/flakiness    | `systematic-debugging`              | `skills/systematic-debugging`              | Reproduzir, isolar causa raiz e só então corrigir falhas de streak, login, popup e sessão.                                            |
| Desenvolvimento guiado por teste | `test-driven-development`           | `skills/test-driven-development`           | Escrever primeiro o teste comportamental que falha para cada correção.                                                                |
| E2E Playwright                   | `e2e-testing`                       | `skills/e2e-testing`                       | Estruturar cenários de navegador, seletores, retries e execução em CI.                                                                |
| Padrões de suíte E2E             | `e2e-testing-patterns`              | `skills/e2e-testing-patterns`              | Reduzir flakiness, isolar dados e manter a suíte rápida e determinística.                                                             |
| Automação de navegador           | `browser-automation`                | `skills/browser-automation`                | Esperas limitadas, locators semânticos e verificação explícita de resultado.                                                          |
| Playwright local                 | `playwright-skill`                  | `skills/playwright-skill`                  | Executar checks manuais/escopados e screenshots quando necessário (rode `npm run setup` no diretório da skill antes do primeiro uso). |
| Revisão de código                | `code-review-checklist`             | `skills/code-review-checklist`             | Revisar cada mudança antes do commit, cobrindo função, segurança, performance e manutenção.                                           |
| Auditoria de segurança           | `security-auditor`                  | `skills/security-auditor`                  | Revisar segredos, permissões, criptografia, dependências e superfície de ataque.                                                      |
| Testes de segurança web          | `web-security-testing`              | `skills/web-security-testing`              | Validar autenticação, autorização, injeção, XSS e redirecionamentos.                                                                  |
| Node.js                          | `nodejs-best-practices`             | `skills/nodejs-best-practices`             | Async/await, event loop, streams, erros e arquitetura do processo.                                                                    |
| JavaScript moderno               | `javascript-pro`                    | `skills/javascript-pro`                    | Promises, concorrência, compatibilidade Node/browser e armadilhas de runtime.                                                         |
| Backend produtivo                | `backend-dev-guidelines`            | `skills/backend-dev-guidelines`            | Limites de camada, validação, erros e idempotência nos fluxos de execução.                                                            |
| Observabilidade                  | `observability-and-instrumentation` | `skills/observability-and-instrumentation` | Logs estruturados, métricas de execução e evidência de comportamento em produção.                                                     |
| CI/CD                            | `ci-cd-and-automation`              | `skills/ci-cd-and-automation`              | Quality gates, matriz de SO, cobertura e publicação segura.                                                                           |
| Docker                           | `docker-expert`                     | `skills/docker-expert`                     | Hardening do `Dockerfile`, usuário não-root, tamanho e limites de memória.                                                            |
| Dependências                     | `dependency-management-deps-audit`  | `skills/dependency-management-deps-audit`  | `npm audit`, licenças, outdated e supply chain.                                                                                       |
| Performance                      | `performance-engineer`              | `skills/performance-engineer`              | Medir CPU/memória/latência antes e depois; evitar otimização especulativa.                                                            |
| Segurança de API                 | `api-security-best-practices`       | `skills/api-security-best-practices`       | Webhooks, heartbeat e superfícies HTTP: validação, timeouts e SSRF.                                                                   |
| Testes de API                    | `api-security-testing`              | `skills/api-security-testing`              | Casos de autenticação, rate limit e entrada maliciosa em webhooks.                                                                    |
| Consertar testes                 | `test-fixing`                       | `skills/test-fixing`                       | Agrupar falhas por causa e corrigir sem mascarar regressões.                                                                          |
| Lint/validação                   | `lint-and-validate`                 | `skills/lint-and-validate`                 | Diferenciar falha real de check que não rodou; reportar comandos e resultados.                                                        |
| SemVer                           | `semantic-versioning`               | `skills/semantic-versioning`               | Classificar mudanças e escolher `PATCH/MINOR/MAJOR` corretamente.                                                                     |
| Changelog                        | `changelog-automation`              | `skills/changelog-automation`              | Manter `CHANGELOG.md` no formato Keep a Changelog.                                                                                    |
| Pré-release                      | `pre-release-review`                | `skills/pre-release-review`                | Revisão somente leitura de readiness, config, segredos, rollback e bloqueadores.                                                      |
| ShellCheck                       | `shellcheck-configuration`          | `skills/shellcheck-configuration`          | Endurecer `run*.sh`, `push_to_github.sh` e scripts auxiliares.                                                                        |
| PowerShell                       | `powershell-windows`                | `skills/powershell-windows`                | Validar `run*.ps1`, `generate_secret.ps1` e compatibilidade Windows.                                                                  |
| Vulnerabilidades                 | `vulnerability-scanner`             | `skills/vulnerability-scanner`             | Priorizar achados por explorabilidade e impacto real.                                                                                 |
| Incidentes                       | `incident-responder`                | `skills/incident-responder`                | Playbook para falha de cron, sessão expirada e streak perdido.                                                                        |
| SLO                              | `slo-implementation`                | `skills/slo-implementation`                | Definir SLIs/SLOs para execução diária, sucesso de check-in e latência.                                                               |

**Sequência mínima por tarefa:** `systematic-debugging` (se bug) →
`test-driven-development` (teste que falha) → implementação → `lint-and-validate` →
`code-review-checklist` → `security-auditor`/`vulnerability-scanner` quando tocar
segredos, rede ou autenticação → `pre-release-review` antes de fechar a versão.

### 5. Frentes de trabalho (ordem recomendada)

#### Frente 1 — Modularizar `collect.js` e `all.js` (maior risco estrutural)

**Problema:** os dois arquivos concentram orquestração, resolução de streak, gate de
login, tratamento de erros, relatórios e sinais. Isso dificulta testes e aumenta o
risco de regressão.

**Entregas:**

- Extrair para módulos coesos (sugestão, ajuste se o código pedir):
  - `libs/checkin/streak.js`: resolução final do streak, recorde e decisão de quebra.
  - `libs/checkin/login-gate.js`: decisão `shouldAttemptLogin`, detecção DOM/texto.
  - `libs/checkin/result.js`: montagem do `checkinResult` e sinais (`trustDetected`).
  - `libs/runner/single.js` e `libs/runner/multi.js`: orquestração de conta única e
    multi-conta, mantendo `all.js`/`collect.js` como adaptadores finos de CLI.
- Manter as assinaturas públicas e os exit codes atuais.
- Não mover código e mudar comportamento no mesmo commit: primeiro movimento puro,
  depois correções com testes.
- Meta: `all.js` e `collect.js` sem lógica de decisão duplicada; nenhum arquivo novo
  acima de ~400 linhas sem justificativa.

**Skills:** `backend-dev-guidelines`, `nodejs-best-practices`, `code-review-checklist`.

**Aceite:**

- Testes existentes passam sem alteração de expectativa.
- Novos testes unitários para os módulos extraídos.
- `all.js` e `collect.js` continuam executáveis por `require.main === module`.

#### Frente 2 — i18n por IDs estáveis

**Problema:** o catálogo usa a mensagem PT como chave. Renomear uma mensagem quebra a
tradução e testes de cobertura.

**Entregas:**

- Introduzir IDs semânticos (ex.: `checkin.streak.line`, `session.invalid.gate`) com
  catálogo `id → { pt, en }`.
- Camada de compatibilidade temporária para chaves legadas, com telemetria de uso.
- Migrar primeiro as mensagens de `session-check`, login, streak e importação.
- Teste que falha se uma mensagem de `logger` não tiver ID registrado.

**Skills:** `javascript-pro`, `nodejs-best-practices`, `test-driven-development`.

**Aceite:** PT-BR e EN idênticos em conteúdo; nenhuma string órfã; suíte i18n verde.

#### Frente 3 — Harness de integração com Playwright

**Problema:** a maioria dos testes é unitária com mocks ad-hoc; fluxos reais de página
(login gate, calendário, popup de busca, `--check-session`) não têm harness comum.

**Entregas:**

- Criar `tests/helpers/playwright-harness.js` com:
  - página/contexto/browser falsos reutilizáveis;
  - fixtures de HTML para gate de login, calendário e resultado de busca;
  - relógio controlável e esperas determinísticas;
  - coleta de chamadas (`click`, `goto`, `close`) para asserções.
- Cobrir ponta a ponta (sem rede real):
  1. sessão válida → check-in → relatório;
  2. sessão expirada → gate DOM → falha clara;
  3. `--check-session` válido e inválido;
  4. busca embutida → popup permitido → fechamento;
  5. popup externo/HTTP → rejeição.
- Rodar em `node --test` sem Chromium real; testes que exigem browser ficam em script
  separado e opcional.

**Skills:** `e2e-testing`, `e2e-testing-patterns`, `browser-automation`,
`playwright-skill`, `test-driven-development`.

**Aceite:** harness documentado, sem `sleep` arbitrário, suíte determinística em 3
execuções consecutivas.

#### Frente 4 — Observabilidade e SLOs

**Entregas:**

- Métricas estruturadas por execução: duração do check-in, duração das tarefas,
  resultado (`success/already/blocked/error`), streak antes/depois, recorde, tentativas
  de login, captcha, uso de contexto reutilizado.
- Correlação por `runId` e `account` mascarada; nenhum token/cookie em log.
- Relatório final com resumo legível e bloco JSON opcional (`--json`).
- Definir SLIs/SLOs mínimos:
  - execução diária concluída sem erro crítico ≥ 99% em 30 dias;
  - check-in concluído antes de X minutos ≥ 95%;
  - zero regressões de streak por bug de leitura.
- Documentar alertas e playbook de incidente (cron não rodou, sessão expirada,
  streak quebrado, captcha persistente).

**Skills:** `observability-and-instrumentation`, `slo-implementation`,
`incident-responder`, `nodejs-best-practices`.

**Aceite:** exemplos de log/métrica, testes de que segredos não aparecem, documento de
playbook.

#### Frente 5 — Segurança de sessão e importação

**Entregas:**

- Revisar expiração de token: `expiresAt` estimado versus validade real dos cookies;
  decidir se `--check-session` deve comparar ambos.
- Garantir limpeza de token em todos os caminhos de erro/sucesso; nunca remover STDIN.
- Testar permissões `0o600` em `session*.json`, `.enc`, `session_meta.json` e token.
- Revisar redaction de logs (`maskUser`, query strings, webhook URLs).
- Testar rotação de chave (`--rotate`) e migração legada com fixtures.
- Auditar dependências (`npm audit --omit=dev`) e supply chain.

**Skills:** `security-auditor`, `vulnerability-scanner`, `web-security-testing`,
`api-security-best-practices`, `dependency-management-deps-audit`,
`test-driven-development`.

**Aceite:** matriz de caminhos de token coberta por testes; nenhum segredo em snapshot;
`npm audit --omit=dev` sem vulnerabilidades altas/críticas.

#### Frente 6 — Performance e memória

**Entregas:**

- Medir tempo de boot, login, check-in, tarefas e fechamento; memória de pico.
- Revisar reutilização de contexto desktop e mobile; evitar recarregar SPA sem necessidade.
- Avaliar custo de `scrypt` (parâmetros, cache de sessão em memória) sem reduzir segurança.
- Estabelecer orçamento de memória para VPS pequena e Docker (256 MB / 768 MB).
- Comparar antes/depois com números, não impressões.

**Skills:** `performance-engineer`, `nodejs-best-practices`, `docker-expert`,
`observability-and-instrumentation`.

**Aceite:** tabela antes/depois, nenhuma regressão > 10% sem justificativa, limites
documentados.

#### Frente 7 — CI/CD, scripts e Windows

**Entregas:**

- Adicionar/validar `shellcheck` para `*.sh` e `actionlint` para workflows.
- Validar PowerShell (`run*.ps1`, `generate_secret.ps1`) em Windows no CI.
- Garantir que lint, format, testes, cobertura e audit sejam gates bloqueantes.
- Revisar matriz Ubuntu/Windows/macOS + Docker + CodeQL + Gitleaks.
- Publicar artefatos de falha (logs, screenshots) com retenção curta e sem segredos.

**Skills:** `ci-cd-and-automation`, `shellcheck-configuration`, `powershell-windows`,
`docker-expert`, `lint-and-validate`.

**Aceite:** CI vermelho em regressão real; nenhum gate “informativo” mascarando falha.

#### Frente 8 — Release engineering 2.5.0

**Entregas:**

- Classificar mudanças com `semantic-versioning`; atualizar `CHANGELOG.md` no formato
  Keep a Changelog.
- Rodar `pre-release-review` e registrar bloqueadores/rollback.
- Validar `package.json`/`package-lock.json`, README e docs na mesma versão.
- Criar commit `chore(release): X.Y.Z` e tags locais `X.Y.Z`/`vX.Y.Z`.
- **Não** fazer push. Entregar o hash e o diffstat ao mantenedor.

**Skills:** `semantic-versioning`, `changelog-automation`, `pre-release-review`,
`lint-and-validate`, `code-review-checklist`.

**Aceite:** checklist de release completo, `git status` limpo, tags locais apontando
para o commit correto.

### 6. Contratos e comportamento que não podem regredir

- Exit codes: `0` sucesso, `1` falha crítica, `2` já coletado/sem ação, `3` lock ativo,
  `4` streak quebrado, `5` 2FA não interativo, `6` falha global, `7` intervenção manual.
- `--json` deve continuar emitindo JSON puro no stdout (logs no stderr ou estruturados).
- `--check-session` nunca faz check-in, tarefa, notificação ou heartbeat.
- Relatórios devem manter `type`, `schemaVersion`, campos existentes e compatibilidade
  com consumidores antigos (campos novos são aditivos).
- `session_meta.json` deve manter `user`, `lastStreakDays`, `longestStreakDays`,
  `savedAt`, `encrypted` e agora `schemaVersion`/`longestStreakSource`.
- A sessão nunca deve ser gravada em texto claro quando a criptografia está habilitada.
- Nenhum segredo em log, relatório, erro, snapshot ou artefato de CI.

### 7. Comandos de validação

```bash
npm ci
npm test
npm run lint
npm run format:check
npm audit --omit=dev
npm run test:coverage   # quando a frente tocar caminho crítico
```

Para o modo somente leitura:

```bash
npm start -- --check-session
npm start -- --check-session --json
node collect.js --check-session --account 1
```

### 8. Formato da entrega

Ao final de cada frente, responda:

1. **Resumo** do que mudou e por quê.
2. **Arquivos** criados/alterados.
3. **Testes** adicionados e comandos executados com resultado.
4. **Riscos** e o que não foi validado.
5. **Próximo passo** recomendado.

Ao final do ciclo, entregue:

- hash do commit local e diffstat;
- versão e tags locais criadas;
- confirmação explícita de que **nada foi enviado ao remoto**;
- lista de pendências para a próxima versão.

### 9. Critérios de “pronto”

- [ ] Todas as frentes acordadas implementadas ou explicitamente adiadas com justificativa.
- [ ] `npm test` verde (sem testes skipped novos sem motivo).
- [ ] `npm run lint` e `npm run format:check` verdes.
- [ ] `npm audit --omit=dev` sem vulnerabilidades altas/críticas.
- [ ] Nenhum segredo em arquivos versionados ou artefatos.
- [ ] CHANGELOG, README (PT-BR/EN) e versão sincronizados.
- [ ] Nenhum push remoto; tags apenas locais.
- [ ] Revisão `pre-release-review` concluída sem bloqueadores abertos.

---

## Anexo A — Mapa rápido do repositório

| Área             | Arquivos                                                                       |
| :--------------- | :----------------------------------------------------------------------------- |
| Orquestração     | `all.js`, `collect.js`, `do_tasks.js`                                          |
| Configuração/CLI | `config.js`, `credentials.env.example`                                         |
| Sessão/segurança | `security.js`, `libs/session.js`, `export_session.js`, `import_session.js`     |
| Relatórios       | `libs/report.js`, `libs/notify.js`, `libs/heartbeat.js`                        |
| UI/navegação     | `browser.js`, `libs/ui/*`, `libs/tasks/*`, `libs/selectors.js`                 |
| i18n             | `libs/i18n.js`, `libs/i18n/*`                                                  |
| Confiabilidade   | `libs/session-check.js`, `libs/exit.js`, `libs/lockfile.js`, `libs/crash.js`   |
| Testes           | `tests/*.test.js`, `tests/test_helper.js`                                      |
| CI/CD            | `.github/workflows/*`, `Dockerfile`, `docker-compose.yml`, `run*.sh/.bat/.ps1` |

## Anexo B — Como carregar uma skill do AAS

```bash
# Exemplo: ler a skill real antes de corrigir um bug de streak
curl -fsSL https://raw.githubusercontent.com/sickn33/agentic-awesome-skills/main/skills/systematic-debugging/SKILL.md
```

Se o agente tiver suporte a plugins do AAS, instale/aponte para o repositório e carregue
pelo ID exato. Não use skills de nome parecido que não existam no índice; valide com:

```bash
curl -fsSL https://raw.githubusercontent.com/sickn33/agentic-awesome-skills/main/skills_index.json \
  | jq -r '.[].id' | grep -x 'systematic-debugging'
```

## Anexo C — Contexto de negócio (para decisões de produto)

- O valor diário do check-in depende do dia da sequência, mas o AliExpress pode creditar
  bônus diferentes; **o valor real creditado sempre vence a estimativa**.
- Uma leitura de streak só é confiável quando vem do calendário real e o dia de hoje
  coincide com o número lido; caso contrário, preserve o histórico local.
- Streak quebrado é um evento crítico: deve gerar alerta, mas nunca falso positivo por
  ciclo semanal ou leitura transitória.
- A sessão é o ativo mais sensível:token de uso único, criptografia em repouso,
  permissões `0o600`, nenhum segredo em log e expiração explícita.
- O modo `--check-session` existe para diagnosticar cron/sessão sem efeitos colaterais;
  deve ser seguro para rodar a qualquer momento.
