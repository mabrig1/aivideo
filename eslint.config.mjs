import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  // Existing studio state-restoration patterns will be modernized separately.
  { rules: {
    'react-hooks/set-state-in-effect': 'off',
    'react-hooks/static-components': 'off',
    '@next/next/no-img-element': 'off',
  } },
  globalIgnores(['.next/**', '.open-next/**', 'cloudflare-env.d.ts', 'next-env.d.ts']),
]);
