// #431/#415：旧条款的承接与证据索引。业务规则仍以 sources 指向的当前 Issue / 权威源为准。
const issue = number => `https://github.com/zodea/crm-new/issues/${number}`
const ocrCases = ['C-BB86590D3657']
const migrationCases = ['C-C29F7C10B9DD', 'C-BE26E05F3A13']
const paymentCases = ['C-657D1D14B279', 'C-935D8BBFAAD3', 'C-FBC35074E915', 'C-8E3938597EF8']
const factorCases = ['C-E7B39219B91A']
const scheduleCases = ['C-BF25FD114CFC', 'C-439AC7326E15', 'C-00E0EA0DAD9D', 'C-B08165B1191F']
const quantityCases = ['C-D5B7E5570149', 'C-DF7B130B33EE', 'C-5BF5E8DBAFCE', 'C-773254DBB2C2', 'C-65CCC6704277', 'C-B00376092557']
const targetCostCases = ['C-050232A62894', 'C-F06D8D7FCF2C', 'C-CF708A06FEBF', 'C-73665550F1A0']
const payrollCases = ['C-9C98D806E9B1', 'C-D8B07FE3B973', 'C-A7B5F1FDD485']
const payrollACases = [...payrollCases, 'C-D3A1780D1250', 'C-D5D665364A7D']
const payrollC1Cases = ['C-0E290F34471B', 'C-0691840A9820', 'C-47E400CBBB0A', 'C-E648A9E95DCF', 'C-35235DAEA64C', 'C-B1D7348A13D7', 'C-72AAED4C3E21', 'C-54E1EDEB0DBF', 'C-F0F7F41C11C4', 'C-95C49C34C8F0', 'C-10C2AA2AC212', 'C-8760F1D1B19E', 'C-99C11727D5D7', 'C-849CF779D9ED', 'C-CBC81AEE97F5', 'C-322F46461EF5']
const attendanceCase = 'C-5751CF6E9985'
const dayworkCase = 'C-7C09C38C854D'
const dayworkSourceCases = [dayworkCase, 'C-F321AEE350E2', 'C-CEFA1670113E', 'C-C6E57C75225C', 'C-4E7BED6AE9DA', 'C-A21C11503422', 'C-B0DA896B3807', 'C-0E654B31211D', 'C-ADC317B48CA4']
const dayworkRecoveryCases = ['C-594F40D6BE59', 'C-1CAAA545F624', 'C-B2469624AF0D', 'C-65BE9FFA2F29', 'C-F1C43DB55904']
const dayworkCentralCases = [...dayworkSourceCases, ...dayworkRecoveryCases]
const payrollC2FormCases = ['C-58443F85F115', 'C-BFFE7CD45B24', 'C-7804D6A25527', 'C-2F08A7E49FDB', 'C-11D91C322B49', 'C-BF6534CCC71B', 'C-A18CF6850958', 'C-E7CCAC0D6C7F']
const payrollC2ConfigCases = ['C-F71EB72F1BE7', 'C-857E3A744BD8', 'C-DA8C04A247DF']
const payrollC2StatementCases = ['C-22E59D126DB1', 'C-7573A5075C24', 'C-4D4A46274664', 'C-743E95C94FAD', 'C-819292D2D041']
const payrollC2Cases = [...payrollC2FormCases, ...payrollC2ConfigCases, ...payrollC2StatementCases]
// P4 先登记实际宿主与入口；固定本期提交及验收后再提升义务状态。
const payrollP4Cases = ['C-3CEAC41F56EE', 'C-94E41A26A3CD', 'C-70614BA99381', 'C-1A58A5E04259', 'C-CA15E2E11333', 'C-68C5D0C7AF86', 'C-551B6A68ECCE', 'C-E09119AB5B23', 'C-BD39437F70F6', 'C-6E96061CBD9B', 'C-47DB19B2E589', 'C-E8A2ED8A1BE0', 'C-8F5A9E3126B3', 'C-B0A3DEF4249C', 'C-3F5E6146BE36', 'C-46410C9CE97C', 'C-ED270164311E', 'C-7190764C000E', 'C-65AAA530D948', 'C-C87C1D80EAEB', 'C-EC73DDB08635', 'C-8D26948C2EFF', 'C-3CDEC6A17EDE', 'C-EFED1F86A584', 'C-CF490A18E883', 'C-7C47CBA71307', 'C-9CD9C66FECE2', 'C-F5A2FE6D3CF6', 'C-45DB0DDC7FF6', 'C-FCC5103C718F', 'C-F36CE397D7FB', 'C-D25B508EB174', 'C-3DB9E07F1876', 'C-AA4672C833CB', 'C-0D44B14FF6F4', 'C-58F8C291E313', 'C-60F79C79C1FD', 'C-374B51B5F091', 'C-6C1FAE8C5A88', 'C-23BF5D82EE43', 'C-C419610B5F84', 'C-BB67195FF9FF', 'C-F66BF98E6C93']
const payrollP4CostCases = ['C-3CEAC41F56EE', 'C-94E41A26A3CD', 'C-70614BA99381', 'C-1A58A5E04259', 'C-CA15E2E11333', 'C-551B6A68ECCE', 'C-E09119AB5B23', 'C-BD39437F70F6', 'C-6E96061CBD9B', 'C-F5A2FE6D3CF6', 'C-45DB0DDC7FF6', 'C-FCC5103C718F']
const progressCases = [...scheduleCases, ...quantityCases, ...targetCostCases]
const wageCases = [...payrollCases, attendanceCase, dayworkCase]
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
  reference: 'docs/design/evidence/issue-432/factor-workbench-verification.md',
  commit: '338eaa978a7e325d6d7f86a9de272476ddfed5ef',
  recency: 'current-run',
  scope: '浏览器本地因子工具的算法、组件与列明浏览器场景；不覆盖其他设置或生产持久化',
}
const payrollEvidence = {
  reference: 'docs/design/evidence/issue-433/payroll-verification.md',
  commit: 'b2f1e2e578bc3db6524fd7bfd67886814fcc38b9',
  recency: 'current-run',
  scope: '本地工资 B 三态只读、C1 来源呈现及工资/考勤/签工返回；不含中央写入、历史迁移或发放调整',
}
const payrollHistoryEvidence = {
  reference: 'docs/design/evidence/issue-412-payroll-history/README.md',
  commit: '1de44da2fdeb8091fb0e2cc2f3bcfd9794e07fc3',
  recency: 'current-run',
  scope: '完整旧工资图及独立配置、考勤、签工接管，中央历史只读、缺损隔离、月锁及来源往返；不含日常核算发放、更正或生产交付',
}
const payrollAEvidence = {
  reference: 'docs/design/evidence/issue-412-payroll-a/README.md',
  commit: 'c4c5b9f2e8398cc6e4dc6b51bd6f844dff9cb91d',
  recency: 'current-run',
  scope: 'A 原施工事实与工资配置、草稿、重核、实发及全成员分配、冻结打印和 XLSX、原来源返回与恢复保护；不含 C1/C2 日常写入、更正、完整成本、费用工作簿或生产保存',
}
const payrollC1Evidence = {
  reference: 'docs/design/evidence/issue-412-payroll-c1/README.md',
  commit: 'fd0a7b6b4ab58eb177eea1db86a069067be92a4a',
  recency: 'current-run',
  scope: '逐日原考勤与个人标准、C1独立工资核对/实发/全成员月锁、原键后读恢复及配对PDF/XLSX；不含C2日常写入、P4–P7或生产部署',
}
const payrollC2Evidence = {
  reference: 'docs/design/evidence/issue-412-payroll-c2/README.md',
  commit: 'f39d8106579ea09cd1335119701ba6105cd22846',
  recency: 'current-run',
  scope: '中央逐日签工与人工确认、项目及负责人主体价和规则、C2唯一来源核对实发、全成员月锁、原提交恢复和工资/签工PDF及XLSX；含C1/C2互斥与迁入保护，不含P4–P7、完整成本消费者或生产保存部署',
}
const homeScheduleEvidence = {
  reference: 'docs/design/evidence/issue-434/README.md',
  commit: '0dd6c91e096789d842cea417cd40a496363fe52e',
  recency: 'current-run',
  scope: '中央项目到未接入排程提示、授权演示工序往返；不含正式排程事实链',
}
const quantityCentralEvidence = {
  reference: 'docs/design/evidence/issue-442/README.md',
  commit: '0a9c37680a02693c6c9a43661cc5e129c38649ea',
  recency: 'current-run',
  scope: '中央区域、模板、三量、阶段与责任完成、照片、报量、导入导出及受控迁移；不代验 WBS、工资和目标成本',
}
const wbsCentralEvidence = {
  reference: 'docs/design/evidence/issue-444/README.md',
  commit: 'ab056768ebf17dd3a2713bb6bc0df37dbb118ba6',
  recency: 'current-run',
  scope: '中央 WBS 建组、计划与依赖、冻结来源、基线、全图接管及阶段往返；新增暂估绑定见 #445，工资和目标成本另验',
}
const bindingCentralEvidence = {
  reference: 'docs/design/evidence/issue-445/README.md',
  commit: '59d5c735414e04b90e2cba7f2f750b6151e697bc',
  recency: 'current-run',
  scope: '已独立提交的暂估绑定、原清单楼栋更正、异常恢复和原楼层返回；前置固定提交见 #444，不含工资、目标成本或生产部署',
}
const targetCostCentralEvidence = {
  reference: 'docs/design/evidence/issue-412-target-cost/README.md',
  commit: 'b64d52240cb4d229dc5458b4009d5a16a982bc3c',
  recency: 'current-run',
  scope: '预算中央版本、科目、附件、唯一基线、完整旧图迁入与原提交恢复；实际成本仅限定已接来源，不代表完整工资、材料、财务或生产交付',
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
    sources: [factorDecision, issue(432)],
    ownerIssue: 432,
    caseIds: factorCases,
    status: 'current-passed',
    evidence: [factorEvidence],
    remaining: '顶部税额、约 330px 左栏、右侧结果及五档响应式已验证；范围仅此工具，未提升 #414 其他页面。',
  },
  {
    id: 'FACTOR-02',
    label: '#204 最终决定：共用含税金额与四项点击复制',
    sources: [factorDecision, issue(432)],
    ownerIssue: 432,
    caseIds: factorCases,
    status: 'current-passed',
    evidence: [factorEvidence],
    remaining: '共用金额、即时税额、四格鼠标/键盘复制及既有配置兼容已验证；配置只保存在当前浏览器。',
  },
  {
    id: 'FACTOR-03',
    label: '#204 最终决定：640/960 与 128640 的 68 解默认示例',
    sources: [factorDecision, issue(432)],
    ownerIssue: 432,
    caseIds: factorCases,
    status: 'current-passed',
    evidence: [factorEvidence],
    remaining: '首次手动求解得到 68 条精确解；两因子不限数量且为整数，默认返回 100，已存旧值、自定义与明确空值均保留。',
  },
  {
    id: 'FACTOR-04',
    label: '#204 精确分整数、包含/排除、结果上限与耗时',
    sources: [factorDecision, issue(432)],
    ownerIssue: 432,
    caseIds: factorCases,
    status: 'current-passed',
    evidence: [factorEvidence],
    remaining: '分值、包含/排除、耗时与超时部分结果经算法回归；浏览器验证返回上限、目标金额一致、短任务反馈及局部滚动，未扩称浏览器全部失败场景通过。',
  },
  {
    id: 'PRG-01',
    label: '#300 AC1 / #347 AC1/4 排程拓扑迁移与中央唯一写入',
    sources: [issue(300), issue(347), 'docs/adr/0020-browser-authority-and-demo-workspace-boundary.md'],
    ownerIssue: 412,
    caseIds: scheduleCases,
    status: 'current-passed',
    evidence: [wbsCentralEvidence, bindingCentralEvidence],
    remaining: '#444/#445 已接管中央分组、任务、依赖、冻结来源、绑定历史及新增绑定，整图迁移、日常写入与危险恢复通过。生产持久化仍归 #416。',
  },
  {
    id: 'PRG-02',
    label: '#300 AC3 / #347 AC2 排程稳定 ID 与后台关系验证',
    sources: [issue(300), issue(347), 'docs/rewrite/pages/schedule-progress.md'],
    ownerIssue: 412,
    caseIds: scheduleCases,
    status: 'current-passed',
    evidence: [wbsCentralEvidence, bindingCentralEvidence],
    remaining: '#444/#445 已验证项目、分组、任务、阶段、依赖、楼栋、合同与原清单行身份及来源往返；来源更正复验原确认导入资格，不按同名对象补配。',
  },
  {
    id: 'PRG-03',
    label: '#300 AC5 / #347 AC3 排程版本冲突与刷新重读',
    sources: [issue(300), issue(347)],
    ownerIssue: 412,
    caseIds: scheduleCases,
    status: 'current-passed',
    evidence: [wbsCentralEvidence, bindingCentralEvidence],
    remaining: '#444/#445 已验证固定预览版本、陈旧来源保稿、未知结果原提交恢复、缓存页签与来源切换保护及冷读；完整成本和工资消费继续单独验收。',
  },
  {
    id: 'PRG-04',
    label: '#300 AC1 / #348 AC1/4 工程量责任、阶段完成与现场量中央化',
    sources: [issue(300), issue(348), 'docs/adr/0010-quantity-matrix-and-construction-record-model.md'],
    ownerIssue: 412,
    caseIds: quantityCases,
    status: 'current-passed',
    evidence: [quantityCentralEvidence],
    remaining: '#442 已接通同一中央区域、模板、责任、阶段完成及现场量，真实 SQLite/HTTP 迁入与浏览器回读通过；责任配置不产生完成。WBS、工资和目标成本继续按各自条款验收。',
  },
  {
    id: 'PRG-05',
    label: '#300 AC3/5 / #348 AC2/3 工程量关系、来源版本与错配反馈',
    sources: [issue(300), issue(348)],
    ownerIssue: 412,
    caseIds: quantityCases,
    status: 'current-passed',
    evidence: [quantityCentralEvidence, wbsCentralEvidence],
    remaining: '#442/#444 已分别验证工程量及排程项目、阶段、任务、分项、楼栋、户关系、陈旧来源、失败保稿和往返；当前适用关联已完成。工资及目标成本消费继续按各自义务验收。',
  },
  {
    id: 'PRG-06',
    label: '#300 AC2 / #348 AC3 缺现场量保持 null 与聚合 completeness',
    sources: [issue(300), issue(348), 'docs/rewrite/pages/subcontract-quantity.md'],
    ownerIssue: 412,
    caseIds: quantityCases,
    status: 'current-passed',
    evidence: [quantityCentralEvidence],
    remaining: '#442 已验证中央三量、按单位汇总、缺项与已知小计、真实零及台账/分类 Excel 回读；不跨数量基准补值。工资和目标成本的消费正确性继续单独验收。',
  },
  {
    id: 'PRG-07',
    label: '#300 AC1 / #349 AC1/4 目标成本迁移和中央正式保存',
    sources: [issue(300), issue(349), 'docs/rewrite/pages/target-cost.md'],
    ownerIssue: 412,
    caseIds: targetCostCases,
    status: 'current-passed',
    evidence: [targetCostCentralEvidence],
    remaining: '预算迁移和中央正式保存的限定范围已独立提交并验证。完整工资、材料和财务实际来源继续按 PRG-08/09/10 和对应领域验收；生产关口归 #416。',
  },
  {
    id: 'PRG-08',
    label: '#300 AC3/5 / #349 AC2 排程、户详情与成本的真实来源聚合',
    sources: [issue(300), issue(349)],
    ownerIssue: 412,
    caseIds: progressCases,
    status: 'partial',
    evidence: [quantityCentralEvidence, wbsCentralEvidence, targetCostCentralEvidence],
    remaining: '#442/#444/#445 已验证排程、绑定与工程量同源下钻及真实阶段聚合；预算已接入限定合同、结算及支付来源，缺源不伪造总余额。完整工资、材料和财务来源尚未接齐，继续明确未知。',
  },
  {
    id: 'PRG-09',
    label: '#300 AC4 / #349 AC3 全上下文往返、深链和局部滚动',
    sources: [issue(300), issue(349), issue(434)],
    ownerIssue: 412,
    caseIds: progressCases,
    status: 'partial',
    evidence: [homeScheduleEvidence, wbsCentralEvidence, targetCostCentralEvidence],
    remaining: '#444/#445 已覆盖正式项目、分组、任务、阶段、楼栋、月、视图、工种、责任户及绑定来源往返；预算已验证稳定版本、项目及当前合同来源返回。工资与尚未接入的材料、财务来源继续逐链验证。',
  },
  {
    id: 'PRG-10',
    label: '#300 AC6 / #347–349 AC5/6 排程工程量成本集成验收与权威文档',
    sources: [issue(300), issue(347), issue(348), issue(349)],
    ownerIssue: 412,
    caseIds: progressCases,
    status: 'partial',
    evidence: [homeScheduleEvidence, quantityCentralEvidence, wbsCentralEvidence, targetCostCentralEvidence],
    remaining: '#442/#444/#445 及预算中央链均完成各自定向契约/组件、五档视口、独立复核、指南/PDF与完整本地检查，见固定证据；完整工资及实际成本来源联验仍待完成，生产可用归 #416。',
  },
  {
    id: 'WAGE-01',
    label: '#301 AC1/3 / #350 AC1/3 B 类生成入口及历史写入保护',
    sources: [issue(301), issue(350), issue(433)],
    ownerIssue: 412,
    caseIds: payrollCases,
    status: 'current-passed',
    evidence: [payrollEvidence],
    remaining: '限定当前本地 B 草稿/已核对/已发放三态只读、新建不再提供 B、公开改价/核对/发放/新输出拒绝；保留原状态与金额。历史迁移报告另列 WAGE-02。',
  },
  {
    id: 'WAGE-02',
    label: '#301 AC1/6 / #350 AC2/4 B 类旧数据可诊断隔离报告',
    sources: [issue(301), issue(350)],
    ownerIssue: 412,
    caseIds: payrollCases,
    status: 'current-passed',
    evidence: [payrollHistoryEvidence],
    remaining: '完整旧图受控接管、B 与缺损记录可诊断隔离、原快照/状态/金额保全及中央只读边界已验证；不把旧 B 改为 A/C1/C2，不开放 B 核算或新输出。其他格式日常命令继续单独实施。',
  },
  {
    id: 'WAGE-03',
    label: '#301 AC2/3 / #351 AC1 A 类只取已完成施工事实和现场量',
    sources: [issue(301), issue(351), 'docs/rewrite/pages/subcontract-payroll.md'],
    ownerIssue: 412,
    caseIds: [...payrollACases, ...quantityCases],
    status: 'current-passed',
    evidence: [payrollAEvidence],
    remaining: 'P1 已验证中央 A 只取原施工完成责任与现场量，缺量/单位/价阻断、真实零保留；工资价独立，重复来源与原快照复算受保护。合同/BOQ 和劳务结算不作为 A 来源，其他格式另验。',
  },
  {
    id: 'WAGE-04',
    label: '#301 AC2/3 / #352 AC1 C1 真实考勤来源与空态',
    sources: [issue(301), issue(352), issue(433)],
    ownerIssue: 412,
    caseIds: [...payrollCases, attendanceCase, ...payrollC1Cases],
    status: 'current-passed',
    evidence: [payrollC1Evidence],
    remaining: 'P2 已验证真实考勤原行、空记录与真实零、个人日薪及独立加班标准和月度核算；无工程量仍可用，费率60.125及工时7.51保真，未配置不补默认记录。',
  },
  {
    id: 'WAGE-05',
    label: '#301 AC2/3 / #353 AC1 C2 仅消费已确认签工',
    sources: [issue(301), issue(353), issue(433)],
    ownerIssue: 412,
    caseIds: [...payrollCases, ...dayworkSourceCases, ...payrollC2FormCases, ...payrollC2ConfigCases, 'C-22E59D126DB1', 'C-7573A5075C24'],
    status: 'current-passed',
    evidence: [payrollEvidence, payrollC2Evidence],
    remaining: 'P3 已验证人工确认原签工及项目×负责人配置进入C2月度核算；待确认、非法或不可证明签工不计薪，无价及已被领用来源不可建可发工资。无工程量或合同仍可登记合法签工，不新增驳回状态或自动确认处罚。',
  },
  {
    id: 'WAGE-06',
    label: '#301 AC6 / #351–353 AC2/4 工资来源、草稿与成员分配中央保存',
    sources: [issue(301), issue(351), issue(352), issue(353)],
    ownerIssue: 412,
    caseIds: [...payrollCases, attendanceCase, ...payrollC1Cases, ...dayworkCentralCases, ...payrollC2Cases],
    status: 'current-passed',
    evidence: [payrollHistoryEvidence, payrollAEvidence, payrollC1Evidence, payrollC2Evidence],
    remaining: 'P0完整原图、P1 A、P2 C1及P3签工/C2日常中央保存、全成员到分分配与唯一实发已验证；原键恢复、同键异文拒绝、C1/C2并发互斥和无签工零成员月锁均有实际证据。限定中央本地验证实例，独立更正及完整成本由P4、生产保存由#416承接。',
  },
  {
    id: 'WAGE-07',
    label: '#352/353 AC3 工资、考勤、签工来源范围恢复',
    sources: [issue(352), issue(353), issue(433)],
    ownerIssue: 412,
    caseIds: [...payrollCases, attendanceCase, ...payrollC1Cases, ...dayworkCentralCases, ...payrollC2Cases],
    status: 'current-passed',
    evidence: [payrollEvidence, payrollHistoryEvidence, payrollC1Evidence, payrollC2Evidence],
    remaining: '旧来源范围及P2 C1返回继续有效；P3原签工、主体配置和原工资ID往返、两类状态多选、冷页原键、迟到读取及KeepAlive保稿已验证。当前权限与采用依据分开，原回执与后续当前状态分别说明，不把原query当实体身份或以旧稿覆盖新事实。',
  },
  {
    id: 'WAGE-08',
    label: '#351 AC3 工程量进入 A 类草稿并恢复原范围',
    sources: [issue(351)],
    ownerIssue: 412,
    caseIds: [...payrollACases, ...quantityCases],
    status: 'current-passed',
    evidence: [payrollAEvidence],
    remaining: 'P1 已验证无历史工资项目从真实工程量进入 A 草稿、原完成来源及楼层返回、同路径筛选/KeepAlive 保稿、未知提交与撤权恢复；不代验 C1/C2 新写态或其他跨域入口。',
  },
  {
    id: 'WAGE-09',
    label: '#301 AC4 / #354 AC1 发放工资与劳务结算成本防双计',
    sources: [issue(301), issue(354), 'docs/rewrite/DATABASE.md'],
    ownerIssue: 412,
    caseIds: [...payrollCases, ...payrollC1Cases, ...payrollC2StatementCases, 'C-BFFE7CD45B24', 'C-BF6534CCC71B', ...payrollP4CostCases],
    status: 'partial',
    evidence: [payrollAEvidence, payrollC1Evidence, payrollC2Evidence],
    remaining: 'P1 A、P2 C1及P3 C2只形成一次真实实发，完整分配不重复加金额，同键重试不重复发放；C2逐条签工唯一领用与下月独立核算已验证。P4 工资实际与五类宿主已接线，待本期提交后固定成本防双计、合同劳务隔离及跨页汇总证据；材料/报销未接齐不宣布项目总额完整。',
  },
  {
    id: 'WAGE-10',
    label: '#301 AC5 / #354 AC2 有符号工资调整与冲销',
    sources: [issue(301), issue(354)],
    ownerIssue: 412,
    caseIds: [...payrollCases, ...payrollP4Cases],
    status: 'ready',
    evidence: [],
    remaining: 'P4 已接线独立核算更正、真实补退、后续工资处理、错记冲销及再纠错，原单不被覆盖；本期尚未有固定提交的验收登记，状态不提前提升。提交后按原子并发、唯一更正链、迁入恢复、原键冷读及各宿主实际证据逐项关闭；已定规则不重新 grill。',
  },
  {
    id: 'WAGE-11',
    label: '#301 AC5 / #354 AC2/3 发放冻结、详情和调整历史',
    sources: [issue(301), issue(354)],
    ownerIssue: 412,
    caseIds: [...payrollCases, ...payrollC1Cases, ...payrollC2StatementCases, 'C-68C5D0C7AF86', 'C-EC73DDB08635', 'C-3CDEC6A17EDE', 'C-CF490A18E883', 'C-7C47CBA71307', 'C-9CD9C66FECE2', 'C-0D44B14FF6F4', 'C-60F79C79C1FD', 'C-374B51B5F091', 'C-6C1FAE8C5A88'],
    status: 'partial',
    evidence: [payrollHistoryEvidence, payrollAEvidence, payrollC1Evidence, payrollC2Evidence],
    remaining: 'P0缺损原文与P1 A、P2 C1、P3 C2原子冻结及回执/来源互证、实际PDF和XLSX已验证；C1工资/考勤、C2工资/签工分别成对，C2长表、精确单价、明确空规则及零分配保真。P4独立调整历史、实际补退与完整成本继续验收，不改写已发原单。',
  },
  {
    id: 'WAGE-12',
    label: '#301 AC6 / #350–354 AC4–6 工资迁移、集成、指南和独立交付',
    sources: [issue(301), issue(350), issue(351), issue(352), issue(353), issue(354)],
    ownerIssue: 412,
    caseIds: [...payrollCases, attendanceCase, ...payrollC1Cases, ...dayworkCentralCases, ...payrollC2Cases],
    status: 'partial',
    evidence: [payrollEvidence, payrollHistoryEvidence, payrollAEvidence, payrollC1Evidence, payrollC2Evidence],
    remaining: 'P0/P1/P2/P3均具固定本地提交及独立复核；P3正常提交检查682文件3964项通过，9个唯一浏览器场景分轮验收，180张有效交互图、12页实际双表输出与14页指南已检查。危险迁入恢复保护已有证据；P4–P7、全模块后续交付及#416生产关口仍分别承接。',
  },
  {
    id: 'WAGE-13',
    label: '#117 D4 工资配置、统一改价与个人例外',
    sources: [issue(117), `${issue(117)}#issuecomment-5015242817`, `${issue(117)}#issuecomment-5015356993`, issue(351)],
    ownerIssue: 412,
    caseIds: [...payrollACases, ...payrollC1Cases, ...payrollC2ConfigCases, 'C-7804D6A25527', 'C-A18CF6850958', 'C-BFFE7CD45B24', 'C-BF6534CCC71B', 'C-7573A5075C24'],
    status: 'current-passed',
    evidence: [payrollAEvidence, payrollC1Evidence, payrollC2Evidence],
    remaining: 'P1 A主体分项与个人价、P2 C1档案日薪优先/缺档兜底/独立加班标准及P3项目×负责人C2主体价已验证。C2正价、停用、缺值与明确空规则分别核对，原精度保留、改价不追改旧冻结；不造C2个人价格或批量改写历史，后续费用及整册仍由P5–P7承接。',
  },
  {
    id: 'WAGE-14',
    label: '#117 D8 / 核对④ 房补与管理费真实来源',
    sources: [issue(117), `${issue(117)}#issuecomment-5015296973`, `${issue(117)}#issuecomment-5016863018`],
    ownerIssue: 412,
    caseIds: wageCases,
    status: 'ready',
    evidence: [],
    remaining: 'P5 保留多条房补、基数和适用分项开关；管理人/费率、公司代管不出管理费单、负价代付及来源审计逐项实施。B 退役不取消 A/C1/C2 仍适用的费用义务。',
  },
  {
    id: 'WAGE-15',
    label: '#117 核对⑥ 户级空鼓销记与人工启动扣款',
    sources: [issue(117), `${issue(117)}#issuecomment-5015344952`],
    ownerIssue: 412,
    caseIds: [...payrollCases, ...quantityCases],
    status: 'ready',
    evidence: [],
    remaining: 'P6 从真实户/分项缺陷及整改记录聚合；进度月先列示，人工开始扣款时按仍未整改数和配置金额计算，置于请款合计后取整前。离职提示、并发销记和已发更正需联验，不恢复暂扣返还。',
  },
  {
    id: 'WAGE-16',
    label: '#117 核对⑧ 批量资金建议与逐单实际发放',
    sources: [issue(117), `${issue(117)}#issuecomment-5018217081`],
    ownerIssue: 412,
    caseIds: payrollCases,
    status: 'ready',
    evidence: [],
    remaining: 'P7 在项目/月多主体批量发放中按剩余应领权重分配资金建议，逐行可改、按簿取整并逐单登记真实发放；零权重、超可发、余数、部分成功和丢响应必须保留各自回执。建议金额不是实际已付。',
  },
  {
    id: 'WAGE-17',
    label: '#117 D8-9 / D9 应付实付对账与完整工作簿',
    sources: [issue(117), `${issue(117)}#issuecomment-5018392493`, 'docs/research/issue-review-2026-09-11/payroll-central-spec-draft.md'],
    ownerIssue: 412,
    caseIds: wageCases,
    status: 'ready',
    evidence: [],
    remaining: 'P7 保留应付、实际支付和差额；亚运城按负责人一册完整周期含月度及结算，未来印按月一册/月目录。实际下载核对各页、明细、冻结来源与合计；单张 A 冻结导出不能替代。',
  },
  {
    id: 'WAGE-18',
    label: '#117 D2 / D8-10 / 核对⑨ 人员状态、楼层及名册资料',
    sources: [issue(117), `${issue(117)}#issuecomment-5018217081`, `${issue(117)}#issuecomment-5018392493`, issue(407)],
    ownerIssue: 412,
    caseIds: [...payrollCases, ...quantityCases],
    status: 'partial',
    evidence: [payrollAEvidence],
    remaining: 'P1 已验证 A 原施工楼层/责任来源及返回定位；当月/往月完整展示、未整改点位、真实在班/离职人数和名册资料输出仍随 P6/P7。名册原事实归 #407，C1/C2 不显示虚构楼层。',
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
