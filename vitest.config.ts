import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The @deepseek-ai runtime packages are installed as devDependencies and
// their types resolve from node_modules; only their runtime behavior is
// provided by the harness profile. Tests that render components need the
// ui-primitives module the shell seeds at runtime, so it is aliased to a
// local stub; every other @deepseek-ai import in the tested graph is
// type-only and erased before resolution.
const shim = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: '@deepseek-ai/dsh-client-ui-primitives', replacement: shim('tests/platform/primitives-stub.tsx') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
})
