import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The plugin repo installs no @deepseek-ai packages (types resolve from the
// harness mirror; runtime resolution happens in the profile). Tests that
// render components need the ui-primitives module the shell seeds at runtime,
// so it is aliased to a local stub; every other @deepseek-ai import in the
// tested graph is type-only and erased before resolution.
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
