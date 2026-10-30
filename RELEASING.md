# Guia de Releases

> 🌐 **Idiomas:** Português | [English](RELEASING.en.md)

Este documento descreve o processo de release do `ali-coins`, incluindo a automação de
GitHub Releases e o fluxo do ciclo atual **2.x**.

## Versionamento

- O projeto segue [SemVer](https://semver.org/lang/pt-BR/): `MAJOR.MINOR.PATCH`.
- Mudanças compatíveis entram em `MINOR`; quebras de compatibilidade exigem `MAJOR`.
- O contrato público (CLI, exit codes `0–7`, formato de `session*.json(.enc)`,
  token `v3:N:r:p:...`, variáveis de ambiente e relatórios `--json`) é estável desde a
  **1.0.0**.

## Fluxo de release (a partir da 1.0.0; ciclo atual 2.x)

1. **Acumule as mudanças** em `main`, registrando cada item na seção `## [Unreleased]`
   do `CHANGELOG.md` (categorias `Adicionado`, `Corrigido`, `Alterado`, `Removido`,
   `Segurança`).
2. **Atualize a versão** (sem criar tag ainda):
   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```
3. **Feche o CHANGELOG**: mova o conteúdo de `[Unreleased]` para
   `## [X.Y.Z] - AAAA-MM-DD` (mantendo o cabeçalho `[Unreleased]` vazio para o próximo ciclo).
4. **Valide localmente** (inclui cobertura e benchmark):
   ```bash
   npm ci
   npm run lint && npm run format:check
   npm run test:coverage
   npm audit --omit=dev
   npm run bench
   shellcheck -x $(find . -path ./node_modules -prune -o -name '*.sh' -print)
   ```
   Em CI, ShellCheck, actionlint, PowerShell, CodeQL, Gitleaks e Docker também são gates.
5. **Commit e tags locais** (o projeto mantém as duas formas de tag apontando para o
   mesmo commit). **Não faça push** até o mantenedor autorizar explicitamente:
   ```bash
   git add -A
   git commit -m "chore(release): X.Y.Z"
   git tag -a X.Y.Z -m "vX.Y.Z - <resumo>"
   git tag -a vX.Y.Z -m "vX.Y.Z - <resumo>"
   # Push somente com autorização do mantenedor:
   # git push origin main
   # git push origin X.Y.Z vX.Y.Z
   ```
6. **Automação**: o workflow [`Release`](.github/workflows/release.yml) dispara em tags
   `X.Y.Z`/`vX.Y.Z`, valida que a tag corresponde ao `package.json`, roda lint + testes
   e publica (ou atualiza de forma idempotente) a GitHub Release:
   - Título: `Release X.Y.Z`
   - Notas: seção correspondente do `CHANGELOG.md`; se ausente, notas geradas pelo GitHub
   - `--latest` para versões estáveis; `--prerelease` para versões com sufixo (`-rc.1`, `-beta.2`)

> Se o workflow falhar por divergência entre tag e `package.json`, corrija a versão,
> recrie a tag e faça push novamente (`git push --force origin X.Y.Z vX.Y.Z`).

### Pre-release (RC)

Para publicar uma pré-release, use SemVer com sufixo e **não mova tags já publicadas**:

```bash
npm version X.Y.Z-rc.1 --no-git-tag-version
# Ajuste o cabeçalho do CHANGELOG para ## [X.Y.Z-rc.1] - AAAA-MM-DD
git add package.json package-lock.json CHANGELOG.md CHANGELOG.en.md
git commit -m "chore(release): X.Y.Z-rc.1"
git tag -a X.Y.Z-rc.1 -m "vX.Y.Z-rc.1 - release candidate"
git tag -a vX.Y.Z-rc.1 -m "vX.Y.Z-rc.1 - release candidate"
```

O workflow `Release` cria a GitHub Release com `--prerelease`. Depois de validar, repita o
fluxo com a versão estável `X.Y.Z`; não reutilize/mova a tag RC.

## Release manual (fallback)

```bash
curl -X POST -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/releases \
  -d '{"tag_name":"X.Y.Z","name":"Release X.Y.Z","body":"<notas>","make_latest":"true"}'
```

## Checklist de release (2.x)

- [ ] `[Unreleased]` migrado para `## [X.Y.Z] - <data>` com **guia de migração** para
      quaisquer quebras de contrato.
- [ ] CLI e exit codes `0–7` documentados e cobertos por testes.
- [ ] Compatibilidade de tokens (`v1`/`v2`/`v3`) e de `session*.json(.enc)` validada.
- [ ] Nenhum achado aberto de severidade alta/média na última auditoria.
- [ ] CI verde nos 3 sistemas (Ubuntu, Windows, macOS) + CodeQL + Gitleaks + Docker.
- [ ] Cobertura ≥ 80% (`npm run test:coverage`) e benchmark (`npm run bench`) registrados.
- [ ] `npm audit --omit=dev` sem vulnerabilidades.
- [ ] `RELEASING`, `README`, `CHANGELOG`, `OBSERVABILITY`, `PERFORMANCE` e
      `credentials.env.example` sincronizados em **PT-BR/EN** (sem documentação em espanhol).
- [ ] Scripts de interface suportam apenas **PT-BR/EN** (`APP_LANGUAGE`/`--lang`).
- [ ] Tags `X.Y.Z`/`vX.Y.Z` (ou `X.Y.Z-rc.N`/`vX.Y.Z-rc.N`) apontando para o commit de
      release; push só com autorização e tags publicadas nunca são movidas.
