import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-agent',
      'coverage',
      'playwright-report',
      'test-results',
      // Copied out of node_modules by scripts/kopiera-tesseract.mjs. Someone
      // else's minified build is not ours to lint.
      'public/tesseract',
      'public/pdf',
      // Git worktrees the tooling puts here. Each is a second checkout of the
      // whole repo with its own tsconfig, which leaves typescript-eslint with
      // several candidates for tsconfigRootDir and refusing to run at all.
      // The code in them is linted where it belongs: in its own checkout.
      '.claude',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },

  {
    // Build scripts run in Node, not a browser, and so does the receipt
    // assistant's command-line device and the server that hands out the app.
    files: ['scripts/**/*.mjs', 'server/**/*.mjs', 'src/agent/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    // `configs.flat` is the flat-config-shaped export; `configs.recommended`
    // still carries an eslintrc-style plugins array.
    ...reactHooks.configs.flat['recommended-latest'],
    files: ['src/**/*.tsx'],
  },

  /*
   * The domain layer is the reason this project can be trusted, so its purity
   * is enforced here rather than left to discipline. See CLAUDE.md,
   * "Arkitektur" and hard rule 3.
   *
   * These rules are in place before src/domain/ exists on purpose: a boundary
   * added after the first violation is a boundary that has already failed.
   */
  {
    files: ['src/domain/**/*.ts'],
    languageOptions: {
      globals: {},
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'The domain layer must not depend on the UI.' },
            { name: 'react-dom', message: 'The domain layer must not depend on the UI.' },
            { name: 'dexie', message: 'The domain layer must not know about storage.' },
          ],
          patterns: [
            {
              group: ['**/data/**', '**/features/**', '**/ui/**', '**/platform/**'],
              message:
                'The domain layer may not import other layers. Dependencies point inwards: features and data depend on domain, never the reverse.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'The domain layer must run in Node without a DOM.',
        },
        {
          name: 'document',
          message: 'The domain layer must run in Node without a DOM.',
        },
        {
          name: 'localStorage',
          message: 'The domain layer must not touch storage.',
        },
        {
          name: 'indexedDB',
          message: 'The domain layer must not touch storage.',
        },
        {
          name: 'navigator',
          message: 'The domain layer must not touch platform APIs.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'Hard rule 3: no clock in the domain layer. Inject the current date so that tests are deterministic and a report run at midnight matches one run at noon.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'Hard rule 3: no clock in the domain layer. Inject the current date instead.',
        },
      ],
    },
  },

  {
    files: ['*.config.{js,ts}', 'scripts/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
