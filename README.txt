================================================================================
                    ALIEXPRESS COIN COLLECTOR & TASK RUNNER
================================================================================

Automação completa para check-in diário de moedas e execução automática das
tarefas ("Ganhe mais moedas") do AliExpress com emulação mobile via Playwright.

Requer: Node.js >= 22 (.nvmrc: 22)
Documentação completa disponível em: README.md e TELEGRAM.md

--------------------------------------------------------------------------------
1. COMANDOS PRINCIPAIS
--------------------------------------------------------------------------------
- Modo Unificado (Check-in + Tarefas):  npm start   (ou ./run_all.sh)
- Validação rápida (Dry-Run):          npm start -- --dry-run
- Relatório em formato JSON:           npm start -- --json
- Notificar Telegram pontualmente:     npm start -- --notify
- Testar Bot Telegram:                 npm run notify:test
- Apenas Check-in Diário:              npm run collect
- Apenas Tarefas:                      npm run tasks
- Suíte de Testes (node:test):         npm test
- Verificação de Lint e Formatação:    npm run lint && npm run format:check

--------------------------------------------------------------------------------
2. CÓDIGOS DE SAÍDA (EXIT CODES)
--------------------------------------------------------------------------------
- 0: Sucesso (check-in realizado ou tarefas processadas com novas moedas)
- 1: Falha (erro de execução ou credenciais)
- 2: Já coletado / sem ação necessária hoje
- 3: Lock ativo (outra execução em andamento)

Consulte README.md, TELEGRAM.md, INSTALL_LINUX.md, INSTALL_WINDOWS.md,
INSTALL_MACOS.md e CLOUD_SESSIONS.md para detalhes adicionais de configuração.
================================================================================
