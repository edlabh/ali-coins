/**
 * Centralização de seletores do AliExpress (Mobile e Desktop)
 * Combina queries semânticas (getByRole / getByText) com seletores CSS de fallback.
 */

const SELECTORS = {
  // Autenticação e Desafios de Segurança
  login: {
    usernameInput: 'input.cosmos-input, input[type="text"], input[type="email"], #fm-login-id',
    passwordInput: 'input[type="password"], #fm-login-password',
    continueBtn:
      'button.cosmos-btn-primary, button:has-text("Continue"), button:has-text("Continuar")',
    signInBtn:
      'button.cosmos-btn-primary, button[type="submit"], button:has-text("Sign in"), button:has-text("Entrar")',
    twoFactorInput:
      'input[placeholder*="code" i], input[name*="code" i], input[class*="code" i], input[type="tel"][maxlength="6"]',
    twoFactorSubmitBtn:
      'button[type="submit"], button.cosmos-btn-primary, button:has-text("Confirm"), button:has-text("Verify"), button:has-text("Confirmar")',
    loginPendingContainer: '.login-pending-container',
    sliderHandle:
      '#nc_1_n1z, .btn_slide, span[class*="btn_slide"], #nc_1__scale_text .btn_slide, div[id*="nocaptcha"] span',
    sliderTrack: '#nc_1__scale_text, .nc_scale, div[id*="nocaptcha"]'
  },

  // Check-in Diário Mobile
  checkin: {
    collectButtonList: [
      'button#signButton',
      '#signButton',
      '[class*="aecoin-today"]',
      '[class*="rewardItem"]:has-text("Today")',
      '[class*="aecoin-rewardItem"]',
      '.signButton',
      'div[class*="aecoin-signButton"]',
      'div[class*="aecoin-button"]',
      'button:has-text("Collect")',
      'button:has-text("Coletar")',
      'div:has-text("Collect")',
      'div:has-text("Coletar")'
    ],
    todayChecked: '[class*="today-checked"], [class*="aecoin-today-checked"]',
    streakDayNumber:
      '[class*="dayNumber"], [class*="checkedDay"], [class*="currentDay"], [class*="activeDay"]',
    streakTitleContainer:
      '[class*="titleContainer"], [class*="signTitle"], [class*="streak"], [class*="sign-title"], [class*="checkin-title"]',
    waterBtn:
      '.Footer--waterCollectedButtonBg--2jKL1c5, [class*="waterCollected"], button:has-text("regar"), button:has-text("Water")'
  },

  // Painel de Tarefas ("Ganhe mais moedas")
  tasks: {
    drawerContainer: '.e2e_task',
    taskItem: '.e2e_normal_task',
    taskTitle: '.e2e_normal_task_content_title',
    taskSecondTitle: '.e2e_normal_task_content_secondTitle',
    taskBtn: '.e2e_normal_task_right_btn',
    taskStatus: '.statusText',
    taskRight: '.e2e_normal_task_right',
    openDrawerBtn:
      '#signButton, button.aecoin-taskButton-3V41b, [class*="taskButton"], button[class*="aecoin-signButton"], .aecoin-signButtonWrapper-3p3NS button, [class*="signButtonWrapper"] button, div[class*="aecoin-signButton"], button:has-text("Earn more coins"), button:has-text("Ganhe mais moedas")',
    productCard: '.feeds-discount-card',
    waterBtn:
      '.Footer--waterCollectedButtonBg--2jKL1c5, [class*="waterCollected"], button:has-text("regar"), button:has-text("Water")'
  },

  // Modais e Popups Comuns
  modals: {
    closeButtons: [
      '[class*="close"]',
      '[class*="dialog-close"]',
      '[class*="aecoin-close"]',
      '.ui-dialog-close',
      'button:has-text("OK")',
      'button:has-text("Confirm")',
      'button:has-text("Confirmar")',
      'button:has-text("Fechar")'
    ]
  },

  // Desktop My Coin
  desktop: {
    mycoinCheckin: 'text=App daily check-in',
    mycoinUrl: 'https://www.aliexpress.com/p/coin-pc-index/mycoin.html'
  }
};

module.exports = {
  SELECTORS
};
