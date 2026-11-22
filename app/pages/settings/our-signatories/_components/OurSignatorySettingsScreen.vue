<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { OurSignatoryListDTO } from '~/lib/our-signatory/contract'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, shallowRef } from 'vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import KitTable from '~/components/ui/KitTable.vue'
import ListShell from '~/components/ui/ListShell.vue'
import { createOurSignatoryRepository } from '~/lib/our-signatory/http-repository'
import { bindReadAuthority } from '~/lib/read-model/authority'

const data = shallowRef<OurSignatoryListDTO | null>(null)
const error = shallowRef('')
const loading = shallowRef(false)
const canWrite = computed(() => data.value?.capabilities.includes('our-signatory:write') ?? false)
const rows = computed(() => data.value?.records.map(record => ({
  id: record.id,
  name: record.draft.name,
  taxNo: record.draft.taxNo ?? '未核实',
  status: record.draft.status,
  version: record.version,
})) ?? [])
const columns: KitTableColumn[] = [
  { field: 'name', title: '签约名称', minWidth: 200 },
  { field: 'taxNo', title: '纳税识别号', minWidth: 180 },
  { field: 'status', title: '状态', width: 100, slot: 'status' },
  { field: 'version', title: '版本', width: 88 },
  { type: 'action', title: '操作', align: 'right' },
]
const empty = { title: '尚未录入主体。按真实文书核实后新增，再在合同中明确选择。' }

let generation = 0
let active = true
const repository = createOurSignatoryRepository((url, options) => $fetch<unknown, string>(url, { ...options, retry: 0 }))
function invalidate() {
  generation++
  data.value = null
  loading.value = false
  error.value = '当前身份或来源变化，请重新读取主体目录'
}
bindReadAuthority(invalidate)
async function load() {
  const current = ++generation
  data.value = null
  error.value = ''
  loading.value = true
  try {
    const result = await repository.list()
    if (current === generation && active)
      data.value = result
  }
  catch (cause) {
    if (current === generation && active)
      error.value = cause instanceof Error ? cause.message : '目录读取失败'
  }
  finally {
    if (current === generation && active)
      loading.value = false
  }
}
onMounted(load)
onDeactivated(() => {
  active = false
  invalidate()
})
onBeforeUnmount(() => {
  active = false
  invalidate()
})
onActivated(() => {
  if (!active) {
    active = true
    void load()
  }
})
useTabTitle('我方签约主体')
</script>

<template>
  <div class="min-w-0 p-4" data-testid="our-signatory-settings">
    <ListShell continuous>
      <template #heading>
        <div class="min-w-0">
          <h1 class="m-0 text-20px font-700">
            我方签约主体
          </h1>
          <p class="mb-0 mt-2 text-13px text-ink-soft">
            维护真实签约名称和核实资料。停用保留稳定身份；合同保留签约时采用的快照。
          </p>
        </div>
      </template>
      <template v-if="canWrite" #actions>
        <NuxtLink to="/settings/our-signatories/form" class="btn-primary">
          新增主体
        </NuxtLink>
      </template>
      <template #table>
        <section v-if="loading || error" class="p-4" role="status">
          <p>{{ loading ? '正在读取我方主体目录' : error }}</p>
          <button v-if="error" type="button" class="btn-secondary" @click="load">
            重新读取
          </button>
        </section>
        <section v-else-if="data" class="min-w-0" aria-label="签约主体目录">
          <KitTable :columns="columns" :data="rows" :empty="empty">
            <template #status="{ row }">
              <KitStatusTag :tone="row.status === 'active' ? 'ok' : 'neutral'">
                {{ row.status === 'active' ? '可选择' : '已停用' }}
              </KitStatusTag>
            </template>
            <template #action="{ row }">
              <NuxtLink
                v-if="canWrite"
                :to="`/settings/our-signatories/form/${row.id}`"
                :aria-label="`编辑${row.name}`"
                class="icon-btn"
                title="编辑"
              >
                <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
              </NuxtLink>
            </template>
          </KitTable>
        </section>
      </template>
    </ListShell>
  </div>
</template>
