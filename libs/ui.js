/**
 * Facade externa que re-exporta a camada de UI de libs/ui/index.js
 * Mantém compatibilidade com require('./libs/ui') e require('./libs/ui.js')
 */
module.exports = require('./ui/index');
