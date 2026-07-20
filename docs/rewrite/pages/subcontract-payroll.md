# 工资核算 + 考勤 — 计件制 / 计时制

> 路由: `/subcontract/payroll` · `/subcontract/payroll/:id` · `/subcontract/attendance`
> 页面: `pages/subcontract/payroll/index.vue` · `[...slug].vue` · `attendance.vue`
> 来源: DESIGN-project-worker §9

> ⚠️ **已过时（2026-07-20，#117 进度款域重构定稿）**：本文的「发放比例（班组默认值）」「发放比例递增月度阶梯」「空鼓暂扣」「按工人单据」等口径已被推翻——现行设计为 **负责人请款簿制**（单据主体=负责人+组员多行）、**比例=单据级参数**（默认沿用上月，无预排递增，月份轴含结算95%/尾款100%档）、**三态生命周期**（草稿→已核对→已发放登记实际金额固化）、**空鼓归户**（户记录聚合、进度月只列示、手动启动扣款，暂扣返还废除）、**格式族 A/B/C1/C2**。以 [issue #117](https://github.com/zodea/crm-new/issues/117) 定稿与设计稿 `DC重构设计源码/kit/PayrollScreen.jsx`/`PayrollDetailScreen.jsx` 为准；本文保留作历史留档。

---

## 一、两种计算模式

### 计件制（泥工、木工等）

```
工程金额     = Σ(各分项暂定工程量 × 单价)
+ 房租补贴   = 选定分项工程量合计 × 房租补贴单价
+ 管理提成   = 选定分项工程量合计 × 管理单价
= 应发总额
× 发放比例   （班组默认值，结算时每人可单独调整）
= 本期应发
- 累计已发
- 罚款/扣款
= 实发金额   （取整）
```

### 计时制（杂工等）

```
实发金额 = 出勤天数 × 日薪 - 扣款
```

---

## 二、数据模型（SQLite）

```sql
-- payrolls 表
id                TEXT PRIMARY KEY
crewId            TEXT
projectId         TEXT
workerId          TEXT
month             TEXT           -- yyyy-mm

-- 计件制字段
engineeringAmount REAL           -- 工程金额
rentSubsidy       REAL           -- 房租补贴
managementFee     REAL           -- 管理提成
grossAmount       REAL           -- 应发总额
payRatio          REAL           -- 发放比例
periodAmount      REAL           -- 本期应发
previouslyPaid    REAL           -- 累计已发
deductions        REAL           -- 罚款/扣款
netAmount         REAL           -- 实发金额

-- 计时制字段
daysWorked        REAL
dailyRate         REAL

wageMode          TEXT           -- "piece" | "time"
note              TEXT
createdAt         TEXT
```

```sql
-- attendance 表
id       TEXT PRIMARY KEY
workerId TEXT, crewId TEXT, projectId TEXT
month    TEXT, day INTEGER
status   TEXT           -- "√" | "" | "假" | "迟"
```

```sql
-- worker_crew_config 表（个人级覆盖）
workerId              TEXT
crewProjectConfigId   TEXT
rentSubsidyEnabled    INTEGER   -- null=用班组默认
mgmtFeeEnabled        INTEGER
payRatio              REAL
```

---

## 三、发放比例递增

| 月份 | 比例 | 说明 |
|------|------|------|
| 9月 | 75% | 初期 |
| 11月 | 75% | |
| 1月 | 85% | |
| 4月 | 95% | |
| 结算 | 100% | 每人可单独触发 |

---

## 四、合理性校验

- 计件工人：出勤过少但工资过高 → 标红
- 三级安全教育未录入 → 禁止发放 / 标红
- 计时工人：出勤×日薪 与记录偏差过大 → 警告

---

## 五、Excel 导出

格式复刻现有 Excel 结构（4 sheet）：
1. **班组进度款审批表**：项目信息 + 申请金额 + 审批签名栏
2. **工程量进度清单**：按户列分项明细，金额列 `=工程量×单价` 公式
3. **工资表**：姓名/应发/借支/实发 + 银行卡
4. **考勤表**：31天网格

汇总行用 SUM 公式引用，比例行用乘法公式引用，不写死数值。
