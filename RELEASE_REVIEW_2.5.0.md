# Pre-release Review — 2.5.0

Revisão somente leitura executada em 2026-10-30, antes do commit/tags locais.

## Escopo

- Base: tag `2.4.0` (`84c51a7e17144f9ca2a31a23f19cdbd2903ae913`)
- Head revisado: `d0ea829554373d184e2c1f16938d83d4dec25047`
- Mudanças: frentes de endurecimento 2.5.0 em código/testes/docs (detalhes no
  `CHANGELOG.md`); commit de release e tags `2.5.0`/`v2.5.0` são criados depois desta
  revisão.
- Worktree: apenas `CHANGELOG.md`, `RELEASING.md`, `package.json` e `package-lock.json`
  do próprio release; serão incluídos no commit `chore(release): 2.5.0`.

## Conclusão

**NO_BLOCKER_FOUND** para release local. Não há migração de banco, mudança de infraestrutura
ou segredo novo. A publicação remota continua fora de escopo e depende de autorização.

## Verificações

| Área         | Evidência                                                                              |
| ------------ | -------------------------------------------------------------------------------------- |
| Versão       | `package.json` e raiz do `package-lock.json` em `2.5.0`; `npm ci --dry-run` OK         |
| Changelog    | seção `## [2.5.0] - 2026-10-30`; `[Unreleased]` vazio                                  |
| Testes       | `npm test`: 561/561                                                                    |
| Cobertura    | `npm run test:coverage`: 88,03% linhas (limite 80%)                                    |
| Lint/format  | ESLint e Prettier verdes                                                               |
| Dependências | `npm audit --omit=dev`: 0 vulnerabilidades                                             |
| Scripts      | ShellCheck OK; actionlint 1.7.12 OK; YAML dos workflows válido                         |
| Segredos     | nenhum `credentials.env`, sessão, token ou chave rastreado no git                      |
| Contrato     | exit codes `0–7`, tokens `v1/v2/v3`, formato de sessão e campos existentes preservados |

## Itens de confirmação (P2)

- O CI remoto (matriz Ubuntu/Windows/macOS, Docker, CodeQL, Gitleaks) ainda não foi
  executado porque o trabalho permanece local. As validações equivalentes disponíveis
  neste host passaram; a matriz real roda somente após push autorizado.
- `pwsh` não está instalado neste host; a validação de sintaxe PowerShell será executada
  no runner `windows-latest` pelo workflow.

## Rollback

1. Antes do push: `git reset --hard d0ea829` (ou reverter o commit de release) e remover
   as tags locais `2.5.0`/`v2.5.0`.
2. Depois de um push autorizado: reverter o commit de release e recriar tags apenas com
   autorização do mantenedor; nunca mover tags publicadas sem alinhamento.
3. Não há migração de dados; rollback é apenas código/artefato.

## Ordem de deploy

Não aplicável a múltiplos serviços. É uma CLI/cron de execução diária; a atualização pode
ser feita por substituição do checkout e `npm ci`, mantendo `credentials.env` e sessões
locais fora do repositório.
