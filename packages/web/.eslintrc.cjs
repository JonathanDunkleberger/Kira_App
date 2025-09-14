module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import', 'unused-imports'],
  extends: [
    'next/core-web-vitals',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  rules: {
    'unused-imports/no-unused-imports': 'off',
    'import/order': ['warn', { 'newlines-between': 'always' }],
    '@typescript-eslint/no-empty-object-type': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-require-imports': 'off',
    '@typescript-eslint/triple-slash-reference': 'off',
    'import/no-anonymous-default-export': 'off',
    'react/no-unescaped-entities': 'off',
    'prefer-const': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.{ts,tsx}'],
      rules: {
        'react-hooks/exhaustive-deps': 'off',
      },
    },
  ],
  ignorePatterns: ['.next', 'node_modules', 'dist', 'build', 'artifacts'],
};
