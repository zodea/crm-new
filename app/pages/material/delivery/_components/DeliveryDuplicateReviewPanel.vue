<script setup lang="ts">
import type { DeliveryDuplicatePreview } from '~/composables/useDeliveryRecognitionWorkspace'
import type { DeliveryDuplicate } from '~/stores/delivery'

const props = defineProps<{
  duplicates: readonly DeliveryDuplicate[]
  selectedId: string | null
  preview: DeliveryDuplicatePreview | null
  loading: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  confirm: [id: string]
}>()

const open = shallowRef(false)
const selected = computed(() => props.duplicates.find(item => item.id === props.selectedId) ?? props.duplicates[0])
const comparisonChecks = computed(() => selected.value
  ? [
      { label: '送货单号', value: selected.value.orderNo || '待从原件核对' },
      { label: '分供方', value: selected.value.supplierText || '待从原件核对' },
      { label: '所属项目', value: selected.value.siteText || '待从归档资料核对' },
    ]
  : [])

function selectFirstWhenOpened() {
  if (open.value && selected.value && selected.value.id !== props.selectedId)
    emit('select', selected.value.id)
}

watch(open, selectFirstWhenOpened)
</script>

<template>
  <section v-if="duplicates.length" class="panel overflow-hidden">
    <div class="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <span class="i-lucide-copy-check text-16px text-ink-soft" />
      <div class="min-w-0 flex-1">
        <div class="text-12px font-800 text-ink">
          重复核查区 · {{ duplicates.length }} 份
        </div>
        <div class="mt-0.5 text-10px text-ink-faint">
          重复件不进入主处理队列；查看两份原件，只核对单号、分供方和所属项目，不核对编码。
        </div>
      </div>
      <button type="button" class="btn-secondary px-2.5 py-1.5 text-10px" @click="open = !open">
        <span :class="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="mr-1" />
        {{ open ? '收起' : '打开核查' }}
      </button>
    </div>

    <div v-if="open && selected" class="border-t border-line bg-surface-2 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-11px font-800 text-ink">原件对照</span>
        <span class="text-10px text-ink-faint">{{ selected.name }} ↔ {{ selected.representativeName }}</span>
        <span v-if="selected.reviewStatus === 'reviewed'" class="chip-ok text-9px">已核查</span>
        <div class="flex-1" />
        <select
          v-if="duplicates.length > 1"
          :value="selected.id"
          class="field-input h-7 min-w-40 py-1 text-10px"
          aria-label="选择重复件"
          @change="emit('select', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="duplicate in duplicates" :key="duplicate.id" :value="duplicate.id">
            {{ duplicate.name }}
          </option>
        </select>
      </div>

      <div class="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <div class="mb-1.5 text-10px font-700 text-danger-ink">
            重复件原件
          </div>
          <div class="delivery-duplicate-paper">
            <template v-if="preview?.duplicateUrl">
              <iframe v-if="preview.duplicateKind === 'pdf'" :src="preview.duplicateUrl" :title="`${selected.name} 原件`" class="h-52 w-full border-0 bg-white" />
              <img v-else :src="preview.duplicateUrl" :alt="`${selected.name} 原件`" class="max-h-52 max-w-full object-contain">
            </template>
            <div v-else-if="loading" class="text-10px text-ink-faint">
              正在载入原件预览…
            </div>
            <div v-else class="text-10px text-ink-faint">
              当前会话暂时无法读取重复件原件
            </div>
          </div>
        </div>
        <div>
          <div class="mb-1.5 text-10px font-700 text-ok-ink">
            已归档代表件原件
          </div>
          <div class="delivery-duplicate-paper">
            <template v-if="preview?.representativeUrl">
              <iframe v-if="preview.representativeKind === 'pdf'" :src="preview.representativeUrl" :title="`${selected.representativeName} 原件`" class="h-52 w-full border-0 bg-white" />
              <img v-else :src="preview.representativeUrl" :alt="`${selected.representativeName} 原件`" class="max-h-52 max-w-full object-contain">
            </template>
            <div v-else-if="loading" class="text-10px text-ink-faint">
              正在载入原件预览…
            </div>
            <div v-else class="text-10px text-ink-faint">
              当前会话暂时无法读取代表件原件
            </div>
          </div>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-1.5">
        <span
          v-for="item in comparisonChecks"
          :key="item.label"
          class="chip-ok text-9px"
        >
          <b class="mr-1">{{ item.label }}</b>{{ item.value }}
        </span>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <span class="flex-1 text-10px text-ink-faint">编码和文件内容已由重复检测处理，不在人工核查范围内。</span>
        <button type="button" class="btn-primary px-2.5 py-1.5 text-10px" :disabled="selected.reviewStatus === 'reviewed'" @click="emit('confirm', selected.id)">
          <span class="i-lucide-check mr-1" />
          {{ selected.reviewStatus === 'reviewed' ? '已确认一致' : '确认与已归档一致' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.delivery-duplicate-paper {
  min-height: 13rem;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 0.75rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-btn);
  background: var(--panel);
}
</style>
