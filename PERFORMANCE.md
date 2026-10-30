# Performance e Memória

Documento da Frente 6 (2.5.0). Números medidos em 2026-10-30, Node `v22.23.3`,
Linux x64. São uma baseline do host de desenvolvimento — reexecute `npm run bench` no
host de produção antes de tirar conclusões.

## 1. Como reproduzir

```bash
npm run bench        # tabela legível
npm run bench -- --json
```

O benchmark mede processos separados (cold start), para não reaproveitar o `require
cache` entre módulos, e usa apenas payload sintético — nunca lê `credentials.env` ou
sessões reais.

## 2. Boot e memória

### Antes da otimização

`libs/report.js` importava `libs/ui/balance.js`, que importa o Playwright. O mesmo
acontecia com `libs/runner/multi.js` via `libs/ui`. Resultado: `all.js --help` e
`--dry-run` pagavam o custo do navegador sem abrir navegador.

| Comando                  | Mediana | RSS máximo |
| ------------------------ | ------: | ---------: |
| `node all.js --help`     | ~260 ms |    ~149 MB |
| `node collect.js --help` | ~260 ms |    ~149 MB |
| `require('./all')`       | ~173 ms |    ~146 MB |

### Depois da otimização

- `libs/checkin/coins.js`: mapeamento de moedas/streak sem Playwright; `report.js` deixou
  de depender de `ui/balance`.
- `libs/checkin/login-signals.js`: detecção de gate/prompt sem Playwright.
- `libs/ui/desktop-cache.js`: cache de contexto desktop sem carregar a UI inteira.
- `collect.js` carrega `libs/runner/single.js` (e o Playwright) somente quando o
  check-in realmente vai executar; `--help`, `--dry-run` e `--check-session` não pagam
  esse custo.
- `libs/checkin/captcha.js`: wrapper de cooldown sem carregar o runner.

| Comando                           | Mediana | RSS máximo |
| --------------------------------- | ------: | ---------: |
| `node all.js --help`              | ~135 ms |     ~80 MB |
| `node collect.js --help`          | ~134 ms |     ~80 MB |
| `require('./all')`                | ~117 ms |     ~78 MB |
| `require('./collect')`            | ~113 ms |     ~78 MB |
| `require('./libs/report')`        | ~127 ms |     ~78 MB |
| `require('./libs/runner/single')` | ~282 ms |    ~146 MB |

Ganho observado: **~48% menos RSS** e **~48% menos tempo de boot** em `--help`/dry-run.
`libs/runner/single.js` continua carregando o Playwright por design — ele é o módulo que
executa o navegador de verdade.

> **Escopo das medições:** boot, memória de importação e scrypt são medidos aqui sem
> Chromium. Login, check-in, tarefas e fechamento completos exigem uma execução real com
> navegador; o evento `run_metrics` já registra `checkin.durationMs`/`tasks.durationMs`
> por conta. Use uma execução controlada na VPS para a baseline desses quatro estágios e
> compare com o benchmark de boot antes/depois.

## 3. Custo do scrypt

Payload sintético com 20 cookies; tempos de uma execução:

| Parâmetro                            | Encrypt | Decrypt | Pico RSS (`/usr/bin/time`) |
| ------------------------------------ | ------: | ------: | -------------------------: |
| `N=131072` (default em host folgado) | ~188 ms | ~170 ms |                    ~197 MB |
| `N=32768` (host ≤1.5 GB / cgroup)    |  ~50 ms |  ~41 ms |                    ~100 MB |

Decisões:

- **Sem cache de chave derivada.** O scrypt roda poucas vezes por execução e dura dezenas
  a poucas centenas de ms; manter chaves derivadas em memória por mais tempo aumenta a
  superfície de exposição sem ganho relevante frente ao custo do Chromium.
- **Sem reduzir o piso de segurança.** O default `N=131072` é usado quando há memória;
  em hosts/cgroups ≤1.5 GB o código já reduz para `N=32768` automaticamente, ainda acima
  do piso criptográfico `N=16384`.
- `SCRYPT_N` explícito continua respeitado, com piso e teto defensivos.

## 4. Contexto mobile/desktop e SPA

- O check-in preserva a página/contexto mobile (`keepPage`/`onMobilePageKept`) e as
  tarefas reutilizam esse handle, evitando recarregar o SPA do coin-index.
- O reúso do contexto desktop (`DESKTOP_REUSE_CONTEXT=true`) fica **desligado por
  padrão**: manter mobile + desktop concorrentes eleva o pico de RAM/PIDs em hosts
  restritos. O ganho de tempo (~18 s por leitura) só compensa quando há folga.
- O runner fecha o contexto desktop cacheado ao fim de cada conta para não reter cookies
  de uma conta enquanto a próxima executa.

## 5. Orçamento de memória

Valores práticos para o fluxo unificado (check-in + tarefas + Chromium headless shell):

| Limite do container/host |             Heap Node | Recomendação                                               |
| ------------------------ | --------------------: | ---------------------------------------------------------- |
| 256 MB                   | 256 MB (`Dockerfile`) | **não** executar Chromium; usar apenas dry-run/healthcheck |
| 768 MB                   |                256 MB | fluxo unificado com `DESKTOP_REUSE_CONTEXT` desligado      |
| 1 GB                     |    384 MB (`run*.sh`) | fluxo unificado; reúso desktop opcional                    |
| ≥2 GB                    |    512 MB (`run*.sh`) | reúso desktop pode ser habilitado                          |

O `Dockerfile` fixa `NODE_OPTIONS=--max-old-space-size=256` e instala apenas o
`chrome-headless-shell`; os scripts de host detectam RAM e sobem para 384/512 MB, com
`ALI_HEAP_MB`/`NODE_OPTIONS` explícitos tendo precedência.

## 6. Guardrails

- `tests/performance_budget.test.js` falha se `all.js`, `collect.js` ou `libs/report`
  voltarem a carregar Playwright no boot.
- `npm run bench` deve ser rodado antes/depois de mudanças em imports de topo,
  configuração de contexto ou parâmetros de criptografia.
- Use `run_metrics` (`checkin.durationMs`/`tasks.durationMs`) para acompanhar regressões
  em produção; não aumente timeouts sem medir a causa.
