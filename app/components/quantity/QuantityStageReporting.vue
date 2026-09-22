<script setup lang="ts">
import type { QuantityStageWorkspace } from '~/lib/quantity/central-stages'
import KitButton from '~/components/ui/KitButton.vue'

const props = defineProps<{
  workspace: QuantityStageWorkspace
  selections: Record<string, string>
  readonly: boolean
}>()
defineEmits<{ select: [itemId: string, stageId: string], save: [itemId: string, stageId: string | null], cancel: [] }>()
function choices(itemId: string) {
  return props.workspace.stages.filter(stage => stage.completionMode === 'unit'
    && props.workspace.mappings.some(mapping => mapping.stageId === stage.id && mapping.itemId === itemId))
}
function currentId(itemId: string) {
  return props.workspace.mappings.find(mapping => mapping.itemId === itemId && mapping.isReportingStage)?.stageId ?? ''
}
function currentName(itemId: string) {
  return props.workspace.stages.find(stage => stage.id === currentId(itemId))?.name ?? '未指定'
}
</script>

<template>
  <section id="section-reporting" class="scroll-mt-4">
    <h2 class="mb-2 mt-0 text-14px font-800 text-ink">
      月度报量阶段
    </h2>
    <p class="mb-3 mt-0 text-12px leading-6 text-ink-soft">
      同一分项可参与多阶段进度，月度报量只读取这里明确选定的一个阶段。显示顺序不会改变报量选择。
    </p>
    <p v-if="readonly" class="mb-3 mt-0 text-12px text-ink-soft">
      请先保存或撤销阶段输入；没有写入权限时仅可查看当前选择。
    </p>
    <div v-if="workspace.items.length" class="grid min-w-0 gap-3">
      <div v-for="item in workspace.items" :key="item.id" class="grid min-w-0 grid-cols-1 items-end gap-3 rounded-[var(--radius-control)] border border-line p-3 md:grid-cols-[minmax(0,1fr)_minmax(160px,1fr)_auto]">
        <div class="min-w-0">
          <p class="m-0 text-13px font-700 text-ink">
            {{ item.name }} <span class="text-12px font-400 text-ink-soft">{{ item.unit || '单位未填写' }}</span>
          </p>
          <p class="mb-0 mt-1 text-12px text-ink-soft">
            {{ item.code }} · {{ item.trade }} · 当前：{{ currentName(item.id) }}
          </p>
        </div>
        <label class="min-w-0">
          <span class="field-label">报量阶段</span>
          <select :value="selections[item.id] ?? currentId(item.id)" :disabled="readonly" class="field-input w-full" :aria-label="`${item.name}的报量阶段`" @change="$emit('select', item.id, ($event.target as HTMLSelectElement).value)">
            <option value="">未指定</option>
            <option v-for="stage in choices(item.id)" :key="stage.id" :value="stage.id">{{ stage.name }} · {{ stage.code }}</option>
          </select>
        </label>
        <KitButton variant="secondary" :disabled="readonly || (selections[item.id] ?? currentId(item.id)) === currentId(item.id)" :aria-label="`保存${item.name}的报量阶段`" @click="$emit('save', item.id, selections[item.id] || null)">
          保存选择
        </KitButton>
      </div>
      <div v-if="workspace.items.some(item => (selections[item.id] ?? currentId(item.id)) !== currentId(item.id))">
        <KitButton variant="ghost" :disabled="readonly" @click="$emit('cancel')">
          撤销未保存的报量选择
        </KitButton>
      </div>
    </div>
    <p v-else class="m-0 rounded-[var(--radius-control)] bg-surface-2 p-3 text-12px text-ink-soft">
      本项目尚无计量分项。先建立户型模板中的分项，再关联施工阶段。
    </p>
  </section>
</template>
