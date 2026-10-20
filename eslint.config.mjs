import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default ts.config(
  {
    ignores: [
      'node_modules/**',
      '.test-build/**',
      'artifacts/**',
      'miniprogram/config/local.ts',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.cjs', 'cloudfunctions/**/*.js'],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['miniprogram/**/*.ts'],
    languageOptions: {
      globals: {
        wx: 'readonly',
        App: 'readonly',
        Page: 'readonly',
        Component: 'readonly',
        WechatMiniprogram: 'readonly',
      },
    },
  },
);
