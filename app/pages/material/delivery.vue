<script setup lang="ts">
import type { DeliveryFile } from '~/stores/delivery'

const store = useDeliveryStore()
const toast = useToast()

const showFilter = ref(false)
const filterIncomplete = ref(false)

const OCR_STATUS: Record<string, { label: string, cls: string }> = {
  idle: { label: '待识别', cls: 'chip-warn' },
  running: { label: '识别中', cls: 'chip-brand' },
  done: { label: '识别完成', cls: 'chip-ok' },
  error: { label: '识别失败', cls: 'chip-danger' },
}

const displayFiles = computed(() => {
  let items = store.filteredFiles
  if (filterIncomplete.value) {
    items = items.filter(f => store.incompleteReasons(f).length > 0)
  }
  return items
})

function fmtMoney(v: string | number): string {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

onMounted(() => store.load())
</script>

<template>
  <div>
    <!-- 上传区 -->
    <div class="upload-zone mb-4 py-8 cursor-pointer">
      <span class="i-lucide-upload text-24px mb-2 block mx-auto text-brand" />
      <p class="text-13px font-600">拖拽 PDF / 图片 / 文件夹到此处上传</p>
      <p class="text-11px text-ink-faint mt-1">支持 PDF、PNG、JPG、BMP、WebP、GIF、TIFF</p>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-4 gap-3 mb-4">
      <StatCard label="全部文档" :value="store.stats.total" icon="i-lucide-file-text" color="brand" />
      <StatCard label="待识别" :value="store.stats.idle" icon="i-lucide-clock" color="warn" />
      <StatCard label="识别完成" :value="store.stats.done" icon="i-lucide-circle-check" color="ok" />
      <StatCard label="识别失败" :value="store.stats.error" icon="i-lucide-circle-x" color="danger" />
    </div>

    <!-- 分区栏 + 筛选 -->
    <div class="flex items-center gap-2 mb-3">
      <div class="flex border border-line rounded-[3px] overflow-hidden bg-panel">
        <button
          v-for="p in store.partitions"
          :key="p.id"
          class="px-3 py-1.5 text-12px font-600 border-r border-line last:border-r-0 cursor-pointer transition-colors"
          :class="store.activePartition === p.id ? 'bg-brand text-white' : 'text-ink-soft hover:bg-surface-3'"
          @click="store.setActivePartition(p.id)"
        >
          {{ p.name }}
        </button>
      </div>
      <div class="flex-1" />
      <label class="flex items-center gap-1.5 text-12px text-ink-soft cursor-pointer">
        <input v-model="filterIncomplete" type="checkbox" class="accent-brand">
        只看未完善
      </label>
      <button class="btn-primary" disabled>
        <span class="i-lucide-scan-text text-13px mr-1" /> 识别全部
      </button>
    </div>

    <!-- 文件卡片列表 -->
    <div class="space-y-3">
      <div
        v-for="f in displayFiles"
        :key="f.id"
        class="border border-line bg-panel"
      >
        <div class="flex gap-4 p-3">
          <!-- 左：缩略图占位 -->
          <div class="w-24 h-32 bg-surface-2 rounded-[3px] flex items-center justify-center shrink-0">
            <span class="text-28px font-800 text-ink-faint">
              {{ f.kind === 'pdf' ? '📄' : '🖼' }}
            </span>
          </div>

          <!-- 右：信息 -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1.5">
              <span class="text-13px font-700 truncate">{{ f.name }}</span>
              <span :class="['chip text-10px', OCR_STATUS[f.ocrStatus]?.cls || '']">
                {{ OCR_STATUS[f.ocrStatus]?.label || f.ocrStatus }}
              </span>
              <span v-if="f.docType" class="chip bg-surface-3 text-ink-soft text-10px">
                {{ f.docType }}
              </span>
            </div>

            <!-- 公司名 -->
            <div class="text-12px mb-1">
              <span class="text-ink-faint mr-1">公司:</span>
              <span v-if="f.company" :class="f.companyConflict ? 'text-danger font-600' : 'text-ink'">
                {{ f.company }}
                <span v-if="f.companyConflict" class="text-10px text-danger ml-1">(冲突)</span>
              </span>
              <span v-else class="text-warn">未识别</span>
              <span v-if="f.companySource" class="text-10px text-ink-faint ml-1">[{{ f.companySource }}]</span>
            </div>

            <!-- 项目 -->
            <div class="text-12px mb-2">
              <span class="text-ink-faint mr-1">工地:</span>
              <span>{{ f.project || '—' }}</span>
            </div>

            <!-- 明细行 -->
            <div v-if="f.docs.length > 0">
              <div v-for="doc in f.docs" :key="doc.id" class="mb-2">
                <div class="text-11px text-ink-faint mb-1">
                  {{ doc.dateText || doc.date || '—' }}
                  <span v-if="doc.orderNo" class="font-mono ml-2">{{ doc.orderNo }}</span>
                </div>
                <div v-if="doc.items.length" class="border border-line">
                  <table class="w-full text-12px">
                    <thead>
                      <tr class="bg-surface-2">
                        <th class="text-left px-2 py-1 font-600 text-ink-soft border-r border-line">材料名称</th>
                        <th class="text-left px-2 py-1 font-600 text-ink-soft border-r border-line w-14">单位</th>
                        <th class="text-right px-2 py-1 font-600 text-ink-soft border-r border-line w-16">数量</th>
                        <th class="text-right px-2 py-1 font-600 text-ink-soft border-r border-line w-16">单价</th>
                        <th class="text-right px-2 py-1 font-600 text-ink-soft w-20">金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(item, idx) in doc.items" :key="idx" class="border-t border-line">
                        <td class="px-2 py-1 border-r border-line">{{ item.name }}</td>
                        <td class="px-2 py-1 border-r border-line">{{ item.unit }}</td>
                        <td class="px-2 py-1 border-r border-line text-right font-mono">{{ item.quantity }}</td>
                        <td class="px-2 py-1 border-r border-line text-right font-mono">{{ item.unitPrice }}</td>
                        <td class="px-2 py-1 text-right font-mono font-700">{{ fmtMoney(item.total) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- 未完善提示 -->
            <div v-if="store.incompleteReasons(f).length" class="flex items-center gap-1.5 mt-1">
              <span class="i-lucide-triangle-alert text-12px text-warn" />
              <span class="text-11px text-warn">{{ store.incompleteReasons(f).join('、') }}</span>
            </div>

            <!-- OCR 错误 -->
            <div v-if="f.ocrError" class="text-11px text-danger mt-1">
              {{ f.ocrError }}
            </div>
          </div>

          <!-- 操作 -->
          <div class="flex flex-col gap-1 shrink-0">
            <button class="icon-btn" title="识别" :disabled="f.ocrStatus === 'running'">
              <span class="i-lucide-scan-text text-14px" />
            </button>
            <button class="icon-btn" title="编辑">
              <span class="i-lucide-square-pen text-14px" />
            </button>
            <button class="icon-btn-danger" title="删除">
              <span class="i-lucide-trash-2 text-14px" />
            </button>
          </div>
        </div>
      </div>

      <div v-if="!displayFiles.length" class="border border-line bg-panel p-8 text-center text-ink-faint text-13px">
        {{ filterIncomplete ? '没有未完善的文档' : '尚未上传任何文档 · 上传后进入识别队列' }}
      </div>
    </div>
  </div>
</template>
