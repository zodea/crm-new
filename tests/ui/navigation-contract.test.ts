import { existsSync, mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readAppPageFiles } from '../../scripts/design-coverage.mjs'

const PROJECT_ROOT = process.cwd()
const PAGES_ROOT = join(PROJECT_ROOT, 'app/pages')
const CONTRACT_PATH = join(PROJECT_ROOT, 'docs/rewrite/NAVIGATION.md')
const READ_MODELS_PATH = join(PROJECT_ROOT, 'docs/rewrite/READ-MODELS.md')
const DOCS_INDEX_PATH = join(PROJECT_ROOT, 'docs/README.md')

function productionPageFiles(): string[] {
  return readAppPageFiles(PAGES_ROOT)
    .filter(path => !path.startsWith('dev/'))
    .map(path => `app/pages/${path}`)
}

function nuxtRouteForPage(page: string): string {
  const segments = page
    .replace(/^app\/pages\//, '')
    .replace(/\.vue$/, '')
    .split('/')

  if (segments.at(-1) === 'index')
    segments.pop()

  const route = segments
    .map(segment => segment
      .replace(/^\[\[([^\]]+)\]\]$/, ':$1?')
      .replace(/^\[([^\]]+)\]$/, ':$1'))
    .join('/')

  return route ? `/${route}` : '/'
}

function markdownCells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map(cell => cell.trim())
}

function section(markdown: string, startHeading: string, endHeading: string): string {
  const start = markdown.indexOf(startHeading)
  const end = markdown.indexOf(endHeading, start + startHeading.length)
  expect(start, startHeading).toBeGreaterThanOrEqual(0)
  expect(end, endHeading).toBeGreaterThan(start)
  return markdown.slice(start, end)
}

function routeRegistryRows(markdown: string): string[][] {
  return section(markdown, '## 3. 已登记目标路由', '## 4. 跨域关系矩阵')
    .split(/\r?\n/)
    .filter(line => line.startsWith('| ') && !line.startsWith('| ---') && !line.startsWith('| 实体/视图'))
    .map(markdownCells)
}

function navigationRows(markdown: string): string[][] {
  return section(markdown, '## 4. 跨域关系矩阵', '## 5. 付款洞察与多页签影响因素')
    .split(/\r?\n/)
    .filter(line => /^\| `N-[A-Z0-9-]+` \|/.test(line))
    .map(markdownCells)
}

function readModelDomainCodes(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter(line => /^\| `[a-z][a-z-]+` \|/.test(line))
    .map(line => markdownCells(line)[0].replaceAll('`', ''))
}

describe('cross-domain navigation contract', () => {
  it('仅排除名为 _components 的各层页面私有目录', () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), 'crm-page-files-'))
    for (const file of [
      'index.vue',
      'contract/boq/[id].vue',
      'contract/boq/_components-copy/index.vue',
      '_components/PrivateRoot.vue',
      'contract/boq/_components/nested/PrivateChild.vue',
    ]) {
      const path = join(fixture.path, file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '<template />')
    }
    expect(readAppPageFiles(fixture.path)).toEqual([
      'contract/boq/[id].vue',
      'contract/boq/_components-copy/index.vue',
      'index.vue',
    ])
  })

  it('registers only existing production target paths', () => {
    expect(existsSync(CONTRACT_PATH)).toBe(true)

    const routes = new Set(productionPageFiles().map(nuxtRouteForPage))
    const rows = routeRegistryRows(readFileSync(CONTRACT_PATH, 'utf8'))

    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map(row => row[0])).size).toBe(rows.length)
    for (const [entity, , target, status] of rows) {
      const declaredRoutes = [...target.matchAll(/`(\/[^`?\s]+)(?:\?[^`]*)?`/g)]
        .map(match => match[1])

      if (!declaredRoutes.length) {
        expect(`${target} ${status}`, entity).toMatch(/—|没有 canonical|受控预览/)
        continue
      }

      for (const route of declaredRoutes)
        expect(routes.has(route), `${entity}: ${route}`).toBe(true)
    }
  })

  it('covers every read-model domain with a unique actionable matrix key', () => {
    const navigation = readFileSync(CONTRACT_PATH, 'utf8')
    const rows = navigationRows(navigation)
    const keys = rows.map(row => row[0].replaceAll('`', ''))
    const sourceDomains = new Set(
      rows.flatMap(row => [...row[1].matchAll(/`([a-z][a-z-]+)`/g)].map(match => match[1])),
    )

    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(keys.length)
    for (const row of rows) {
      expect(row).toHaveLength(7)
      for (const cell of row)
        expect(cell).not.toBe('')
    }

    for (const domain of readModelDomainCodes(readFileSync(READ_MODELS_PATH, 'utf8')))
      expect(sourceDomains.has(domain), domain).toBe(true)
  })

  it.each([
    'type NavigationIntentDTO =',
    'kind: \'entity-detail\' | \'entity-subview\' | \'source-record\'',
    'kind: \'same-route-overlay\'',
    '多态单据必须带 canonical `variant`',
    '`returnTo` 只接受站内相对路径',
    'query 只恢复筛选/页签/来源，不覆盖路径实体 ID',
    '聚合值为 `0` 时',
    '不能依赖浏览器历史“碰巧还在”',
    '28 个内部页签不等于 28 个浏览器页',
    '切换记录时当前合同/付款/票款检查会换成新记录结果',
    '普通详情分析与审批流分析是两个语义 operation',
    '可见蓝色样式不能自动解释为链接',
  ])('defines identity, return, zero-value and multi-tab safeguards: %s', (token) => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8')
    expect(contract.replace(/\s+/g, ' '), token).toContain(token.replace(/\s+/g, ' '))
  })

  it('is linked from the canonical docs and read-model contracts', () => {
    expect(readFileSync(DOCS_INDEX_PATH, 'utf8')).toContain(
      '[`docs/rewrite/NAVIGATION.md`](./rewrite/NAVIGATION.md)',
    )
    expect(readFileSync(READ_MODELS_PATH, 'utf8')).toContain(
      '[`NAVIGATION.md`](./NAVIGATION.md)',
    )
  })
})
