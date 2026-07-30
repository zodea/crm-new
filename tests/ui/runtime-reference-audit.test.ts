import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = process.cwd()
const PAGES_ROOT = join(PROJECT_ROOT, 'app/pages')
const AUDIT_PATH = join(PROJECT_ROOT, 'docs/design/runtime-reference-audit.md')
const PAGE_TEMPLATES = new Set(['列表', '详情', '整页表单', '工作台', '特殊工具'])

interface AuditRow {
  page: string
  route: string
  domain: string
  template: string
  ticket: string
  reference: string
  layoutGap: string
  interactionGap: string
  constraints: string
}

function productionPageFiles(directory = PAGES_ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const isRootDevDirectory = directory === PAGES_ROOT && entry.name === 'dev'
      return isRootDevDirectory ? [] : productionPageFiles(path)
    }
    return extname(entry.name) === '.vue'
      ? [relative(PROJECT_ROOT, path).replaceAll('\\', '/')]
      : []
  }).sort()
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

function auditRows(markdown: string): AuditRow[] {
  return markdown
    .split(/\r?\n/)
    .filter(line => line.startsWith('| `app/pages/'))
    .map((line) => {
      const [page, route, domain, template, ticket, reference, layoutGap, interactionGap, constraints] = markdownCells(line)
      return {
        page: page.replaceAll('`', ''),
        route: route.replaceAll('`', ''),
        domain,
        template,
        ticket,
        reference,
        layoutGap,
        interactionGap,
        constraints,
      }
    })
}

function definedProfileCodes(markdown: string, prefix: 'R-' | 'C-'): Set<string> {
  return new Set(markdown
    .split(/\r?\n/)
    .filter(line => line.startsWith(`| \`${prefix}`))
    .map(line => markdownCells(line)[0].replaceAll('`', '')))
}

function markdownSection(markdown: string, heading: string, nextHeading: string): string {
  const start = markdown.indexOf(heading)
  const end = markdown.indexOf(nextHeading, start + heading.length)

  expect(start, heading).toBeGreaterThanOrEqual(0)
  expect(end, nextHeading).toBeGreaterThan(start)

  return markdown.slice(start, end)
}

describe('runtime reference audit contract', () => {
  it('keeps one auditable row for every production route', () => {
    expect(existsSync(AUDIT_PATH)).toBe(true)

    const markdown = readFileSync(AUDIT_PATH, 'utf8')
    const rows = auditRows(markdown)
    const pages = productionPageFiles()

    expect(rows.map(row => row.page).sort()).toEqual(pages)
    expect(new Set(rows.map(row => row.page)).size).toBe(rows.length)
    expect(new Set(rows.map(row => row.route)).size).toBe(rows.length)

    for (const row of rows)
      expect(row.route, row.page).toBe(nuxtRouteForPage(row.page))
  })

  it('records classification, evidence, differences and constraints for each route', () => {
    const markdown = readFileSync(AUDIT_PATH, 'utf8')
    const references = definedProfileCodes(markdown, 'R-')
    const constraints = definedProfileCodes(markdown, 'C-')

    for (const row of auditRows(markdown)) {
      expect(row.route, row.page).toMatch(/^\//)
      expect(row.domain, row.page).not.toBe('')
      expect(PAGE_TEMPLATES.has(row.template), row.page).toBe(true)
      expect(row.ticket, row.page).toMatch(/^#\d+$/)
      expect(references.has(row.reference), row.page).toBe(true)
      expect(row.layoutGap, row.page).not.toBe('')
      expect(row.interactionGap, row.page).not.toBe('')
      expect(constraints.has(row.constraints), row.page).toBe(true)
    }
  })

  it('defines safe evidence, discrepancy and needs-info protocols', () => {
    const markdown = readFileSync(AUDIT_PATH, 'utf8')
    const boundary = markdownSection(markdown, '## 1. 裁定边界', '## 2. 严格只读观察协议')
    const safeObservation = markdownSection(markdown, '## 2. 严格只读观察协议', '## 3. 参考证据档案')
    const needsInfoTemplate = safeObservation.match(/### needs-info 固定模板\s+```md\r?\n([\s\S]+?)\r?\n```/)?.[1]

    expect(needsInfoTemplate?.match(/^## .+$/gm)).toEqual([
      '## Reference behavior',
      '## Current app behavior',
      '## Decision requested',
      '## Safe default',
    ])
    expect(safeObservation).toMatch(/裁剪脱敏图或重绘线框/)
    expect(safeObservation).toMatch(/截图必须移除[^。\n]*真实客户、项目、人员、金额或单据数据/)
    expect(safeObservation).toMatch(/打开空白新建页核对后直接关闭\/取消/)
    expect(safeObservation).toMatch(/不得录入、粘贴、上传、选择业务对象、保存、提交/)
    expect(safeObservation).toMatch(/禁止修改、删除、下载、导出、审批/)
    expect(boundary).toMatch(/#181[\s\S]+通过 #183 并入设计权威链/)
    expect(boundary).toMatch(/#110[\s\S]+历史解释力/)
    expect(boundary).toMatch(/双源边界/)
  })
})
