import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js'],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // hooks v7 folds the React Compiler rules into recommended. We don't run the
      // compiler, and the ~150 existing hits need per-component refactors, so they
      // report as warnings until that work is done.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react/react-in-jsx-scope': 'off', // Not needed since React 17's JSX transform
      'react/prop-types': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error', 'warn'] }], // Allow error/warn, disallow log/debug
    },
    settings: {
      react: {
        // Pinned rather than 'detect': eslint-plugin-react 7.37's detection calls
        // context.getFilename(), which ESLint 10 removed.
        version: '19.3',
      },
    },
  },
];
