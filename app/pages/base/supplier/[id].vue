<script setup lang="ts">
import type { StatusTone } from '~/lib/supplier/status'
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUS_TONE } from '~/lib/supplier/status'

const route = useRoute()
const store = useSupplierStore()
const psStore = useProjectSupplierStore()

const supplierId = computed(() => route.params.id as string)
const supplier = computed(() => store.byId(supplierId.value))

// 页签标题回填为分供方名（如「华东建材」），取代通用「分供方详情」
useTabTitle(() => supplier.value?.name)

const activeTab = ref('detail')
const tabs = [
  { key: 'detail', label: '详细资料' },
  { key: 'credential', label: '证照附件' },
  { key: 'projects', label: '合作项目' },
  { key: 'contracts', label: '合同汇总' },
  { key: 'payments', label: '请款/付款汇总' },
  { key: 'tickets', label: '收票汇总' },
]

// 顶部「编辑」与列表页共用同一份 SupplierFormDialog（v-model:open + supplier 驱动，保存逻辑收在组件内）。
const showEdit = ref(false)

// 语义色调 → 详情页 chip class（色调映射见 ~/lib/supplier/status，恰好与 chip-<tone> 类名一一对应）
const CHIP_TONE_CLASS: Record<StatusTone, string> = {
  warn: 'chip-warn',
  brand: 'chip-brand',
  ok: 'chip-ok',
  danger: 'chip-danger',
}
function credentialChipClass(status: string): string {
  const tone = CREDENTIAL_STATUS_TONE[status]
  return tone ? CHIP_TONE_CLASS[tone] : ''
}

const COOP_STATUS_LABEL: Record<string, string> = {
  collecting: '资料收集',
  contracted: '已签合同',
  claiming: '请款中',
  paid: '已付款',
  settled: '已结算',
}

const supplierProjects = computed(() =>
  psStore.bySupplier(supplierId.value),
)

onMounted(async () => {
  await store.load()
  await psStore.load()
})
</script>

<template>
  <div v-if="supplier">
    <!-- 顶部摘要 -->
    <div class="border border-line bg-panel mb-4 px-4 py-3">
      <div class="flex items-center gap-3 mb-2">
        <NuxtLink to="/base/supplier" class="icon-btn" title="返回列表">
          <span class="i-lucide-arrow-left text-14px" />
        </NuxtLink>
        <h2 class="text-17px font-800 text-ink">
          {{ supplier.name }}
        </h2>
        <span class="chip" :class="[credentialChipClass(supplier.credentialStatus)]">
          {{ CREDENTIAL_STATUS_LABEL[supplier.credentialStatus] || supplier.credentialStatus }}
        </span>
        <div class="flex-1" />
        <button class="btn-secondary" @click="showEdit = true">
          <span class="i-lucide-square-pen text-13px mr-1" /> 编辑
        </button>
      </div>
      <div class="info-row text-12px">
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            类别
          </div>
          <div>{{ supplier.supplierCategory || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            评价
          </div>
          <div>{{ supplier.rating || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            联系人
          </div>
          <div>{{ supplier.contact || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            电话
          </div>
          <div>{{ supplier.contactPhone || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            税号
          </div>
          <div class="font-mono text-11px">
            {{ supplier.taxNo || '—' }}
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 栏 -->
    <div class="flex border-b border-line mb-4">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="content-tab"
        :class="activeTab === t.key ? 'content-tab-active' : ''"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- Tab 内容 -->
    <div v-if="activeTab === 'detail'">
      <SupplierDetailTab :supplier="supplier" />
    </div>

    <div v-else-if="activeTab === 'credential'">
      <SupplierCredentialTab :supplier-id="supplier.id" />
    </div>

    <div v-else-if="activeTab === 'projects'">
      <div class="border border-line">
        <vxe-table
          :data="supplierProjects"
          border
          show-overflow
          height="auto"
          :row-config="{ isHover: true, keyField: 'id' }"
        >
          <vxe-column type="seq" title="#" width="52" />
          <vxe-column field="projectName" title="项目名称" min-width="180">
            <template #default="{ row }">
              <NuxtLink :to="`/project/${row.projectId}/supplier/${row.supplierId}`" class="cell--link">
                {{ row.projectName || '—' }}
              </NuxtLink>
            </template>
          </vxe-column>
          <vxe-column field="status" title="合作状态" width="100">
            <template #default="{ row }">
              <span
                :class="{
                  'cell--status-warn': row.status === 'collecting',
                  'text-brand font-600': row.status === 'contracted' || row.status === 'claiming',
                  'cell--status-ok': row.status === 'paid' || row.status === 'settled',
                }"
              >
                {{ COOP_STATUS_LABEL[row.status] || row.status }}
              </span>
            </template>
          </vxe-column>
          <vxe-column field="createdAt" title="关联时间" width="160">
            <template #default="{ row }">
              {{ row.createdAt?.slice(0, 19).replace('T', ' ') || '—' }}
            </template>
          </vxe-column>
        </vxe-table>
      </div>
    </div>

    <div v-else class="border border-line bg-panel p-8 text-center text-ink-faint text-13px">
      {{ tabs.find(t => t.key === activeTab)?.label }} — 待实现（需对应业务模块数据）
    </div>

    <!-- 编辑弹窗与列表页共用同一 SupplierFormDialog -->
    <SupplierFormDialog v-model:open="showEdit" :supplier="supplier" />
  </div>

  <div v-else class="py-12 text-center text-ink-faint">
    加载中...
  </div>
</template>
