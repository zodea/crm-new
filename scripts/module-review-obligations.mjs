// #431：旧条款的承接与证据索引。业务规则仍以 sources 指向的当前 Issue / 权威源为准。
const issue = number => `https://github.com/zodea/crm-new/issues/${number}`
const ocrCases = ['C-BB86590D3657']
const migrationCases = ['C-C29F7C10B9DD', 'C-BE26E05F3A13']
const paymentCases = ['C-657D1D14B279', 'C-935D8BBFAAD3', 'C-FBC35074E915', 'C-8E3938597EF8']
const factorCases = ['C-E7B39219B91A']
const ocrEvidence = {
  reference: 'docs/design/evidence/issue-429/ocr-settings-recovery-verification.md',
  commit: 'd1432c3ec3d15b0bb3f2864977f50408f3279f96',
  recency: 'current-run',
  scope: 'OCR 设置、状态与失败恢复；不含真实样本准确率',
}
const migrationEvidence = {
  reference: 'docs/design/evidence/issue-430/migration-recovery-verification.md',
  commit: 'c9c0ec5ad044670f4e41ded17e46a6e8d9293d90',
  recency: 'current-run',
  scope: '六类核心身份迁移原五项与恢复故障场景；不含后续领域或生产部署',
}
const paymentEvidence = {
  reference: 'docs/design/evidence/issue-428/settlement-confirmation-verification.md',
  commit: '84c4e5ecbae3c6594f539656ded1db05bbdc83fe',
  recency: 'current-run',
  scope: '已确认结算的候选、事务复验、往期汇总、动态成本及现有付款浏览器回归',
}
const oldMigrationEvidence = {
  reference: `${issue(294)}#issuecomment-5368037755`,
  commit: null,
  recency: 'historical',
  scope: '原核心迁移交付记录；不自动继承为当前全域验收',
}
const factorDecision = `${issue(204)}#issuecomment-5145177434`
const factorEvidence = {
  reference: 'app/pages/finance/invoice/factor.vue',
  commit: 'c9c0ec5ad044670f4e41ded17e46a6e8d9293d90',
  recency: 'source-inspection',
  scope: '仍是三段布局、独立税额输入和教学默认值；只是源码差异证据',
}

export const OBLIGATION_STATUS_LABELS = {
  'current-passed': '本轮限定范围已验证',
  'historical-only': '仅有历史证据',
  'partial': '部分完成，仍有缺口',
  'ready': '已定待实施',
  'needs-decision': '待业务裁定',
}

export const REVIEW_OBLIGATIONS = [
  {
    id: 'OCR-01',
    label: '#204 OCR 入口、导航与整页设置',
    sources: [`${issue(204)}#issuecomment-5090014691`],
    ownerIssue: 414,
    caseIds: ocrCases,
    status: 'current-passed',
    evidence: [ocrEvidence],
    remaining: '仅 OCR 入口及本机设置；不代表 #414 其他工具通过。',
  },
  {
    id: 'OCR-02',
    label: '#204 真实参数、超时边界与服务状态',
    sources: [`${issue(204)}#issuecomment-5247979860`],
    ownerIssue: 414,
    caseIds: ocrCases,
    status: 'current-passed',
    evidence: [ocrEvidence],
    remaining: '验证当前允许设置及真实状态接口边界；不推出识别准确率。',
  },
  {
    id: 'OCR-03',
    label: '#204 保存读回及后续任务取用配置',
    sources: [`${issue(204)}#issuecomment-5247979860`, issue(429)],
    ownerIssue: 414,
    caseIds: ocrCases,
    status: 'current-passed',
    evidence: [ocrEvidence],
    remaining: '沿用本机参数存储，已排队任务的参数不被追改。',
  },
  {
    id: 'OCR-04',
    label: '设置读取/保存失败、并发读取与可控重试',
    sources: [issue(429)],
    ownerIssue: 429,
    caseIds: ocrCases,
    status: 'current-passed',
    evidence: [ocrEvidence],
    remaining: '未成功读取前禁写；失败草稿与重读按钮、并发读取保护均在证据范围内。',
  },
  {
    id: 'OCR-05',
    label: '#108 私有服务配置与只读 GET 状态',
    sources: [issue(108), issue(429)],
    ownerIssue: 406,
    caseIds: ocrCases,
    status: 'current-passed',
    evidence: [ocrEvidence],
    remaining: 'Token/API URL 不进入前端；固定模型名称只读可见，已同步冲突文档。',
  },
  {
    id: 'OCR-06',
    label: '#108 真实样本字段与行项目质量核验',
    sources: [`${issue(108)}#issuecomment-5248732124`],
    ownerIssue: 406,
    caseIds: ocrCases,
    status: 'partial',
    evidence: [{ reference: `${issue(108)}#issuecomment-5248732124`, commit: null, recency: 'historical', scope: '既有边界与代表样本运行记录；没有完整字段/行项目真值核验' }],
    remaining: '补齐样本真值和字段/行项目逐项对照；设置回归不能替代样本质量验收。',
  },
  {
    id: 'MIG-01',
    label: '#294 AC1 显式预检、备份、试跑、对账与确认/回滚',
    sources: [issue(294)],
    ownerIssue: 414,
    caseIds: migrationCases,
    status: 'current-passed',
    evidence: [migrationEvidence],
    remaining: '仅六类核心身份；不在应用启动时自动迁移。',
  },
  {
    id: 'MIG-02',
    label: '#294 AC2 拓扑稳定 ID 映射与幂等重试',
    sources: [issue(294)],
    ownerIssue: 414,
    caseIds: migrationCases,
    status: 'current-passed',
    evidence: [migrationEvidence, oldMigrationEvidence],
    remaining: '客户、分供方、班组、工人、项目和项目分供方；不外推后续领域。',
  },
  {
    id: 'MIG-03',
    label: '#294 AC3 缺 canonical 关系报告、不模糊补配',
    sources: [issue(294)],
    ownerIssue: 414,
    caseIds: migrationCases,
    status: 'current-passed',
    evidence: [migrationEvidence, oldMigrationEvidence],
    remaining: '当前核心迁移的 missing-relation 场景；不按名称等推断关系。',
  },
  {
    id: 'MIG-04',
    label: '#294 AC4 数量、金额、引用、软删除与孤儿对账',
    sources: [issue(294)],
    ownerIssue: 414,
    caseIds: migrationCases,
    status: 'current-passed',
    evidence: [migrationEvidence, oldMigrationEvidence],
    remaining: '报告定位核心实体/旧 ID/命令/原因；不代表全库所有业务金额完成对账。',
  },
  {
    id: 'MIG-05',
    label: '#294 AC5 已接管核心身份只读写中央，旧库受保护',
    sources: [issue(294), 'docs/adr/0020-browser-authority-and-demo-workspace-boundary.md'],
    ownerIssue: 414,
    caseIds: migrationCases,
    status: 'current-passed',
    evidence: [migrationEvidence],
    remaining: '仅当前已接管核心身份边界；未接管域仍按 ADR 0020，生产恢复归 #416。',
  },
  {
    id: 'MIG-06',
    label: '#294 AC6 浏览器刷新、失败回滚与原始快照恢复',
    sources: [issue(294), issue(430)],
    ownerIssue: 430,
    caseIds: migrationCases,
    status: 'current-passed',
    evidence: [migrationEvidence],
    remaining: '包含本机恢复失败后禁止新迁移、原字节重试，以及刷新切换落地失败的 store 回归。',
  },
  {
    id: 'MIG-07',
    label: '#372 AC1–4 全域迁移、中央正式来源和演示只读隔离',
    sources: [issue(372), issue(405)],
    ownerIssue: 415,
    caseIds: migrationCases,
    status: 'partial',
    evidence: [migrationEvidence, paymentEvidence],
    remaining: '核心与部分领域已有实现；普通财务等领域中央闭环及全域集成未完成，不能沿用核心六类证据宣告通过。',
  },
  {
    id: 'MIG-08',
    label: '#372 AC5–6 全域视口、回归、双轴复核与交付',
    sources: [issue(372)],
    ownerIssue: 415,
    caseIds: migrationCases,
    status: 'partial',
    evidence: [migrationEvidence, ocrEvidence, paymentEvidence],
    remaining: '仅本轮各独立切片有运行和复核结果；全域集成及远端交付未完成，生产关口另归 #416。',
  },
  {
    id: 'PAY-01',
    label: '#203 AC2 / #303 AC2 / #358 AC2 付款引用真实 ID 与有效结算',
    sources: [issue(203), issue(303), issue(358)],
    ownerIssue: 413,
    caseIds: paymentCases,
    status: 'partial',
    evidence: [paymentEvidence],
    remaining: '#428 已验证结算候选与保存确认状态；发票、支付分摊及全部中央身份链仍需分别验收。',
  },
  {
    id: 'PAY-02',
    label: '#116 / #303 AC2 无效结算保存不得产生部分行',
    sources: [issue(116), issue(303), issue(428)],
    ownerIssue: 428,
    caseIds: paymentCases.slice(0, 2),
    status: 'current-passed',
    evidence: [paymentEvidence],
    remaining: '本次限定本地现有付款事务复验；中央 command 原子性由 #413 承接。',
  },
  {
    id: 'PAY-03',
    label: '#203 / #303 付款往期事实、余额与合同动态成本',
    sources: [issue(203), issue(303), issue(428)],
    ownerIssue: 413,
    caseIds: paymentCases,
    status: 'partial',
    evidence: [paymentEvidence],
    remaining: '已确认结算的往期金额和成本口径已验证；历史批复金额语义、完整付款/支付余额链仍待处理。',
  },
  {
    id: 'PAY-04',
    label: '#116 / #303 结算、发票分摊守恒与银行实际支付分离',
    sources: [issue(116), issue(303)],
    ownerIssue: 413,
    caseIds: paymentCases,
    status: 'partial',
    evidence: [paymentEvidence],
    remaining: '既有本地边界回归只是部分证据；全部合同类型、中央来源与实际支付守恒链待验证。',
  },
  {
    id: 'PAY-05',
    label: '#303 AC1/5 / #358 AC1/4 中央正式保存、迁移、409 与断网草稿',
    sources: [issue(303), issue(358)],
    ownerIssue: 413,
    caseIds: paymentCases,
    status: 'ready',
    evidence: [],
    remaining: '普通付款表单尚未闭合中央写入、幂等、冲突、权限和刷新；不能用详情中央只读或本地测试证明完成。',
  },
  {
    id: 'PAY-06',
    label: '#303 AC3/4 / #364 AC1–3 专属详情、缺源、穿透返回与视口',
    sources: [issue(303), issue(364)],
    ownerIssue: 413,
    caseIds: paymentCases,
    status: 'partial',
    evidence: [paymentEvidence],
    remaining: '#428 仅现有付款/成本的浏览器回归；#364 的 11 条支出和 4 条发票路由、全部来源及返回未逐项通过。',
  },
  {
    id: 'PAY-07',
    label: '新批复金额 null/明确零语义及历史来源标记',
    sources: [issue(413), 'docs/rewrite/DATABASE.md', 'docs/rewrite/READ-MODELS.md'],
    ownerIssue: 413,
    caseIds: paymentCases,
    status: 'ready',
    evidence: [],
    remaining: '新值可空与零不回退、旧值不可推断及来源标记可直接实施；不得从历史状态或整表保存猜测批复。',
  },
  {
    id: 'PAY-08',
    label: '历史批复零值含义不明时的新付款确认策略',
    sources: [`${issue(413)}#issuecomment-5616431545`],
    ownerIssue: 413,
    caseIds: paymentCases,
    status: 'needs-decision',
    evidence: [],
    remaining: '$grill 已登记：补核批复后确认，或带异常继续确认的限额与责任；保留已发生支付事实，不以技术选择代替业务决定。',
  },
  {
    id: 'FACTOR-01',
    label: '#204 最终决定：税额顶栏、左因子右结果',
    sources: [factorDecision],
    ownerIssue: 414,
    caseIds: factorCases,
    status: 'ready',
    evidence: [factorEvidence],
    remaining: '当前三段布局与蓝本均待同步；桌面左栏约 330px，窄屏按响应式叠放。',
  },
  {
    id: 'FACTOR-02',
    label: '#204 最终决定：共用含税金额与四项点击复制',
    sources: [factorDecision],
    ownerIssue: 414,
    caseIds: factorCases,
    status: 'ready',
    evidence: [factorEvidence],
    remaining: '税额与求解目标仍是独立输入；合并后保留既有用户保存的求解配置。',
  },
  {
    id: 'FACTOR-03',
    label: '#204 最终决定：640/960 与 128640 的 68 解默认示例',
    sources: [factorDecision],
    ownerIssue: 414,
    caseIds: factorCases,
    status: 'ready',
    evidence: [factorEvidence],
    remaining: '仅首次使用采用开票量级默认值；不能覆盖自定义配置，两因子均不限数量且用整数数量。',
  },
  {
    id: 'FACTOR-04',
    label: '#204 精确分整数、包含/排除、结果上限与耗时',
    sources: [factorDecision],
    ownerIssue: 414,
    caseIds: factorCases,
    status: 'historical-only',
    evidence: [{ reference: factorDecision, commit: null, recency: 'historical', scope: '保留既有精确组合算法的已定决定；当前布局修改后仍需实际回归' }],
    remaining: '已有算法和测试；本轮新布局、共用金额与结果表的局部滚动尚未验收。',
  },
]

export function validateReviewObligations(obligations, cases) {
  const ids = new Set()
  const caseById = new Map(cases.map(item => [item.id, item]))
  for (const obligation of obligations) {
    if (ids.has(obligation.id))
      throw new Error(`module-review-coverage: 重复验收义务 ${obligation.id}`)
    ids.add(obligation.id)
    if (!Object.hasOwn(OBLIGATION_STATUS_LABELS, obligation.status))
      throw new Error(`module-review-coverage: 未知义务状态 ${obligation.id}/${obligation.status}`)
    if (!obligation.sources.length || !obligation.caseIds.length || !obligation.ownerIssue)
      throw new Error(`module-review-coverage: 义务缺少来源、用例或承接 ${obligation.id}`)
    for (const caseId of obligation.caseIds) {
      if (caseById.get(caseId)?.host !== 'browser')
        throw new Error(`module-review-coverage: 义务缺少适用浏览器用例 ${obligation.id}/${caseId}`)
    }
    if (obligation.status === 'current-passed' && !obligation.evidence.some(item => item.recency === 'current-run' && /^[a-f0-9]{40}$/.test(item.commit ?? '')))
      throw new Error(`module-review-coverage: 义务通过却无固定提交的本轮证据 ${obligation.id}`)
  }
}
