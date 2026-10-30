# Observabilidade, SLOs e Playbook

Documento operacional da automação `ali-coins`. Complementa os relatórios existentes
(`renderUnifiedReport` / `renderMultiAccountReport`) com métricas por execução e metas de
confiabilidade.

## 1. Perguntas que o plantão precisa responder

1. A execução diária rodou e terminou sem erro crítico?
2. Se falhou, foi sessão expirada, captcha/risco, 2FA, lock ou erro de código?
3. Quanto tempo o check-in e as tarefas levaram?
4. O streak caiu de verdade ou foi falha de leitura?
5. Quantas moedas foram creditadas e em quais contas?

Todo sinal abaixo existe para responder a uma dessas perguntas. Telemetria sem pergunta
é ruído.

## 2. Evento `run_metrics`

Ao final de cada execução (inclusive falhas), o runner emite um evento estruturado:

```json
{
  "event": "run_metrics",
  "schemaVersion": 1,
  "runId": "6f2d7a3e-1a7c-4f45-9f4a-1b2c3d4e5f60",
  "mode": "multi",
  "startedAt": "2026-10-30T09:30:00.000Z",
  "endedAt": "2026-10-30T09:34:12.000Z",
  "durationMs": 252000,
  "exitCode": 0,
  "accounts": [
    {
      "account": "us***@example.com",
      "index": 1,
      "checkin": {
        "outcome": "success",
        "durationMs": 120000,
        "streakBefore": 253,
        "streakAfter": 254,
        "longestStreak": 260,
        "coins": 40,
        "alreadyCollected": false,
        "reusedContext": false,
        "loginAttempted": false,
        "captcha": false,
        "errorClass": null
      },
      "tasks": {
        "outcome": "success",
        "durationMs": 90000,
        "coinsGained": 25,
        "tasksCount": 8,
        "errorClass": null
      },
      "streakBroken": false
    }
  ],
  "totals": {
    "accounts": 1,
    "checkin": { "success": 1, "already": 0, "blocked": 0, "error": 0, "skipped": 0 },
    "tasks": { "success": 1, "error": 0, "skipped": 0 },
    "streakBroken": 0,
    "coinsGained": 65
  }
}
```

O evento vem acompanhado de uma linha legível:

```
Métricas run=6f2d... modo=multi duração=4m12s contas=1 check-in=success:1 tarefas=success:1 streak-quebrado=0 moedas=65 saída=0
```

Regras de privacidade:

- `account` é sempre mascarada (`maskUser`);
- o evento usa allowlist e **nunca** inclui cookies, `storageState`, tokens, e-mails
  completos ou a mensagem crua de erros;
- `errorClass` é uma classe fechada (`captcha`, `captcha_cooldown`, `risk_control`,
  `manual_login`, `2fa`, `session_expired`, `lock_active`, `unknown`).

Códigos de saída relevantes: `0` sucesso, `2` já coletado sem nova ação, `3` lock ativo,
`4` streak quebrado, `5` 2FA não interativo, `6` crash, `7` intervenção manual.

## 3. SLIs e SLOs

| SLI                             | Definição                                                                                 | SLO          | Janela   |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------ | -------- |
| Execução diária concluída       | `exitCode` em `{0,2,4}` / total de execuções agendadas                                    | **≥ 99%**    | 30 dias  |
| Check-in dentro do prazo        | `accounts[].checkin.durationMs ≤ 600000` / check-ins executados                           | **≥ 95%**    | 30 dias  |
| Regressão de streak por leitura | execuções com queda de streak sem evidência (`streakBroken=true` e leitura não confiável) | **0**        | sempre   |
| Sessão válida na checagem       | `session_check.ok=true` / checagens                                                       | **≥ 99%**    | 30 dias  |
| Captcha persistente             | dias consecutivos com `errorClass` em `{captcha, captcha_cooldown, risk_control}`         | **≤ 2 dias** | contínuo |

Metas de latência são um guardrail operacional, não uma promessa de produto. Ajuste o
limite de 10 minutos com dados reais da VPS antes de criar alerta page-worthy.

### Orçamento de erro

- SLO 99% em 30 dias ⇒ orçamento de **1%** (≈ 7,2 h de indisponibilidade equivalente).
- Consumiu 50%: priorizar correções de confiabilidade sobre novas features.
- Consumiu 100%: congelar mudanças não críticas até restaurar o orçamento.

## 4. Alertas recomendados

Alertas devem ser sintoma (usuário/negócio), não causa. Todos precisam de link para este
playbook.

| Alerta              | Condição                                                 | Severidade  | Ação inicial                                  |
| ------------------- | -------------------------------------------------------- | ----------- | --------------------------------------------- |
| `CronRunMissed`     | nenhum evento `run_metrics`/heartbeat em 26 h            | page        | verificar cron, container e locks             |
| `DailyRunFailed`    | 2 execuções consecutivas com `exitCode` em `{1,5,6,7}`   | page        | abrir playbook de sessão/captcha              |
| `SessionExpired`    | `session.check.invalid` ou `exitCode=7`                  | ticket/page | renovar/importar sessão                       |
| `StreakBroken`      | `exitCode=4` ou `accounts[].streakBroken=true`           | ticket      | confirmar leitura e extrato antes de avisar   |
| `CheckinSlow`       | `checkin.durationMs > 600000` em 2 execuções             | ticket      | medir VPS/rede, não aumentar timeout às cegas |
| `CaptchaPersistent` | 3 dias seguidos com `errorClass=captcha*`/`risk_control` | page        | login manual + import; avaliar IP             |

Consultas úteis (logs JSON):

```bash
# últimas métricas
jq -c 'select(.event=="run_metrics")' ali-coins.log | tail -5

# falhas por classe
jq -r 'select(.event=="run_metrics") | .accounts[] | .checkin.errorClass // empty' ali-coins.log |
  sort | uniq -c

# duração do check-in por conta
jq -r 'select(.event=="run_metrics") | .accounts[] | "\(.account) \(.checkin.durationMs)"' ali-coins.log
```

## 5. Playbook de incidentes

### 5.1 Cron não rodou (`CronRunMissed`)

1. Confirme o heartbeat do dead man's switch e o horário do cron (`09:30 UTC`).
2. Verifique `systemctl status cron`, logs do host e espaço em disco.
3. Procure lock órfão: `ali-coins*.lock`; confirme se o PID ainda existe **antes** de
   remover.
4. Rode manualmente `./run_all.sh --no-delay` (ou `npm start`) e acompanhe `run_metrics`.
5. Se o host estiver sem memória, verifique `dmesg`/OOM e reduza concorrência.

### 5.2 Sessão expirada (`SessionExpired`)

1. Rode `node all.js --check-session --json` e confirme `ok=false` + motivo.
2. Se o cookie estiver expirado, gere sessão nova no host local com
   `node export_session.js` e importe com `node import_session.js`.
3. Nunca cole cookies/tokens em issue, chat ou log. Use apenas os arquivos locais.
4. Revalide com `--check-session` antes de reativar o cron.

### 5.3 Streak quebrado (`StreakBroken`)

1. **Não** assuma quebra real: confira `trustDetected`, `statementStreakDays` e o extrato
   desktop do dia.
2. Compare `previousStreakDays` e `streakDays` no relatório/`session_meta.json`.
3. Se a leitura dinâmica for suspeita, aguarde a próxima execução e valide o calendário
   mobile antes de comunicar perda.
4. Se a quebra for real, registre a data e o valor para reconciliação manual.

### 5.4 Captcha/risco persistente (`CaptchaPersistent`)

1. Verifique `errorClass` e `cooldownUntil` no `session_meta.json` da conta.
2. Pare tentativas automáticas: insistir escala o risco.
3. Faça login manual em janela visível no host local, resolva o desafio e importe a
   sessão.
4. Se o IP estiver marcado, avalie trocar a saída de rede antes de retomar.
5. Só remova o cooldown com `--force` quando houver confirmação humana.

### 5.5 Check-in lento (`CheckinSlow`)

1. Compare `checkin.durationMs` com a baseline e verifique CPU/RAM da VPS.
2. Confira se o contexto desktop está sendo reutilizado (`reusedContext`).
3. Não aumente timeouts sem identificar se o gargalo é rede, seletor ou memória.
4. Registre a medição antes/depois de qualquer ajuste.

## 6. Verificação da telemetria

- Rode uma execução controlada e procure o evento `run_metrics` pelo `runId`.
- Confirme que `account` está mascarada e que não há cookies/tokens no JSON.
- Force uma falha de sessão e valide `errorClass=session_expired` e `exitCode=7`.
- Force uma quebra de leitura e valide `streakBroken=true` apenas com leitura confiável.
- Confirme que o alerta aponta para este documento e para o comando de diagnóstico.
