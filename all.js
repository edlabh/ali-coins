const { runCheckin } = require('./collect');
const { runTasks } = require('./do_tasks');
const { formatDate, formatTime, formatDateTime, formatDuration } = require('./time_utils');

async function main() {
  const mainStartTime = new Date();
  console.log('===============================================================');
  console.log('       ALIEXPRESS MOEDAS - MODO UNIFICADO (CHECK-IN + TAREFAS)');
  console.log('===============================================================\n');

  // ETAPA 1: Check-in diário
  const step1StartTime = new Date();
  console.log('>>> [ETAPA 1/2] Iniciando Check-in Diário...');
  console.log(`    Dia e Hora de Início: ${formatDateTime(step1StartTime)}`);
  let checkinResult = null;
  try {
    checkinResult = await runCheckin();
  } catch (err) {
    const step1EndTime = new Date();
    const step1Duration = formatDuration(step1EndTime - step1StartTime);
    console.error('\n' + '='.repeat(68));
    console.error(' [ERRO DE LOGIN DETECTADO]');
    console.error(` ${err.message}`);
    console.error(` Término: ${formatDateTime(step1EndTime)} (Duração: ${step1Duration})`);
    console.error(' Interrompendo a execução: as tarefas NÃO serão executadas.');
    console.error('='.repeat(68) + '\n');
    process.exit(1);
  }

  const step1EndTime = new Date();
  const step1Duration = formatDuration(step1EndTime - step1StartTime);

  if (!checkinResult) {
    console.error('\n[ERRO CRÍTICO] Falha na etapa de check-in / login.');
    console.error(`Dia e Hora: ${formatDateTime(step1EndTime)} (Duração: ${step1Duration})`);
    console.error('Interrompendo a execução: as tarefas NÃO serão executadas.\n');
    process.exit(1);
  }

  console.log(`>>> [ETAPA 1/2] Concluída em ${formatDateTime(step1EndTime)} | Duração: ${step1Duration}`);

  console.log('\n---------------------------------------------------------------');
  console.log(`[Login] Conta: ${checkinResult.userEmail}`);
  console.log(`[Check-in] Status: ${checkinResult.alreadyCollected ? 'Já realizado hoje' : 'Coletado agora'} (+${checkinResult.coinsGainedToday} moedas)`);
  console.log(`[Sequência] ${checkinResult.streakDays} dias seguidos sem falha`);
  console.log(`[Saldo Parcial] ${checkinResult.totalBalance} moedas`);
  console.log(`[Execução Etapa 1] Início: ${formatDateTime(step1StartTime)} | Duração: ${step1Duration}`);
  console.log('---------------------------------------------------------------\n');

  // ETAPA 2: Execução das tarefas diárias
  const step2StartTime = new Date();
  console.log('>>> [ETAPA 2/2] Iniciando Execução Sequencial das Tarefas Diárias...');
  console.log(`    Dia e Hora de Início: ${formatDateTime(step2StartTime)}`);
  let tasksResult = null;
  try {
    tasksResult = await runTasks();
  } catch (err) {
    console.error('Aviso na etapa de tarefas:', err.message);
  }

  const step2EndTime = new Date();
  const step2Duration = formatDuration(step2EndTime - step2StartTime);
  console.log(`>>> [ETAPA 2/2] Concluída em ${formatDateTime(step2EndTime)} | Duração: ${step2Duration}`);

  // ETAPA 3: Relatório consolidado
  const mainEndTime = new Date();
  const totalDuration = formatDuration(mainEndTime - mainStartTime);

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
  console.log('---------------------------------------------------------------');
  console.log(`Data:                ${formatDate(mainStartTime)}`);
  console.log(`Hora de Início:      ${formatTime(mainStartTime)}`);
  console.log(`Hora de Finalização: ${formatTime(mainEndTime)}`);
  console.log(`Duração Etapa 1:     ${step1Duration}`);
  console.log(`Duração Etapa 2:     ${step2Duration}`);
  console.log(`Duração Total:       ${totalDuration}`);
  console.log('===============================================================\n');
}

main().catch(err => {
  console.error('Erro na execução unificada:', err);
  process.exit(1);
});
