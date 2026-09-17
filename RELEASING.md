# Guia de Releases

Este documento descreve o processo de release do `ali-coins`, incluindo a automação de
GitHub Releases e os preparativos para a **1.0.0**.

## Versionamento

- O projeto segue [SemVer](https://semver.org/lang/pt-BR/): `MAJOR.MINOR.PATCH`.
- Enquanto em `0.x`, quebras de compatibilidade podem ocorrer em `MINOR`.
- A **1.0.0** congela o contrato público: CLI, exit codes `0–6`, formato de
  `session*.json(.enc)`, token `v3:N:r:p:...`, variáveis de ambiente e relatórios `--json`.

## Fluxo de release (a partir da 0.9.7)

1. **Acumule as mudanças** em `main`, registrando cada item na seção `## [Unreleased]`
   do `CHANGELOG.md` (categorias `Adicionado`, `Corrigido`, `Alterado`, `Removido`,
   `Segurança`).
2. **Atualize a versão** (sem criar tag ainda):
   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```
3. **Feche o CHANGELOG**: mova o conteúdo de `[Unreleased]` para
   `## [X.Y.Z] - AAAA-MM-DD` (mantendo o cabeçalho `[Unreleased]` vazio para o próximo ciclo).
4. **Valide localmente**:
   ```bash
   npm ci && npm run lint && npm run format:check && npm test && npm audit --omit=dev
   ```
5. **Commit e tags** (o projeto mantém as duas formas de tag apontando para o mesmo commit):
   ```bash
   git add -A
   git commit -m "chore(release): X.Y.Z"
   git tag -a X.Y.Z -m "vX.Y.Z - <resumo>"
   git tag -a vX.Y.Z -m "vX.Y.Z - <resumo>"
   git push origin main
   git push origin X.Y.Z vX.Y.Z
   ```
6. **Automação**: o workflow [`Release`](.github/workflows/release.yml) dispara em tags
   `X.Y.Z`/`vX.Y.Z`, valida que a tag corresponde ao `package.json`, roda lint + testes
   e publica (ou atualiza de forma idempotente) a GitHub Release:
   - Título: `Release X.Y.Z`
   - Notas: seção correspondente do `CHANGELOG.md`; se ausente, notas geradas pelo GitHub
   - `--latest` para versões estáveis; `--prerelease` para versões com sufixo (`-rc.1`, `-beta.2`)

> Se o workflow falhar por divergência entre tag e `package.json`, corrija a versão,
> recrie a tag e faça push novamente (`git push --force origin X.Y.Z vX.Y.Z`).

## Release manual (fallback)

```bash
curl -X POST -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/releases \
  -d '{"tag_name":"X.Y.Z","name":"Release X.Y.Z","body":"<notas>","make_latest":"true"}'
```

## Checklist para a 1.0.0

- [ ] `[Unreleased]` migrado para `## [1.0.0] - <data>` com **guia de migração** para
      quaisquer quebras de contrato.
- [ ] CLI e exit codes `0–6` documentados e cobertos por testes.
- [ ] Compatibilidade de tokens (`v1`/`v2`/`v3`) e de `session*.json(.enc)` validada.
- [ ] Nenhum achado aberto de severidade alta/média na última auditoria.
- [ ] CI verde nos 3 sistemas (Ubuntu, Windows, macOS) + CodeQL + Gitleaks.
- [ ] Cobertura ≥ 80% (`npm run test:coverage`).
- [ ] `npm audit --omit=dev` sem vulnerabilidades.
- [ ] `RELEASING.md`, `README.md`, `CHANGELOG.md` e `credentials.env.example` sincronizados.
- [ ] Tags `1.0.0` e `v1.0.0` apontando para o commit de release (workflow publica a release).
