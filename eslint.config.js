import js from '@eslint/js'
import globals from 'globals'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import prettierConfig from 'eslint-config-prettier'

export default [
  js.configs.recommended,
  // React components
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react: reactPlugin, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // React 17+ JSX transform — no import needed
      'react/prop-types': 'off',         // project doesn't use PropTypes
    },
  },
  // Electron main process
  {
    files: ['electron/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Prettier must be last — disables formatting rules that conflict with it
  prettierConfig,
]
