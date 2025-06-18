const js = require('@eslint/js');
const jestPlugin = require('eslint-plugin-jest');
const globals = require('globals');

const browserGlobals = Object.fromEntries(Object.entries(globals.browser).map(([k, v]) => [k.trim(), v]));
const es5Globals = Object.fromEntries(Object.entries(globals.es5).map(([k, v]) => [k.trim(), v]));
const nodeGlobals = Object.fromEntries(Object.entries(globals.node).map(([k, v]) => [k.trim(), v]));

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        ...es5Globals,
        ...nodeGlobals,
        chrome: 'readonly',
        globalThis: 'readonly',
        self: 'readonly',
        window: 'readonly'
      }
    },
    plugins: {
      jest: jestPlugin
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'jest/expect-expect': 'error'
    }
  }
];
