const globals = require('globals');
const js = require('@eslint/js');
const eslintConfigPrettier = require('eslint-config-prettier/flat');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      indent: ['error', 2],
      'no-shadow': ['error', { builtinGlobals: true, allow: ['err'] }],
      'no-unused-vars': ['error', { args: 'none' }],
      quotes: ['error', 'single', { avoidEscape: true }],
      semi: ['error', 'always'],
    },
  },
  eslintConfigPrettier,
];
