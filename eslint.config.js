const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'libs/extracted/**',
      'scratch/**',
      '*.png',
      '*.log',
      '*.lock',
      'session*.json',
      'session_token.txt'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-constant-condition': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
