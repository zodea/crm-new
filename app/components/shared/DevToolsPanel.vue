<script setup lang="ts">
import { getAllTableNames, getTableRowCount, exportAllSeeds } from '~/lib/db/export-seed'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const toast = useToast()

interface TableInfo {
  name: string
  count: number
  selected: boolean
}

const tables = ref<TableInfo[]>([])
const loading = ref(false)
const exporting = ref(false)
const exportResults = ref<{ table: string, rows: number, json: string }[]>([])

async function loadTables() {
  loading.value = true
  try {
    const names = await getAllTableNames()
    const infos: TableInfo[] = []
    for (const name of names) {
      const count = await getTableRowCount(name)
      infos.push({ name, count, selected: count > 0 })
    }
    tables.value = infos
  }
  finally {
    loading.value = false
  }
}

const hasData = computed(() => tables.value.some(t => t.count > 0))
const selectedCount = computed(() => tables.value.filter(t => t.selected).length)
const dataTableCount = computed(() => tables.value.filter(t => t.count > 0).length)

function toggleAll(checked: boolean) {
  for (const t of tables.value) {
    if (t.count > 0) t.selected = checked
  }
}

async function doExport() {
  exporting.value = true
  try {
    const results = await exportAllSeeds()
    exportResults.value = results.filter(r =>
      tables.value.find(t => t.name === r.table)?.selected,
    )
    toast.success(`已导出 ${exportResults.value.length} 张表的 seed 数据`)
  }
  catch (e: any) {
    toast.error(`导出失败: ${e.message}`)
  }
  finally {
    exporting.value = false
  }
}

function downloadJson(table: string, json: string) {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${table}.local.json`
  a.click()
  URL.revokeObjectURL(url)
}

function downloadAll() {
  for (const r of exportResults.value) {
    downloadJson(r.table, r.json)
  }
  toast.success('全部下载完成，请放入 app/lib/db/seed/ 目录')
}

watch(() => props.open, (val) => {
  if (val) {
    loadTables()
    exportResults.value = []
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-[200ms]"
      leave-active-class="transition-opacity duration-[150ms]"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-[8000]">
        <div class="absolute inset-0 bg-black/20" @click="emit('close')" />
        <div
          class="absolute right-0 top-0 h-full w-[420px] bg-panel border-l border-line shadow-[var(--shadow-pop)] flex flex-col"
          style="animation: slide-right-in 200ms var(--ease-snappy)"
        >
          <!-- 头部 -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
            <div class="flex items-center gap-2">
              <span class="i-lucide-wrench text-14px text-brand" />
              <h3 class="text-14px font-800 text-ink">开发工具</h3>
              <span class="chip text-9px bg-warn/20 text-warn">DEV ONLY</span>
            </div>
            <button class="icon-btn" @click="emit('close')">
              <span class="i-lucide-x text-14px" />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-4">
            <!-- Seed 导出区 -->
            <h4 class="text-12px font-700 text-ink mb-2">
              <span class="i-lucide-database text-12px mr-1" />
              导出 Seed 数据
            </h4>
            <p class="text-11px text-ink-soft mb-3">
              将当前内存数据库中的数据导出为 JSON 文件。下载后放入
              <code class="text-10px bg-surface-3 px-1 py-0.5">app/lib/db/seed/</code>
              目录即可作为启动种子数据。
            </p>

            <!-- 表列表 -->
            <div v-if="loading" class="py-4 text-center text-ink-faint text-12px">
              加载表信息...
            </div>
            <div v-else class="mb-4">
              <div class="flex items-center justify-between mb-2">
                <label class="flex items-center gap-1.5 text-11px text-ink-soft cursor-pointer">
                  <input
                    type="checkbox"
                    class="accent-brand"
                    :checked="selectedCount === dataTableCount"
                    :indeterminate="selectedCount > 0 && selectedCount < dataTableCount"
                    @change="toggleAll(($event.target as HTMLInputElement).checked)"
                  >
                  全选有数据的表
                </label>
                <span class="text-10px text-ink-faint">{{ selectedCount }} / {{ tables.length }} 张表</span>
              </div>

              <div class="space-y-1 max-h-[320px] overflow-y-auto">
                <label
                  v-for="t in tables"
                  :key="t.name"
                  class="flex items-center gap-2 px-3 py-1.5 border border-line cursor-pointer transition-colors"
                  :class="[
                    t.selected ? 'bg-brand-soft/20 border-brand/30' : '',
                    t.count === 0 ? 'opacity-40' : 'hover:bg-surface-3',
                  ]"
                >
                  <input
                    v-model="t.selected"
                    type="checkbox"
                    class="accent-brand"
                    :disabled="t.count === 0"
                  >
                  <span class="text-12px font-mono flex-1">{{ t.name }}</span>
                  <span class="text-10px font-mono" :class="t.count > 0 ? 'text-ok' : 'text-ink-faint'">
                    {{ t.count }} 行
                  </span>
                </label>
              </div>
            </div>

            <!-- 导出按钮 -->
            <div class="flex gap-2 mb-4">
              <button
                class="btn-primary flex-1"
                :disabled="exporting || selectedCount === 0"
                @click="doExport"
              >
                <span class="i-lucide-download text-13px mr-1" />
                {{ exporting ? '导出中...' : `导出选中 (${selectedCount} 表)` }}
              </button>
            </div>

            <!-- 导出结果 -->
            <div v-if="exportResults.length > 0">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-12px font-700 text-ok">
                  <span class="i-lucide-circle-check text-12px mr-1" />
                  导出完成
                </h4>
                <button class="btn-secondary text-11px" @click="downloadAll">
                  <span class="i-lucide-download text-11px mr-0.5" /> 全部下载
                </button>
              </div>

              <div class="space-y-1.5">
                <div
                  v-for="r in exportResults"
                  :key="r.table"
                  class="flex items-center justify-between px-3 py-2 border border-line bg-surface-3/50"
                >
                  <div>
                    <span class="text-12px font-mono font-700">{{ r.table }}.local.json</span>
                    <span class="text-10px text-ink-faint ml-2">{{ r.rows }} 行</span>
                  </div>
                  <button
                    class="icon-btn"
                    title="下载"
                    @click="downloadJson(r.table, r.json)"
                  >
                    <span class="i-lucide-download text-13px" />
                  </button>
                </div>
              </div>

              <p class="text-10px text-ink-faint mt-3">
                下载的文件命名为 <code>*.local.json</code>（已 gitignore）。
                如需作为脱敏版提交，请重命名为 <code>*.json</code>。
              </p>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
@keyframes slide-right-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
</style>
