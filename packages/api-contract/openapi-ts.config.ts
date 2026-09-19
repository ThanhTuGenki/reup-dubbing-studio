import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../contracts/openapi/web.openapi.yaml',
  output: {
    clean: true,
    path: 'src/generated',
  },
  plugins: [
    '@hey-api/typescript',
    '@hey-api/sdk',
    { name: '@hey-api/client-fetch', bundle: false },
  ],
});
