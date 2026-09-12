<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { ScheduleProcessLibraryDetail } from '~/lib/schedule/process-library'
import { computed, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { Button } from '~/components/ui/button'
import KitTable from '~/components/ui/KitTable.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { processLibraryNavigationQuery, processLibraryReturnTo } from '~/lib/schedule/process-library-navigation'
import { toErrorMessage } from '~/lib/util/error'

const route = useRoute()
const store = useScheduleProcessLibraryStore()
const version = shallowRef<ScheduleProcessLibraryDetail | null>(null)
const loading = shallowRef(false)
const error = shallowRef('')
let active = true
let generation = 0
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const origin = computed(() => route.query.origin === 'demo' ? 'demo' : route.query.origin === 'real' ? 'real' : store.origin)
const returnTo = computed(() => processLibraryReturnTo(route.query))
const navigationQuery = computed(() => processLibraryNavigationQuery(origin.value, returnTo.value))
const key = () => `${id.value}:${origin.value}:${store.origin}`
let initializedKey = ''
const sourceLabel = (predecessor: string | null) => version.value?.tasks.find(task => task.key === predecessor)?.name ?? predecessor ?? '无'
const columns: KitTableColumn[] = [
  { title: '顺序', type: 'seq', width: 56 },
  { field: 'name', title: '工序名称 / 编码', minWidth: 200, slot: 'name' },
  { field: 'durationDays', title: '工期', width: 88, slot: 'duration' },
  { field: 'trade', title: '工种', width: 108 },
  { title: '阶段 / 分项映射', minWidth: 230, slot: 'mapping' },
  { title: '前置关系', minWidth: 170, slot: 'predecessor' },
]

async function load() {
  if (!active)
    return
  const request = ++generation
  const requestedKey = key()
  loading.value = true
  version.value = null
  error.value = ''
  try {
    if (!id.value || origin.value !== store.origin)
      throw new Error('版本或来源不匹配，请返回工序库重新选择')
    const detail = await store.loadDetail(id.value)
    if (!active || request !== generation || requestedKey !== key())
      return
    if (!detail)
      throw new Error('来源版本不存在或已删除')
    version.value = detail
    initializedKey = requestedKey
  }
  catch (cause) {
    if (active && request === generation)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (request === generation)
      loading.value = false
  }
}
watch(key, () => void load(), { immediate: true, flush: 'sync' })
onDeactivated(() => {
  active = false
  generation++
})
onActivated(() => {
  if (!active) {
    active = true
    void load()
  }
  else if (initializedKey && initializedKey !== key()) {
    void load()
  }
})
onScopeDispose(() => {
  active = false
  generation++
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4" data-testid="process-library-detail">
    <section class="panel flex flex-wrap items-start gap-3 p-4 sm:p-5">
      <Button as-child size="icon" variant="ghost">
        <NuxtLink :to="{ path: '/schedule/process-library', query: navigationQuery }" aria-label="返回标准工序库">
          <span class="i-lucide-arrow-left" aria-hidden="true" />
        </NuxtLink>
      </Button>
      <div class="min-w-48 flex-1">
        <p class="text-11px font-700 text-brand">
          标准工序库 · 只读版本
        </p>
        <h1 class="mt-1 text-20px font-850 text-ink">
          {{ version ? `${version.name} · v${version.version}` : '工序库版本详情' }}
        </h1>
        <p class="mt-1 text-12px text-ink-soft">
          当前版本保持不变。新建下一版后，既有排程的冻结快照也保持原样。
        </p>
      </div>
      <Button v-if="version && store.canWrite" as-child variant="accent">
        <NuxtLink :to="{ path: '/schedule/process-library/form', query: processLibraryNavigationQuery(origin, returnTo, version.id) }">
          基于此版本新建
        </NuxtLink>
      </Button>
      <Button v-if="returnTo" as-child>
        <NuxtLink :to="returnTo">
          返回新建楼栋分组
        </NuxtLink>
      </Button>
    </section>
    <StatePanel v-if="loading" kind="loading" title="正在读取工序库版本" />
    <StatePanel v-else-if="error" kind="error" title="工序库版本读取失败" :description="error" action-label="重试读取" @action="load" />
    <template v-else-if="version">
      <section class="panel grid gap-3 p-4 sm:grid-cols-3" aria-label="版本信息">
        <div>
          <p class="text-11px text-ink-faint">
            工序库编码
          </p><p class="mt-1 break-all font-mono text-13px text-ink">
            {{ version.code }}
          </p>
        </div>
        <div>
          <p class="text-11px text-ink-faint">
            版本说明
          </p><p class="mt-1 break-words text-13px text-ink">
            {{ version.description || '暂无说明' }}
          </p>
        </div>
        <div>
          <p class="text-11px text-ink-faint">
            引用状态
          </p><p class="mt-1 text-13px text-ink">
            {{ version.usageCount === null ? '引用数量未知 · 中央 WBS 尚未接通' : `已被 ${version.usageCount} 个排程引用` }}
          </p>
        </div>
      </section>
      <section class="panel min-w-0 overflow-hidden" aria-labelledby="process-version-tasks">
        <h2 id="process-version-tasks" class="border-b border-line px-4 py-3 text-14px font-800 text-ink">
          工序明细 · {{ version.tasks.length }} 道
        </h2>
        <div class="min-w-0" tabindex="0" role="region" aria-label="工序明细，可横向滚动">
          <KitTable :columns="columns" :data="[...version.tasks]" :min-rows="3" :row-height="52">
            <template #name="{ row }">
              <span class="font-700 text-ink">{{ row.name }}</span><p class="mt-1 font-mono text-10px text-ink-faint">
                {{ row.key }}
              </p>
            </template>
            <template #duration="{ row }">
              {{ row.durationDays }} 天
            </template>
            <template #mapping="{ row }">
              {{ row.stageCode || '未映射阶段' }}<p class="mt-1 text-11px text-ink-soft">
                {{ row.itemCodes.join('、') || '未映射分项' }}
              </p>
            </template>
            <template #predecessor="{ row }">
              <span :class="row.predecessorDisabled ? 'text-ink-faint' : 'text-ink'">{{ sourceLabel(row.predecessorKey) }}</span>
              <p v-if="row.predecessorDisabled" class="mt-1 text-11px text-ink-faint">
                已置灰保留
              </p>
            </template>
          </KitTable>
        </div>
      </section>
    </template>
  </div>
</template>
