/**
 * Standalone tsdown config for the dsh-session-notification external plugin — the
 * browser-half counterpart of the in-repo clientBundle preset, kept
 * self-contained so this package builds outside the dsh workspace.
 *
 * Emits three artifacts:
 *  - lib/index.js + lib/invariant.js: the Node half (ESM) the host Loader
 *    mounts. Imports @deepseek-ai runtime packages (peer dependencies);
 *    everything else is type-only.
 *  - lib/client.js: the browser half (CJS closure bundle) served by the
 *    modules node half into window.__DSH_BOOT__ — a lazy module-table entry
 *    whose externals are exactly the platform seed modules, answered at
 *    runtime by the shell's loader (react family, cordis, ui-slots,
 *    ui-primitives, web-react, schema-form) plus the documented
 *    runtime/client store exemption.
 *
 * CSS Modules are compiled by lightningcss inside the bundle: importing
 * `x.module.css` yields the hashed class map, and the css text auto-injects
 * a <style data-plugin="dsh-session-notification"> tag at factory execution (the loader
 * removes plugin-owned tags on unload).
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PLUGIN_ID = '@dingyi222666/dsh-session-notification'

/** The browser platform seed modules the shell shares into the frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/**
 * Documented exemption carried over from the repo preset: the snapshot-store
 * engine lives in runtime pending its promotion-time rehoming, and client
 * bundles that touch it must stay external to it.
 */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

const EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

export default [
  {
    name: `${PLUGIN_ID}/node`,
    entry: ['src/index.ts', 'src/invariant.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // Harness packages and cordis stay external: the profile's hoisted store
    // answers them, so the tool registers against the SAME dsh-tools registry
    // the host mounted (a bundled copy would be a second, dead registry).
    // `yaml` is the plugin's own dependency and ships bundled.
    external: (id: string) => id === 'cordis' || id.startsWith('@deepseek-ai/'),
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (id: string) => (EXTERNALS.includes(id) ? undefined : true),
    plugins: [{
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        // The virtual id otherwise hides the physical stylesheet from Rolldown's watch graph.
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        // One <style data-plugin> per module file; idempotent under re-evaluation.
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${PLUGIN_ID}/${basename(fileId)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
