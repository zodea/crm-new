// 重生成 docs/design/design-coverage.json。
// 与 scripts/sync-design-token-manifest.mjs 同构：读现有生成物 → 保留人工裁定字段 → 重算写回。
// 新出现的 app 路由一律落 design-pending + 空 reason，逼人显式登记；
// tests/ui/design-token-contract.test.ts 的「设计覆盖契约」会因空 reason 变红。

import { readFile, writeFile } from 'node:fs/promises'
import {
  buildCoverage,
  COVERAGE_PATH,
  replaceCountsBlock,
  STATUS_DOC_PATH,
} from './design-coverage.mjs'

const curated = await readFile(COVERAGE_PATH, 'utf8')
  .then(source => JSON.parse(source))
  .catch(() => ({}))

const coverage = buildCoverage(curated)

await writeFile(COVERAGE_PATH, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8')

// 同轮把数字写回 ui-implementation-status.md 的生成块，杜绝该文档再次静默过期
const statusDoc = await readFile(STATUS_DOC_PATH, 'utf8')
await writeFile(STATUS_DOC_PATH, replaceCountsBlock(statusDoc, coverage.counts), 'utf8')

const { counts } = coverage
console.log(
  `设计稿 ${counts.designPageRoutes} 屏 + ${counts.designFormRoutes} 整页表单 | `
  + `实现 ${counts.appPageFiles} 页面路由 | `
  + `已覆盖 ${counts.covered} · 待补设计 ${counts.designPending} · 已退役 ${counts.retired}`,
)
