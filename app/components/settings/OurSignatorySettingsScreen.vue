<script setup lang="ts">
import type { OurSignatoryListDTO } from '~/lib/our-signatory/contract'
import { createOurSignatoryRepository } from '~/lib/our-signatory/http-repository'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { bindReadAuthority } from '~/lib/read-model/authority'

const data = shallowRef<OurSignatoryListDTO | null>(null)
const error = ref('')
const loading = ref(false)
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
  if (isDesktopRuntime()) {
    error.value = '独立桌面路径尚未接入一致主体目录。请使用已开放的中央入口维护；旧合同原文仍保留。'
    return
  }
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
  <div class="grid min-w-0 gap-4 p-4" data-testid="our-signatory-settings">
    <header class="panel flex flex-wrap items-start justify-between gap-3 p-4">
      <div>
        <h1 class="m-0 text-20px font-700">
          我方签约主体
        </h1><p class="mb-0 mt-2 text-13px text-ink-soft">
          维护真实签约名称和核实资料。停用保留稳定身份；合同保留签约时采用的快照。
        </p>
      </div>
      <NuxtLink v-if="data?.capabilities.includes('our-signatory:write')" to="/settings/our-signatories/form" class="btn-primary">
        新增主体
      </NuxtLink>
    </header>
    <section v-if="loading || error" class="panel p-4" role="status">
      <p>{{ loading ? '正在读取我方主体目录' : error }}</p><button v-if="error && !isDesktopRuntime()" type="button" class="btn-secondary" @click="load">
        重新读取
      </button>
    </section>
    <section v-else-if="data" class="panel min-w-0 overflow-x-auto p-4" aria-label="签约主体目录">
      <p v-if="!data.records.length" class="m-0 text-13px text-ink-soft">
        尚未录入主体。按真实文书核实后新增，再在合同中明确选择。
      </p>
      <table v-else class="w-full min-w-600px text-left text-13px">
        <thead>
          <tr class="border-b border-line">
            <th class="py-2">
              签约名称
            </th><th>纳税识别号</th><th>状态</th><th>版本</th><th>操作</th>
          </tr>
        </thead><tbody>
          <tr v-for="record in data.records" :key="record.id" class="border-b border-line">
            <td class="py-3">
              {{ record.draft.name }}
            </td><td>{{ record.draft.taxNo ?? '未核实' }}</td><td>{{ record.draft.status === 'active' ? '可选择' : '已停用' }}</td><td>{{ record.version }}</td><td>
              <NuxtLink v-if="data.capabilities.includes('our-signatory:write')" :to="`/settings/our-signatories/form/${record.id}`" class="text-brand">
                编辑
              </NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
