import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const designRoot = join(
  projectRoot,
  'DC重构设计源码/_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d',
)
const stylesPath = join(designRoot, 'styles.css')
const manifestPath = join(designRoot, '_ds_manifest.json')
const contentTokensPath = join(designRoot, 'tokens/content-v5.css')
const appTokensPath = join(projectRoot, 'app/assets/css/design-tokens-v5.css')
const localCssImport = /@import\s+["']([^"']+\.css)["'];/g

async function importedCssFiles(entry, visited = new Set()) {
  if (visited.has(entry))
    return []
  visited.add(entry)

  const source = await readFile(entry, 'utf8')
  const imports = Array.from(
    source.matchAll(localCssImport),
    match => resolve(dirname(entry), match[1]),
  )
  const dependencies = []
  for (const dependency of imports)
    dependencies.push(...await importedCssFiles(dependency, visited))

  return [...dependencies, entry]
}

function tokenKind(name, previousKind) {
  if (previousKind)
    return previousKind
  if (['--font-', '--text-', '--weight-', '--leading-', '--tracking-'].some(prefix => name.startsWith(prefix)))
    return 'font'
  if (name.startsWith('--radius'))
    return 'radius'
  if (name.startsWith('--shadow'))
    return 'shadow'
  if (['--space', '--sidebar-w', '--header-h', '--content-max', '--bp-'].some(prefix => name.startsWith(prefix)))
    return 'spacing'
  return 'color'
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const previousTokens = new Map(manifest.tokens.map(token => [token.name, token]))
const activeFiles = await importedCssFiles(stylesPath)
const tokens = []
const tokenNames = new Set()

for (const file of activeFiles) {
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(/^\s*(--[\w-]+):([^;]+);/gm)) {
    const [, name, rawValue] = match
    if (tokenNames.has(name))
      throw new Error(`Duplicate active design token: ${name}`)
    tokenNames.add(name)

    const previous = previousTokens.get(name)
    const token = {
      name,
      value: rawValue.replace(/\s+/g, ' ').trim(),
      kind: tokenKind(name, previous?.kind),
      definedIn: relative(designRoot, file).replaceAll('\\', '/'),
    }
    if (previous?.annotation)
      token.annotation = previous.annotation
    tokens.push(token)
  }
}

manifest.globalCssPaths = ['styles.css']
manifest.tokens = tokens

await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8')

const appTokenFiles = await importedCssFiles(contentTokensPath)
const appTokens = await Promise.all(appTokenFiles.map(async (file) => {
  const source = await readFile(file, 'utf8')
  return source.replace(localCssImport, '').replaceAll('\r\n', '\n').trim()
}))
await writeFile(appTokensPath, `/* 由 pnpm design:sync-manifest 生成。 */\n\n${appTokens.join('\n\n')}\n`, 'utf8')
