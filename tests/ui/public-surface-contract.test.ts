import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PUBLIC_SURFACES_PATH = join(ROOT, 'docs/rewrite/PUBLIC-SURFACES.md')
const READ_MODELS_PATH = join(ROOT, 'docs/rewrite/READ-MODELS.md')
const AUDIT_PATH = join(ROOT, 'docs/design/runtime-reference-audit.md')
const DOCS_INDEX_PATH = join(ROOT, 'docs/README.md')
const ARCHITECTURE_PATH = join(ROOT, 'docs/rewrite/ARCHITECTURE.md')

describe('public surface contract', () => {
  it('records the direct mounting and refresh evidence without conflating browser and app tabs', () => {
    expect(existsSync(PUBLIC_SURFACES_PATH)).toBe(true)
    const contract = readFileSync(PUBLIC_SURFACES_PATH, 'utf8')

    for (const token of [
      '浏览器只有 **1 个页面**',
      '**25 个业务页签**',
      '付款申请详情',
      '材料采购合同详情',
      '开票申请详情',
      '浏览器刷新',
      '页签栏内“刷新当前页”',
      '`MAX_TABS = 15`',
    ]) {
      expect(contract, token).toContain(token)
    }
  })

  it.each([
    '`metadataKey + position + capability`',
    '`subject.id + sourceVersion`',
    '[READ-MODELS 的分层缓存身份](./READ-MODELS.md#insight-cache-identity)',
    '`openNotification(eventId)`',
    '`NotificationOpenResultDTO`',
    'toast 自动消失或手动关闭',
    '不写 `readAt`',
    '默认不恢复 `/new`、`/form`、`/edit`',
    '`onDeactivated`',
    '全局通知连接只允许由应用壳维护一个实例',
    '`subject.id + sourceVersion`',
    '静态样本只在服务端授权后的演示模式展示',
    // 旧断言保护不拿样本填正式源；未接入现在须明示不可用，不能冒充已核实空集。
    '其他运行环境或未接领域明确显示来源尚未就绪',
    '演示 fixture 不得成为正式运行 fallback',
  ])('defines layered insight, atomic notification opening and recovery boundaries: %s', (token) => {
    const contract = readFileSync(PUBLIC_SURFACES_PATH, 'utf8')
    expect(contract.includes(token), token).toBe(true)
  })

  it.each([
    'interface InsightAvailabilityDTO',
    `availability: 'available' | 'unavailable' | 'forbidden'`,
    'NotificationOpenResultDTO 返回 {eventId,readAt,target}',
    '读取接口不修改 readAt',
    '[`PUBLIC-SURFACES.md`](./PUBLIC-SURFACES.md)',
    '`subject.id + sourceVersion`',
    '`report.key + visibility fingerprint + asOf + sourceVersion`',
  ])('promotes stable public DTOs into the read model authority: %s', (token) => {
    const readModels = readFileSync(READ_MODELS_PATH, 'utf8')
    expect(readModels.includes(token), token).toBe(true)
  })

  it('is linked from the canonical indexes and direct runtime evidence', () => {
    expect(readFileSync(DOCS_INDEX_PATH, 'utf8')).toContain(
      '[`docs/rewrite/PUBLIC-SURFACES.md`](./rewrite/PUBLIC-SURFACES.md)',
    )
    expect(readFileSync(ARCHITECTURE_PATH, 'utf8')).toMatch(
      /\[[^\]]+\]\(\.\/PUBLIC-SURFACES\.md\)/,
    )
    expect(readFileSync(AUDIT_PATH, 'utf8')).toContain('`R-PUBLIC-SURFACES-LIVE`')
  })
})
