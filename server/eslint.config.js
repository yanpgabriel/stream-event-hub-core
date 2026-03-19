'use strict';

const js = require('@eslint/js');

const commonGlobals = {
    Buffer: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    console: 'readonly',
    clearInterval: 'readonly',
    clearTimeout: 'readonly',
    process: 'readonly',
    setInterval: 'readonly',
    setTimeout: 'readonly',
};

module.exports = [
    {
        ignores: ['data/**', 'node_modules/**', 'public/**', 'src/frontend/**']
    },
    js.configs.recommended,
    {
        files: ['index.js', 'src/**/*.js', 'test/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: commonGlobals
        },
        rules: {
            'no-console': 'off',
            'no-control-regex': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_'
            }]
        }
    }
];
