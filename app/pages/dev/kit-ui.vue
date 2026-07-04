<script setup lang="ts">
// 隐藏 dev 演示路由（不在侧边栏 NAV_GROUPS 中）：逐一验证 KitUI 原语。
// 访问 /dev/kit-ui（ripple 暂缓，待补动态图后再加回演示）
const kit = useKitUI()

const lastResult = ref('（尚无操作）')

function demoToasts() {
  kit.success('保存成功')
  setTimeout(() => kit.warning('请填写必填项'), 400)
  setTimeout(() => kit.error('网络请求失败'), 800)
  setTimeout(() => kit.info('这是一条提示'), 1200)
}

async function demoConfirm(danger = false) {
  const ok = await kit.confirm({
    title: danger ? '删除分供方' : '确认操作',
    message: danger
      ? '确认删除「瑞航建材」？删除后可在 5 秒内撤回。'
      : '确定提交本次变更吗？',
    confirmLabel: danger ? '删除' : '确定',
    danger,
  })
  lastResult.value = `confirm 返回：${ok}`
  if (ok) kit.success(danger ? '已删除' : '已提交')
}

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
  if (values) kit.success('分供方已创建')
}

function demoUndoToast() {
  // 模拟软删除：先移除，5 秒内可撤回
  lastResult.value = '已软删除 1 条记录，5 秒内可撤回'
  kit.undoToast('已删除「测试项目」', () => {
    lastResult.value = '记录已恢复到原位置'
  })
}
</script>

<template>
  <div class="max-w-3xl mx-auto py-4">
    <header class="mb-5">
      <div class="flex items-center gap-2">
        <span class="i-lucide-flask-conical text-16px text-brand" />
        <h1 class="text-16px font-800 text-ink">KitUI 原语演示</h1>
        <span class="chip text-9px bg-warn-soft text-warn-ink">DEV ONLY</span>
      </div>
      <p class="text-12px text-ink-soft mt-1">
        隐藏路由 <code class="text-11px bg-surface-3 px-1 py-0.5">/dev/kit-ui</code>，
        逐一触发原语验证行为，对照设计稿 <code class="text-11px bg-surface-3 px-1 py-0.5">kit/KitUI.jsx</code>。
      </p>
      <p class="text-11px text-ink-faint mt-2">
        <span class="i-lucide-info text-12px mr-0.5" />
        ripple（蓝色水波动效）暂缓，待补动态图后再加回。
      </p>
    </header>

    <div class="space-y-3">
      <!-- ① toast -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">① toast — 多语义色自动消失</h2>
        <p class="text-12px text-ink-soft mb-3">success / warning / error / info 四种语义，右上角滑入，3 秒自动消失。</p>
        <button class="btn-primary" @click="demoToasts">依次弹出四种 toast</button>
      </section>

      <!-- ② confirm -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">② confirm — Promise 化确认弹窗</h2>
        <p class="text-12px text-ink-soft mb-3">await 拿到 true/false；danger 变体按钮标红。点遮罩/取消 = false。</p>
        <div class="flex gap-2">
          <button class="btn-secondary" @click="demoConfirm(false)">普通确认</button>
          <button class="btn-danger" @click="demoConfirm(true)">危险确认</button>
        </div>
      </section>

      <!-- ③ formModal -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">③ formModal — 字段配置驱动 + 必填校验</h2>
        <p class="text-12px text-ink-soft mb-3">fields 配置渲染控件；缺必填项标红拦截提交；提交返回值对象，取消返回 null。</p>
        <button class="btn-primary" @click="demoFormModal">打开表单弹窗</button>
      </section>

      <!-- ④ undoToast -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">④ undoToast — 软删除 5 秒撤回</h2>
        <p class="text-12px text-ink-soft mb-3">5 秒内点「撤回」执行回调并弹「已撤回」；超时自动消失、不回调。</p>
        <button class="btn-danger" @click="demoUndoToast">软删除（可撤回）</button>
      </section>

      <!-- 结果回读 -->
      <section class="content-panel p-4 bg-surface-2">
        <h2 class="text-12px font-700 text-ink-soft mb-1">最近一次返回值</h2>
        <p class="text-12px font-mono text-ink break-all">{{ lastResult }}</p>
      </section>
    </div>
  </div>
</template>
