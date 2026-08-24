// ESLint 9+ flat config (eslint.config.mjs)
// Remplacé .eslintrc.json : ESLint v9/v10 ignore le format legacy .eslintrc.*
// et exige cette config plate. `eslint-config-next` expose la config
// "core-web-vitals" prête pour le flat config.
import nextVitals from 'eslint-config-next/core-web-vitals'

const config = [
  ...nextVitals,
  {
    // Fichiers de build / générés : aucun lint nécessaire.
    ignores: [
      '.next/**',
      'build/**',
      'dist/**',
      'out/**',
      'node_modules/**',
      'next-env.d.ts',
      'backend/**',
      'scripts/live-gpu-worker/**',
      'runpod_handler.py',
      'public/**',
      'resources/**',
      'electron/build/**',
      'emails/**',
    ],
  },
]

export default config
