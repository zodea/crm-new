<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { TreeNode } from '~/lib/kit/tree-nav'
import { useTimeoutFn } from '@vueuse/core'
import { Button } from '~/components/ui/button'
import { toErrorMessage } from '~/lib/util/error'

// 隐藏 dev 演示路由（不在侧边栏 NAV_GROUPS 中）：逐一验证 KitUI 原语。
// 访问 /dev/kit-ui（ripple 已全域废弃，见 ADR 0004，不提供演示）
const kit = useKitUI()

const lastResult = shallowRef('（尚无操作）')
const rowDialogOpen = ref(false)
const ROW_DIALOG_SECTIONS = [
  { key: 'base', label: '分项信息' },
  { key: 'pricing', label: '计价信息' },
  { key: 'remark', label: '补充说明' },
]

// ① 系统/结果提示（expand 道，右上）
function demoSemantic() {
  kit.success('保存成功', '项目「合和新城」已更新')
  setTimeout(() => kit.info('这是一条系统提示'), 300)
  setTimeout(() => kit.warning('请填写必填项'), 600)
  setTimeout(() => kit.error('网络请求失败', '请检查连接后重试'), 900)
}

function fakeAsync(ms: number, ok = true) {
  return new Promise<boolean>((resolve, reject) =>
    setTimeout(() => (ok ? resolve(true) : reject(new Error('failed'))), ms),
  )
}

// ② 过程提示（collapse 重叠道，右下）
function demoUploadPromise() {
  kit.promise(fakeAsync(2200), {
    loading: '正在上传发票…',
    success: '发票上传完成',
    error: '上传失败，请重试',
  })
}

function demoRecognize() {
  const id = kit.loading('正在识别送货单…')
  let n = 0
  const timer = setInterval(() => {
    n += 25
    if (n >= 100) {
      clearInterval(timer)
      kit.updateToast(id, { type: 'success', message: '识别完成 · 共 8 条', duration: 3000 })
    }
    else {
      kit.updateToast(id, { message: `正在识别送货单… ${n}%` })
    }
  }, 500)
}

function demoProcessPile() {
  const files = ['发票_001.pdf', '发票_002.pdf', '发票_003.pdf', '发票_004.pdf', '发票_005.pdf']
  files.forEach((f, i) => {
    setTimeout(() => {
      kit.promise(fakeAsync(2000 + i * 600, i !== 3), {
        loading: `上传 ${f}…`,
        success: `${f} 已上传`,
        error: `${f} 上传失败`,
      })
    }, i * 260)
  })
}

// ③ undoToast（system 道）
function demoUndoToast() {
  lastResult.value = '已软删除 1 条记录，10 秒内可撤回'
  kit.undoToast('已删除「测试项目」', () => {
    lastResult.value = '记录已恢复到原位置'
  })
}

// ④ confirm 三档（ADR 0003）
// simple：高后果轻量操作（归档后修改）→ 点确认立即关窗交 toast
async function demoConfirmSimple() {
  const ok = await kit.confirm({
    variant: 'simple',
    title: '修改已归档发票',
    message: '该发票已归档入账，修改会影响项目票据统计。确认继续修改？',
    confirmLabel: '继续修改',
  })
  lastResult.value = `simple confirm 返回：${ok}`
  if (ok)
    kit.success('已进入编辑')
}

// batch：批量删除 → 显示「将删除 N 条」，点确认立即关窗，事后弹 10 秒 undoToast
async function demoConfirmBatch() {
  const ok = await kit.confirm({
    variant: 'batch',
    title: '批量删除发票',
    message: '删除后可在 10 秒内撤回整批。',
    count: 12,
    confirmLabel: '删除',
  })
  lastResult.value = `batch confirm 返回：${ok}`
  if (ok) {
    kit.undoToast('已删除 12 张发票', () => {
      lastResult.value = '整批已恢复'
    })
  }
}

// cascade：删有下游关联的父级 → 打名激活 + ≥3 秒预提交挂起 + 无事后 undoToast
async function demoConfirmCascade() {
  const ok = await kit.confirm({
    variant: 'cascade',
    title: '删除分供方',
    message: '「华东建材」挂着多份合同与材料、发票记录，删除将一并隐藏其下游数据。',
    requireTyping: '华东建材',
    impact: [
      { label: '合同', n: 3 },
      { label: '材料', n: 12 },
      { label: '发票', n: 8 },
    ],
    confirmLabel: '删除',
  })
  lastResult.value = `cascade confirm 返回：${ok}（true=挂起期满提交 / false=撤销）`
  if (ok)
    kit.success('已删除「华东建材」及其下游')
}

// ⑤ formModal
async function demoFormModal() {
  const values = await kit.formModal({
    title: '新增分供方',
    subtitle: '带 * 的为必填项',
    cols: 2,
    fields: [
      { key: 'name', label: '公司全称', required: true, placeholder: '如：广州瑞航建材' },
      { key: 'category', label: '类别', type: 'select', required: true, options: ['材料', '劳务', '设备'] },
      { key: 'taxNo', label: '统一社会信用代码', placeholder: '选填' },
      { key: 'capital', label: '注册资本（万元）', type: 'number' },
      { key: 'remark', label: '备注', type: 'textarea', full: true, placeholder: '选填' },
    ],
  })
  lastResult.value = values
    ? `formModal 提交：${JSON.stringify(values)}`
    : 'formModal 已取消（返回 null）'
  if (values)
    kit.success('分供方已创建')
}

// W2-3 typeSelect 业务类型选择（#95）
const PAYMENT_APPLICATION_TYPE_OPTIONS = [
  { value: 'contract-labor-material', label: '有合同（人材料分包）付款申请', hint: '关联合同、结算额度与发票' },
  { value: 'no-contract-labor-material', label: '无合同（人材料分包）付款申请' },
  { value: 'contract-labor-advance', label: '有合同（人分包）预付款申请' },
  { value: 'contract-material-advance', label: '有合同（材料）预付款申请' },
  { value: 'no-contract-material-advance', label: '无合同（材料）预付款申请' },
  { value: 'project-management-fee', label: '项目（管理费）付款申请' },
  { value: 'project-expense', label: '项目（项目费用）付款申请' },
  { value: 'company-payment', label: '公司付款申请' },
] as const

async function demoTypeSelect() {
  const value = await kit.typeSelect({
    title: '新建付款申请',
    options: PAYMENT_APPLICATION_TYPE_OPTIONS,
    defaultValue: 'contract-labor-material',
  })
  lastResult.value = value
    ? `typeSelect 确定返回：${value}`
    : 'typeSelect 已取消（返回 null）'
}

// ⑥ 单文件直接保存（ADR 0004）
async function demoDirectExport() {
  try {
    const result = await kit.exportFile({
      data: `瑞航 CRM 导出演示\n生成时间：${new Date().toLocaleString('zh-CN')}\n`,
      defaultName: '瑞航CRM-导出演示.txt',
      mimeType: 'text/plain;charset=utf-8',
    })
    lastResult.value = result.status === 'cancelled'
      ? '直接保存已取消（未写入文件）'
      : `直接保存完成：${result.displayPath}`
  }
  catch (error) {
    lastResult.value = `直接保存失败：${toErrorMessage(error)}`
  }
}

// ⑦ KitButton 三态（#75）
const demoSubmitLoading = shallowRef(false)
const demoSubmitCount = shallowRef(0)
const demoSaveLoading = shallowRef(false)
const demoSaveSuccess = shallowRef(false)

const { start: finishDemoSubmit } = useTimeoutFn(() => {
  demoSubmitLoading.value = false
}, 900, { immediate: false })

const { start: finishDemoSave } = useTimeoutFn(() => {
  demoSaveLoading.value = false
  demoSaveSuccess.value = true
}, 650, { immediate: false })

function demoKitButtonLoading() {
  if (demoSubmitLoading.value)
    return
  demoSubmitCount.value += 1
  demoSubmitLoading.value = true
  finishDemoSubmit()
}

function demoKitButtonSuccess() {
  if (demoSaveLoading.value || demoSaveSuccess.value)
    return
  demoSaveLoading.value = true
  finishDemoSave()
}

// W2-1 LookupSelect 检索下拉（#93）
const demoLookupId = shallowRef<string | null>(null)
const demoLookupOptions = [
  { id: 'project-chebei', label: '车陂全流程项目', hint: '广州市天河区' },
  { id: 'project-yuzhu', label: '鱼珠项目', hint: '广州市黄埔区' },
  { id: 'project-nansha', label: '南沙产业园', hint: '广州市南沙区' },
]

async function fetchDemoLookup(keyword: string) {
  await new Promise(resolve => setTimeout(resolve, 300))
  const normalized = keyword.trim().toLocaleLowerCase()
  return normalized
    ? demoLookupOptions.filter(option =>
        `${option.label}${option.hint}`.toLocaleLowerCase().includes(normalized),
      )
    : demoLookupOptions
}

function demoLookupCreate() {
  lastResult.value = 'LookupSelect 抛出 create，由业务页面接管新建流程'
}

// W2-4 FormFooter 保存动作组（#96）
type DemoFormAction = 'cancel' | 'draft' | 'saveNew' | 'saveSubmit' | 'save'
const demoFormDirty = shallowRef(false)
const demoCloseAfterSave = shallowRef(false)
const demoFormLoading = shallowRef<DemoFormAction | null>(null)

const { start: finishDemoFormAction } = useTimeoutFn(() => {
  demoFormLoading.value = null
}, 800, { immediate: false })

function handleDemoFormAction(action: DemoFormAction) {
  lastResult.value = `FormFooter action：${action}；保存后关闭：${demoCloseAfterSave.value}`
  if (action === 'cancel')
    return

  demoFormLoading.value = action
  finishDemoFormAction()
}

// W2-5 ListShell 列表页模板（#97）
const demoListTreeKey = shallowRef('all')
const demoListViewKey = shallowRef('all')
const demoListRows = [
  { id: 'contract-1', name: '施工总承包合同', status: 'active', owner: '我', amount: 32388422.52 },
  { id: 'contract-2', name: '精装修材料采购合同', status: 'active', owner: '团队', amount: 19393316.46 },
  { id: 'contract-3', name: '旧设备租赁合同', status: 'paused', owner: '我', amount: 682000 },
  { id: 'contract-4', name: '临时仓库租赁合同', status: 'void', owner: '团队', amount: 240000 },
  { id: 'contract-5', name: '历史维护合同', status: 'terminated', owner: '团队', amount: 96000 },
]
const demoListTree: TreeNode[] = [
  { key: 'all', label: '全部合同', count: demoListRows.length, icon: 'i-lucide-files' },
  { key: 'active', label: '履约', count: 2, icon: 'i-lucide-circle-check', tone: 'brand' },
  { key: 'paused', label: '中止', count: 1, icon: 'i-lucide-circle-pause', tone: 'warn' },
  { key: 'void', label: '废除', count: 1, icon: 'i-lucide-ban' },
  { key: 'terminated', label: '终止', count: 1, icon: 'i-lucide-circle-off' },
]
const demoListViews = [
  { key: 'all', label: '全部视图' },
  { key: 'mine', label: '我负责的' },
]
const demoListColumns: KitTableColumn[] = [
  { type: 'seq', title: '#', width: 52 },
  { field: 'name', title: '合同名称', minWidth: 220 },
  { field: 'status', title: '合同状态', width: 100 },
  { field: 'owner', title: '负责人', width: 90 },
  { field: 'amount', title: '变更后合同金额', type: 'money', width: 170 },
]
const visibleDemoListRows = computed(() => demoListRows.filter(row =>
  (demoListTreeKey.value === 'all' || row.status === demoListTreeKey.value)
  && (demoListViewKey.value === 'all' || row.owner === '我'),
))
const demoListSummary = computed(() => ({
  变更后合同金额总和: visibleDemoListRows.value.reduce((sum, row) => sum + row.amount, 0),
  合同数量: visibleDemoListRows.value.length,
  当前视图: demoListViews.find(view => view.key === demoListViewKey.value)?.label ?? '全部视图',
}))

// ⑧ 需分类的多文件导出（ADR 0004 / #80）
async function demoConfiguredExport() {
  try {
    const result = await kit.exportFile({
      requiresDirectoryStructure: true,
      source: {
        label: '分供方采购合同',
        fields: [
          { key: 'projectName', label: '项目名称' },
          { key: 'contractType', label: '合同类别' },
          { key: 'supplierName', label: '分供方' },
          { key: 'contractNo', label: '合同编号' },
        ],
        files: [
          {
            row: {
              projectName: '滨江壹号',
              contractType: '材料采购',
              supplierName: '华东建材',
              contractNo: 'CG-2026-001',
            },
            data: '滨江壹号｜华东建材｜采购合同 CG-2026-001',
            mimeType: 'text/plain;charset=utf-8',
          },
          {
            row: {
              projectName: '滨江壹号',
              contractType: '设备采购',
              supplierName: '南方设备',
              contractNo: 'CG-2026-002',
            },
            data: '滨江壹号｜南方设备｜采购合同 CG-2026-002',
            mimeType: 'text/plain;charset=utf-8',
          },
        ],
      },
      structure: {
        levels: [{ field: 'projectName' }, { field: 'contractType' }],
      },
      naming: {
        parts: [{ field: 'supplierName' }, { field: 'contractNo' }],
        separator: '_',
        extension: 'txt',
      },
    })

    lastResult.value = result.status === 'opened'
      ? `配置导出页签已打开：${result.id}`
      : '配置导出被页签上限阻断'
  }
  catch (error) {
    lastResult.value = `配置导出打开失败：${toErrorMessage(error)}`
  }
}

// ⑨ 导入映射页签（ADR 0005 / #81）：演示实体的模板见 lib/kit/import-entities.ts
async function demoImportMapping() {
  try {
    const result = await kit.openImportTab({ entity: 'demo-supplier' })
    lastResult.value = result.status === 'opened'
      ? `导入映射页签已打开：${result.fullPath}`
      : '导入映射被页签上限阻断'
  }
  catch (error) {
    lastResult.value = `导入映射打开失败：${toErrorMessage(error)}`
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto py-4">
    <DevPreviewNav />
    <header class="mb-5">
      <div class="flex items-center gap-2">
        <span class="i-lucide-flask-conical text-16px text-brand" />
        <h1 class="text-16px font-800 text-ink">
          KitUI 原语演示
        </h1>
        <span class="chip text-9px bg-warn-soft text-warn-ink">DEV ONLY</span>
      </div>
      <p class="text-12px text-ink-soft mt-1">
        隐藏路由 <code class="text-11px bg-surface-3 px-1 py-0.5">/dev/kit-ui</code>，
        toast 已改 Sonner 风格双泳道。
      </p>
      <p class="text-11px text-ink-faint mt-2">
        <span class="i-lucide-info text-12px mr-0.5" />
        ripple（蓝色水波动效）已全域废弃（ADR 0004），不再实现。
      </p>
    </header>

    <div class="space-y-3">
      <!-- ① 系统/结果提示 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ① 系统/结果提示 — expand 道（右上，展开可读）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          系统消息、确认后的结果类走这里：右上角展开堆叠、语义色图标、hover 暂停自动消失。
        </p>
        <button class="btn-secondary" @click="demoSemantic">
          连发 4 条（成功/提示/警告/错误）
        </button>
      </section>

      <!-- ② 过程提示 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ② 过程提示 — collapse 道（右下，重叠省空间）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          上传/识别等界面交互反馈走这里：右下角重叠堆叠不占地方，<b>鼠标悬停自动展开</b>。含 HeroUI 式 promise/loading（转圈 → 自动变成功/失败）。
        </p>
        <div class="flex flex-wrap gap-2">
          <button class="btn-secondary" @click="demoUploadPromise">
            上传发票（promise）
          </button>
          <button class="btn-secondary" @click="demoRecognize">
            识别送货单（loading→进度→成功）
          </button>
          <button class="btn-secondary" @click="demoProcessPile">
            连发 5 条（看重叠 + 悬停展开）
          </button>
        </div>
      </section>

      <!-- ③ undoToast -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ③ undoToast — 软删除 10 秒撤回（expand 道）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          10 秒内点「撤回」执行回调并弹「已撤回」；超时自动消失、不回调（ADR 0003 撤回时长）。
        </p>
        <button class="btn-danger" @click="demoUndoToast">
          软删除（可撤回）
        </button>
      </section>

      <!-- ④ confirm 三档 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ④ confirm — 三档确认弹窗（ADR 0003）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          只服务「不可撤回 / 高杀伤 / 批量」操作。<b>simple</b>=高后果轻量（归档后修改）；
          <b>batch</b>=批量删除（看清条数 + 事后 10 秒撤回）；
          <b>cascade</b>=删有下游关联的父级（打记录名激活 + ≥3 秒预提交挂起、期间可撤销、无事后撤回）。
          取消默认聚焦、Esc/点遮罩=取消。
        </p>
        <div class="flex flex-wrap gap-2">
          <button class="btn-secondary" @click="demoConfirmSimple">
            simple（归档后修改）
          </button>
          <button class="btn-secondary" @click="demoConfirmBatch">
            batch（批量删除 12 条）
          </button>
          <button class="btn-danger" @click="demoConfirmCascade">
            cascade（删分供方 · 打名+挂起）
          </button>
        </div>
      </section>

      <!-- ⑤ formModal -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ⑤ formModal — 字段配置驱动 + 必填校验
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          fields 配置渲染控件；缺必填项标红拦截提交；提交返回值对象，取消返回 null。
        </p>
        <button class="btn-secondary" @click="demoFormModal">
          打开表单弹窗
        </button>
      </section>

      <!-- W2-3 typeSelect -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          W2-3 typeSelect — 业务类型选择弹窗（#95）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          付款申请 8 类单选范本；支持双击确定、方向键移动与 Enter 确定，取消、Esc 和遮罩关闭都返回 null。
        </p>
        <button class="btn-secondary" @click="demoTypeSelect">
          新建付款申请
        </button>
      </section>

      <!-- ⑤-b FormDialog：ADR 0014 仅保留给行级小对象/兜底 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ⑤-b FormDialog — 行级小对象响应式兜底
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          仅演示清单分项等行级小对象；业务实体新增/编辑按 ADR 0014 使用整页表单。
        </p>
        <button class="btn-secondary" @click="rowDialogOpen = true">
          打开行级对象弹窗
        </button>
        <FormDialog
          :open="rowDialogOpen"
          title="编辑清单分项"
          :sections="ROW_DIALOG_SECTIONS"
          @cancel="rowDialogOpen = false"
          @save="rowDialogOpen = false"
        >
          <section id="form-section-base" class="mb-6">
            <h3 class="field-group-title">
              分项信息
            </h3>
            <div class="form-dialog-demo-grid grid grid-cols-2 gap-3">
              <label>
                <span class="field-label">分项名称</span>
                <input class="field-input w-full" value="轻钢龙骨隔墙">
              </label>
              <label>
                <span class="field-label">单位</span>
                <input class="field-input w-full" value="㎡">
              </label>
            </div>
          </section>
          <section id="form-section-pricing" class="mb-6">
            <h3 class="field-group-title">
              计价信息
            </h3>
            <div class="form-dialog-demo-grid grid grid-cols-2 gap-3">
              <label>
                <span class="field-label">数量</span>
                <input class="field-input w-full" type="number" value="120">
              </label>
              <label>
                <span class="field-label">含税单价</span>
                <input class="field-input w-full" type="number" value="86">
              </label>
            </div>
          </section>
          <section id="form-section-remark">
            <h3 class="field-group-title">
              补充说明
            </h3>
            <div class="form-dialog-demo-grid grid grid-cols-2 gap-3">
              <label class="col-span-2">
                <span class="field-label">备注</span>
                <textarea class="field-input min-h-18 w-full">样板层复核后施工</textarea>
              </label>
            </div>
          </section>
        </FormDialog>
      </section>

      <!-- ⑥ 单文件直接保存 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ⑥ exportFile — 单文件直接保存（ADR 0004）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          桌面端打开系统目录选择器并真实写盘；支持目录访问 API 的浏览器写入所选文件夹，其他浏览器降级到浏览器下载文件夹。取消时静默结束。
        </p>
        <button class="btn-secondary" @click="demoDirectExport">
          直接保存演示文件
        </button>
      </section>

      <!-- ⑦ KitButton 三态 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ⑦ KitButton — 提交按钮三态（#75）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          loading 立即禁用并锁定宽度，保留原文字 + 前置 spinner；success 打勾仅供无其他结果反馈的原地保存显式启用。
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <KitButton :loading="demoSubmitLoading" @click="demoKitButtonLoading">
            模拟提交
          </KitButton>
          <KitButton
            v-model:success="demoSaveSuccess"
            :loading="demoSaveLoading"
            variant="ghost"
            @click="demoKitButtonSuccess"
          >
            原地保存
          </KitButton>
          <KitButton variant="danger">
            危险操作
          </KitButton>
        </div>
        <p class="mt-2 text-11px text-ink-faint" aria-live="polite">
          提交调用次数：{{ demoSubmitCount }}
        </p>
      </section>

      <!-- W2-1 LookupSelect 检索下拉 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          W2-1 LookupSelect — 远程检索与最近选择（#93）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          输入“车”可观察 300ms 防抖后的关键词高亮；选中后重开显示最近选择，也可清空或快捷新建。
        </p>
        <div class="grid gap-3 sm:grid-cols-2">
          <label>
            <span class="field-label">项目名称</span>
            <LookupSelect
              v-model="demoLookupId"
              :fetch="fetchDemoLookup"
              recent-key="dev-projects"
              allow-create
              placeholder="搜索项目"
              @create="demoLookupCreate"
            />
          </label>
          <label>
            <span class="field-label">依赖项目的合同</span>
            <LookupSelect
              :fetch="fetchDemoLookup"
              disabled-reason="该字段依赖“项目名称”的值，请补全后操作"
              placeholder="搜索合同"
            />
          </label>
        </div>
        <p class="mt-2 text-11px text-ink-faint" aria-live="polite">
          当前选中 ID：{{ demoLookupId ?? '未选择' }}
        </p>
      </section>

      <!-- W2-4 FormFooter 保存动作组 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          W2-4 FormFooter — 表单保存动作组（#96）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          五动作保持固定顺序；切换 dirty 可观察“保存草稿”置灰，勾选项与页面状态双向同步。
        </p>
        <label class="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-12px text-ink-soft">
          <input
            v-model="demoFormDirty"
            type="checkbox"
            class="h-3.5 w-3.5 accent-[var(--brand)]"
          >
          <span>表单有修改（dirty）</span>
        </label>
        <FormFooter
          v-model="demoCloseAfterSave"
          :dirty="demoFormDirty"
          close-after-save
          :loading-action="demoFormLoading"
          @action="handleDemoFormAction"
        />
        <p class="mt-2 text-11px text-ink-faint" aria-live="polite">
          dirty：{{ demoFormDirty }}；保存后关闭：{{ demoCloseAfterSave }}
        </p>
      </section>

      <!-- W2-5 ListShell 列表页模板 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          W2-5 ListShell — 左树、视图与汇总行（#97）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          切换合同状态或“我负责的”视图，页面负责过滤数据并把汇总结果回传给列表壳；收起左树可观察无空白布局。
        </p>
        <ListShell
          v-model:tree-key="demoListTreeKey"
          v-model:view-key="demoListViewKey"
          :tree="demoListTree"
          :views="demoListViews"
          :summary="demoListSummary"
        >
          <template #toolbar>
            <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <span class="text-12px text-ink-faint">
                当前 {{ visibleDemoListRows.length }} 条
              </span>
              <button type="button" class="btn-secondary min-h-8">
                导入
              </button>
              <button type="button" class="btn-accent min-h-8">
                新建合同
              </button>
            </div>
          </template>
          <template #table>
            <div class="min-w-0 overflow-x-auto">
              <div class="min-w-170">
                <KitTable
                  :columns="demoListColumns"
                  :data="visibleDemoListRows"
                  :min-rows="5"
                />
              </div>
            </div>
          </template>
        </ListShell>
      </section>

      <!-- ⑧ 配置导出页签 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ⑧ exportFile — 多文件配置导出页签（ADR 0004）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          需按类分目录的导出经同一分流函数打开独立页签，在页签内配置两级目录、命名预览并完成三步写盘。
        </p>
        <KitButton @click="demoConfiguredExport">
          打开多表导出配置
        </KitButton>
      </section>

      <!-- ⑨ 导入映射页签 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ⑨ openImportTab — 导入映射页签（ADR 0005）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          实体触发、模板隐含：页签内 上传 → 映射（智能预匹配 + 三色态 + 必填门控）→ 预览/导入（可删行）。
          演示实体中「外部旧ID」以 FAIL 开头的行同一会话内首次写入失败（重试从失败行续导成功）。
        </p>
        <KitButton @click="demoImportMapping">
          打开导入映射演示
        </KitButton>
      </section>

      <!-- ⑩ 按钮五变体 -->
      <section class="panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ⑩ 按钮五变体 — 层级语言（DESIGN-TASTE §4.2 / #109）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          缺省 = secondary 安静按钮；实心蓝只属于 <b>accent</b>（业务屏每屏 ≤1 枚章，本演示页除外）；
          danger 静默红（破坏性防护在确认弹窗，ADR 0003）；hover 平面变色、active 按压 scale(0.97)。
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <Button>secondary（缺省）</Button>
          <Button variant="primary">
            primary
          </Button>
          <Button variant="accent">
            accent（每屏一枚章）
          </Button>
          <Button variant="ghost">
            ghost
          </Button>
          <Button variant="destructive">
            danger（静默红）
          </Button>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary">
            sm 12px
          </Button>
          <Button variant="primary">
            md 13px（缺省）
          </Button>
          <Button size="lg" variant="primary">
            lg 14px
          </Button>
          <Button disabled>
            disabled
          </Button>
        </div>
        <p class="mt-2 text-11px text-ink-faint">
          uno shortcut 版同配方：btn-secondary / btn-primary / btn-accent / btn-ghost / btn-danger。
        </p>
      </section>

      <!-- 结果回读 -->
      <section class="panel p-4 bg-surface-2">
        <h2 class="text-12px font-700 text-ink-soft mb-1">
          最近一次返回值
        </h2>
        <p class="text-12px font-mono text-ink break-all">
          {{ lastResult }}
        </p>
      </section>
    </div>
  </div>
</template>
