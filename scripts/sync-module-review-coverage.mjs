import { writeFile } from 'node:fs/promises'
import { buildModuleReviewCoverage, MODULE_REVIEW_COVERAGE_PATH, MODULE_REVIEW_INDEX_PATH, renderModuleReviewIndex } from './module-review-coverage.mjs'

const coverage = buildModuleReviewCoverage()
await writeFile(MODULE_REVIEW_COVERAGE_PATH, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8')
await writeFile(MODULE_REVIEW_INDEX_PATH, renderModuleReviewIndex(coverage), 'utf8')
console.log(`模块覆盖索引：${coverage.counts.rootVariants} 路由变体 / ${coverage.counts.surfaces} 子视图 / ${coverage.counts.environmentCases} 宿主用例；不代表运行验收。`)
