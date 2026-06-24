// Mirrors the flat-config used by the frontend/website repos (@eslint/js +
// typescript-eslint + react-hooks), adapted for React Native: CommonJS (no
// "type": "module" in package.json), node/RN globals instead of browser, and
// the native build dirs ignored.
const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'android/**',
      'ios/**',
      'vendor/**',
      'metro.config.js',
      'babel.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
        __DEV__: 'readonly',
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Config/entry files are CommonJS in this React Native project.
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
