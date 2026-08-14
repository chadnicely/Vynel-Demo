// Vynel ESLint flat config. Enforces `.claude/rules/coding-standard.md`
// at the lint level (review-blocking rules still live in the agent + tests).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vuePlugin from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import importX from 'eslint-plugin-import-x'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.vite/**',
      '**/.data/**',
      'packages/sdk/src/generated/**',
      'packages/contracts/src/generated/**',
      'apps/mcp/src/generated/**',
      'packages/db/src/migrations-sqlite/**',
      'packages/db/src/migrations-postgres/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: {
      'import-x': importX,
    },
    rules: {
      // .claude/rules/coding-standard.md "Discipline"
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],

      // .claude/rules/coding-standard.md "Imports" — require .js on relative TS
      'import-x/extensions': [
        'error',
        'ignorePackages',
        { ts: 'never', tsx: 'never', vue: 'ignorePackages' },
      ],

      // Type-only imports (verbatimModuleSyntax)
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],

      // No floating promises in async code
      '@typescript-eslint/no-floating-promises': 'off', // requires type-aware lint; enable per-package when ready
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Web surfaces (apps/local-web + packages/ui) — Vue SFC support
  {
    files: ['apps/local-web/**/*.vue', 'packages/ui/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: { ...globals.browser },
    },
    plugins: { vue: vuePlugin },
    processor: vuePlugin.processors['.vue'],
    rules: {
      ...vuePlugin.configs['flat/recommended'].at(-1)?.rules,
      // Honors <!-- eslint-disable-* --> directives inside templates (the
      // processor emits them; without this rule they are silently ignored).
      'vue/comment-directive': 'error',
      // .claude/rules/coding-standard.md "Frontend"
      'vue/multi-word-component-names': 'off',
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      'vue/component-api-style': ['error', ['script-setup']],
    },
  },

  // Web surfaces — browser env for non-Vue files too
  {
    files: ['apps/local-web/src/**/*.{ts,js}', 'packages/ui/src/**/*.{ts,js}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // scripts/src/debug/ — console.log is allowed here only (throwaway scripts)
  {
    files: ['scripts/src/debug/**'],
    rules: {
      'no-console': 'off',
    },
  },

  // scripts/src/voice/ — dev tooling (model fetch + synth smoke) prints progress
  {
    files: ['scripts/src/voice/**'],
    rules: {
      'no-console': 'off',
    },
  },

  // Tests
  {
    files: ['**/*.test.ts', '**/*.integration.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
