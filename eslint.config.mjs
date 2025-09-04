import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.mjs'],
                },
                tsconfigRootDir: import.meta.dirname,
                project: './tsconfig.json',
            },
        },
    },
    {
        ignores: [
            'src-admin/**/*',
            'admin/**/*',
            'n8n/**/*',
            'node_modules/**/*',
            'test/**/*',
            'dist/**/*',
            'n8n-nodes-iobroker/dist/**/*',
            'n8n-nodes-iobroker/node_modules/**/*',
            'tasks.js',
            'src-iobroker/**/*',
            'n8n-nodes-iobroker/**/*',
            'public/**/*',
            'tmp/**/*',
            '.**/*',
        ],
    },
    {
        // disable temporary the rule 'jsdoc/require-param' and enable 'jsdoc/require-jsdoc'
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',

            '@typescript-eslint/no-require-imports': 'off',
        },
    },
];
