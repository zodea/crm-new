<script setup lang="ts">
// 隐藏 dev 演示路由（不在侧边栏 NAV_GROUPS 中）：逐一验证 KitUI 原语。
// 访问 /dev/kit-ui（ripple 已全域废弃，见 ADR 0004，不提供演示）
const kit = useKitUI()

const lastResult = ref('（尚无操作）')

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
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ① 系统/结果提示 — expand 道（右上，展开可读）
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          系统消息、确认后的结果类走这里：右上角展开堆叠、语义色图标、hover 暂停自动消失。
        </p>
        <button class="btn-primary" @click="demoSemantic">
          连发 4 条（成功/提示/警告/错误）
        </button>
      </section>

      <!-- ② 过程提示 -->
      <section class="content-panel p-4">
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
          <button class="btn-primary" @click="demoProcessPile">
            连发 5 条（看重叠 + 悬停展开）
          </button>
        </div>
      </section>

      <!-- ③ undoToast -->
      <section class="content-panel p-4">
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
      <section class="content-panel p-4">
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
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">
          ⑤ formModal — 字段配置驱动 + 必填校验
        </h2>
        <p class="text-12px text-ink-soft mb-3">
          fields 配置渲染控件；缺必填项标红拦截提交；提交返回值对象，取消返回 null。
        </p>
        <button class="btn-primary" @click="demoFormModal">
          打开表单弹窗
        </button>
      </section>

      <!-- 结果回读 -->
      <section class="content-panel p-4 bg-surface-2">
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
