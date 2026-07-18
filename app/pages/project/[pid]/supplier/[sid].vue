<script setup lang="ts">
const route = useRoute()
const psStore = useProjectSupplierStore()
const projStore = useProjectStore()
const supStore = useSupplierStore()
const toast = useToast()

const pid = computed(() => route.params.pid as string)
const sid = computed(() => route.params.sid as string)

const ps = computed(() => psStore.byProjectAndSupplier(pid.value, sid.value))
const project = computed(() => projStore.byId(pid.value))
const supplier = computed(() => supStore.byId(sid.value))

// 页签标题回填为「分供方名」（项目内分供方档案），取代通用「项目分供方」
useTabTitle(() => supplier.value?.name)

const STATUS_LABEL: Record<string, string> = {
  collecting: '资料收集中',
  contracted: '已签合同',
  claiming: '请款中',
  paid: '已付款',
  settled: '已结算',
}
const STATUS_COLOR: Record<string, string> = {
  collecting: 'chip-warn',
  contracted: 'chip-brand',
  claiming: 'chip-brand',
  paid: 'chip-ok',
  settled: 'chip-ok',
}

const STATUS_DEFAULT_TAB: Record<string, string> = {
  collecting: 'contract',
  contracted: 'claim',
  claiming: 'claim',
  paid: 'payment',
  settled: 'settlement',
}

const activeTab = ref('overview')
const tabs = [
  { key: 'overview', label: '合作概览' },
  { key: 'contract', label: '合同' },
  { key: 'claim', label: '请款' },
  { key: 'ticket', label: '收票' },
  { key: 'payment', label: '付款' },
  { key: 'settlement', label: '结算' },
]

watch(ps, (v) => {
  if (v)
    activeTab.value = STATUS_DEFAULT_TAB[v.status] || 'overview'
}, { immediate: true })

const showSettlement = ref(false)
const settlementAmount = ref(0)

async function confirmSettlement() {
  if (!ps.value)
    return
  if (settlementAmount.value <= 0) {
    toast.warning('请填写结算金额')
    return
  }
  await psStore.updateStatus(ps.value.id, 'settled')
  toast.success('结算已确认，数据已锁定')
  showSettlement.value = false
}

onMounted(async () => {
  await Promise.all([projStore.load(), supStore.load(), psStore.load()])
})
</script>

<template>
  <div v-if="ps && project && supplier">
    <!-- 顶部摘要 -->
    <div class="border border-line bg-panel mb-3 px-4 py-3">
      <div class="flex items-center gap-3 mb-2">
        <NuxtLink :to="`/project/${pid}`" class="icon-btn" title="返回项目">
          <span class="i-lucide-arrow-left text-14px" />
        </NuxtLink>
        <h2 class="text-14px font-800 text-ink">
          项目: <span class="text-brand">{{ project.name }}</span>
          × 分供方: <span class="text-brand">{{ supplier.name }}</span>
        </h2>
        <span class="chip" :class="[STATUS_COLOR[ps.status]]">
          {{ STATUS_LABEL[ps.status] || ps.status }}
        </span>
      </div>
      <div class="info-row text-12px">
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            合同额
          </div>
          <div class="font-mono tabular-nums">
            ¥0.00
          </div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            请款
          </div>
          <div class="font-mono tabular-nums">
            ¥0.00
          </div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            收票
          </div>
          <div class="font-mono tabular-nums">
            ¥0.00
          </div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            已付
          </div>
          <div class="font-mono tabular-nums">
            ¥0.00
          </div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            应付余额
          </div>
          <div class="font-mono tabular-nums text-danger font-700">
            ¥0.00
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 栏（SegTab 统一底座，content-tab 双轨已收敛 #110 阶段⑥） -->
    <SegTab v-model="activeTab" :tabs="tabs" class="mb-4" />

    <!-- Tab 内容 -->
    <div v-if="activeTab === 'overview'" class="border border-line bg-panel p-4">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <h4 class="text-13px font-700 text-ink mb-2 flex items-center gap-1.5">
            <span class="w-0.5 h-3.5 bg-brand rounded-full" /> 项目信息
          </h4>
          <div class="form-grid">
            <div class="form-cell">
              <span class="text-9px text-ink-faint">项目名称</span>
              <NuxtLink :to="`/project/${pid}`" class="text-12px text-brand hover:underline">
                {{ project.name }}
              </NuxtLink>
            </div>
            <div class="form-cell">
              <span class="text-9px text-ink-faint">状态</span>
              <span class="text-12px">{{ project.status }}</span>
            </div>
            <div class="form-cell">
              <span class="text-9px text-ink-faint">建设单位</span>
              <span class="text-12px">{{ project.developer || '—' }}</span>
            </div>
            <div class="form-cell">
              <span class="text-9px text-ink-faint">项目经理</span>
              <span class="text-12px">{{ project.manager || '—' }}</span>
            </div>
          </div>
        </div>
        <div>
          <h4 class="text-13px font-700 text-ink mb-2 flex items-center gap-1.5">
            <span class="w-0.5 h-3.5 bg-brand rounded-full" /> 分供方信息
          </h4>
          <div class="form-grid">
            <div class="form-cell">
              <span class="text-9px text-ink-faint">公司名称</span>
              <NuxtLink :to="`/base/supplier/${sid}`" class="text-12px text-brand hover:underline">
                {{ supplier.name }}
              </NuxtLink>
            </div>
            <div class="form-cell">
              <span class="text-9px text-ink-faint">类别</span>
              <span class="text-12px">{{ supplier.supplierCategory || '—' }}</span>
            </div>
            <div class="form-cell">
              <span class="text-9px text-ink-faint">联系人</span>
              <span class="text-12px">{{ supplier.contact || '—' }}</span>
            </div>
            <div class="form-cell">
              <span class="text-9px text-ink-faint">电话</span>
              <span class="text-12px">{{ supplier.contactPhone || '—' }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 合同/请款/收票/付款 Tab — 带 [+新建] 跳转 -->
    <div v-else-if="['contract', 'claim', 'ticket', 'payment'].includes(activeTab)" class="border border-line bg-panel p-4">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-13px font-700 text-ink">
          {{ tabs.find(t => t.key === activeTab)?.label }} · 0 条
        </h4>
        <button class="btn-secondary" disabled>
          <span class="i-lucide-plus text-13px mr-1" />
          新建（跳转到对应模块）
        </button>
      </div>
      <div class="py-8 text-center text-ink-faint text-13px">
        暂无数据 · 点击「新建」按钮到对应业务模块创建
      </div>
    </div>

    <!-- 结算 Tab -->
    <div v-else-if="activeTab === 'settlement'" class="border border-line bg-panel p-4">
      <div v-if="ps.status === 'settled'" class="text-center py-8">
        <span class="i-lucide-circle-check text-32px text-ok mb-2 block mx-auto" />
        <p class="text-14px font-700 text-ok mb-1">
          已结算
        </p>
        <p class="text-12px text-ink-faint">
          数据已锁定为只读
        </p>
      </div>
      <div v-else>
        <p class="text-13px text-ink-soft mb-4">
          确认结算后，该项目×分供方的所有数据将锁定为只读。请确保所有合同、请款、收票、付款数据已完善。
        </p>
        <button class="btn-accent" @click="showSettlement = true">
          <span class="i-lucide-file-check text-13px mr-1" />
          确认结算
        </button>
      </div>
    </div>

    <!-- 结算确认弹窗 -->
    <ConfirmDialog
      :open="showSettlement"
      title="确认结算"
      message="确认后该项目×分供方的数据将锁定为只读。此操作不可逆，是否继续？"
      confirm-label="确认结算"
      :danger="true"
      @confirm="confirmSettlement"
      @cancel="showSettlement = false"
    />
  </div>

  <div v-else class="py-12 text-center text-ink-faint">
    加载中...
  </div>
</template>
