const { runCheckin } = require('./collect');
const { runTasks } = require('./do_tasks');

async function main() {
  console.log('===============================================================');
  console.log('       ALIEXPRESS MOEDAS - MODO UNIFICADO (CHECK-IN + TAREFAS)');
  console.log('===============================================================\n');

  // ETAPA 1: Check-in diário
  console.log('>>> [ETAPA 1/2] Iniciando Check-in Diário...');
  let checkinResult = null;
  try {
    checkinResult = await runCheckin();
  } catch (err) {
    console.error('Aviso na etapa de check-in:', err.message);
  }

  console.log('\n---------------------------------------------------------------');
  if (checkinResult) {
    console.log(`[Login] Conta: ${checkinResult.userEmail}`);
    console.log(`[Check-in] Status: ${checkinResult.alreadyCollected ? 'Já realizado hoje' : 'Coletado agora'} (+${checkinResult.coinsGainedToday} moedas)`);
    console.log(`[Sequência] ${checkinResult.streakDays} dias seguidos sem falha`);
    console.log(`[Saldo Parcial] ${checkinResult.totalBalance} moedas`);
  } else {
    console.log('[Check-in] Executado.');
  }
  console.log('---------------------------------------------------------------\n');

  // ETAPA 2: Execução das tarefas diárias
  console.log('>>> [ETAPA 2/2] Iniciando Execução Sequencial das Tarefas Diárias...');
  let tasksResult = null;
  try {
    tasksResult = await runTasks();
  } catch (err) {
    console.error('Aviso na etapa de tarefas:', err.message);
  }

  // ETAPA 3: Relatório consolidado
  console.log('\n===============================================================');
  console.log('                RELATÓRIO CONSOLIDADO FINAL');
  console.log('===============================================================');
  if (checkinResult) {
    console.log(`Conta: ${checkinResult.userEmail}`);
    console.log(`Sequência (Streak): ${checkinResult.streakDays} dias seguidos (+${checkinResult.coinsGainedToday} moedas/dia)`);
    console.log(`Check-in Diário: ${checkinResult.alreadyCollected ? 'Já coletado hoje' : 'Coletado com sucesso'} (+${checkinResult.coinsGainedToday} moedas)`);
  }

  if (tasksResult && tasksResult.results) {
    console.log('\nTarefas do Painel "Ganhe mais moedas":');
    for (const r of tasksResult.results) {
      console.log(`  • ${r.title}: ${r.status} (${r.coins || ''})`);
    }
  }

  const finalBalance = (tasksResult && tasksResult.finalCoins && tasksResult.finalCoins !== 'N/D')
    ? tasksResult.finalCoins
    : (checkinResult ? `${checkinResult.totalBalance} moedas` : 'N/D');

  console.log('---------------------------------------------------------------');
  console.log(`Saldo Total Atualizado: ${finalBalance}`);
  console.log('===============================================================\n');
}

main().catch(err => {
  console.error('Erro na execução unificada:', err);
  process.exit(1);
});
