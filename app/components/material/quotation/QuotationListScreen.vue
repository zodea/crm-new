<script setup lang="ts">
const store = useMaterialQuotationStore()
let active = true
async function load() {
  try {
    await store.load()
  }
  catch {
  }
}
onMounted(load)
onDeactivated(() => {
  active = false
  store.invalidate()
})
onBeforeUnmount(() => {
  active = false
  store.invalidate()
})
onActivated(() => {
  if (!active) {
    active = true
    void load()
  }
})
useTabTitle('材料报价')
</script>

<template>
  <div class="grid min-w-0 gap-4 p-4">
    <header class="panel flex flex-wrap items-start justify-between gap-3 p-4">
      <div>
        <h1 class="m-0 text-20px font-700">
          材料报价
        </h1><p class="mb-0 mt-2 text-13px text-ink-soft">
          独立保存报价原文、适用条件和原件。未建档报价方不会自动成为分供方。
        </p>
      </div><NuxtLink v-if="store.snapshot?.capabilities.includes('material-quotation:write')" to="/material/quotations/form" class="btn-primary">
        新增报价
      </NuxtLink>
      <NuxtLink v-if="store.snapshot?.capabilities.includes('core:migration:write')" to="/material/quotations/import" class="btn-secondary">
        核验本地报价迁入
      </NuxtLink>
    </header>
    <StatePanel v-if="store.loading" kind="loading" title="正在读取报价" /><StatePanel v-else-if="store.error" kind="error" title="报价读取失败" :description="store.error" action-label="重试" @action="load" />
    <section v-else-if="store.snapshot" class="panel min-w-0 p-4">
      <p v-if="store.snapshot.meta.authorizedScope.coverage !== 'complete'" class="text-13px text-ink-soft">
        清单仅包含本次有权读取的报价，不能作为全部报价数量。
      </p><p v-if="!store.snapshot.records.length" class="m-0 text-13px text-ink-soft">
        当前可读取范围内暂无报价
      </p><div v-else class="overflow-x-auto" tabindex="0" aria-label="报价清单横向滚动区域">
        <table class="w-full min-w-650px text-left text-13px">
          <thead>
            <tr class="border-b border-line">
              <th class="py-2">
                报价方原文
              </th><th>报价日期</th><th>适用范围</th><th>材料行</th><th>版本</th><th>操作</th>
            </tr>
          </thead><tbody>
            <tr v-for="record in store.snapshot.records" :key="record.id" class="border-b border-line last:border-0">
              <td class="py-3">
                <NuxtLink :to="`/material/quotations/${record.id}`" class="text-brand">
                  {{ record.draft.partyName }}
                </NuxtLink><p class="m-0 text-11px text-ink-faint">
                  {{ record.draft.supplierId ? '已明确关联分供方' : '未关联目录身份' }}
                </p>
              </td><td>{{ record.draft.quotationDate ?? '未知' }}</td><td>{{ record.draft.scope === 'general' ? '通用报价' : record.draft.scope === 'project' ? '明确项目' : '范围未知' }}</td><td>{{ record.draft.lines.length }}</td><td>{{ record.version }}</td><td>
                <NuxtLink v-if="store.snapshot.capabilities.includes('material-quotation:write')" :to="`/material/quotations/form/${record.id}`" class="text-brand">
                  编辑
                </NuxtLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
