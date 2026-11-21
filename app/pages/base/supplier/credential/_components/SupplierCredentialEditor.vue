<script setup lang="ts">
import type { SupplierCredentialEditorMode, SupplierCredentialFormValue } from '~/lib/supplier/credential-form'
import { computed } from 'vue'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { SUPPLIER_CREDENTIAL_CATEGORIES } from '~/lib/supplier/credentials'

const props = defineProps<{ mode: SupplierCredentialEditorMode, value: SupplierCredentialFormValue, fileName: string, busy: boolean, locked: boolean, error: string, conflict: boolean, unavailable: string, recheckSummary: readonly string[] }>()
const emit = defineEmits<{ patch: [patch: Partial<SupplierCredentialFormValue>], file: [file: File | null], submit: [], cancel: [], recheck: [] }>()
const title = computed(() => ({ upload: '上传证照原件', edit: '编辑类别和有效期', requirement: '维护证照要求', review: props.value.decision === 'qualified' ? '人工核验通过' : '退回证照资料', delete: '删除证照', restore: '撤回本次删除' })[props.mode])
const submitLabel = computed(() => props.busy ? '正在保存…' : props.locked ? '恢复原提交' : ({ upload: '保存原件', edit: '保存资料', requirement: '保存要求', review: props.value.decision === 'qualified' ? '确认通过' : '确认退回', delete: '确认删除', restore: '确认撤回' })[props.mode])
function input(event: Event) {
  return (event.target as HTMLInputElement).value
}
function selectFile(event: Event) {
  emit('file', (event.target as HTMLInputElement).files?.[0] ?? null)
}
</script>

<template>
  <Dialog :open="true" @update:open="open => { if (!open) $emit('cancel') }">
    <DialogContent :show-close="false" class="grid max-h-[85dvh] w-[min(36rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0" @interact-outside.prevent>
      <div class="border-b border-line p-4">
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription class="mb-0 mt-1 break-words text-12px leading-5 text-ink-soft">
          {{ mode === 'delete' ? `确认删除「${fileName}」？当前证照将停止使用，可撤回本次删除。` : mode === 'restore' ? '恢复同一份证照及原件；已失效的删除记录不能撤回。' : mode === 'review' ? '请核对当前必需原件和主档资料。关键资料变化后，本次结论会失效。' : '保存后重新读取当前资料；失败会保留输入。' }}
        </DialogDescription>
      </div>
      <form id="central-credential-form" class="grid min-h-0 gap-4 overflow-y-auto p-4" @submit.prevent="$emit('submit')">
        <section v-if="recheckSummary.length" class="border border-line bg-surface-2 p-3 text-12px leading-5 text-ink" aria-label="重新读取的当前资料">
          <h4 class="m-0 font-700">
            请与保留的输入核对
          </h4>
          <ul class="mb-0 mt-2 grid gap-1 pl-4">
            <li v-for="line in recheckSummary" :key="line" class="break-words">
              {{ line }}
            </li>
          </ul>
        </section>
        <fieldset :disabled="busy || locked || conflict" class="m-0 grid min-w-0 gap-3 border-0 p-0">
          <template v-if="mode === 'upload' || mode === 'edit'">
            <label v-if="mode === 'upload'" class="grid min-w-0 gap-1 text-12px text-ink-soft">选择原件
              <input class="field-input min-w-0 w-full" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" @change="selectFile">
              <span v-if="fileName" class="break-words text-ink">已选：{{ fileName }}</span>
            </label>
            <label class="grid gap-1 text-12px text-ink-soft">证照类别
              <select class="field-input w-full" :value="value.category" @change="$emit('patch', { category: input($event) as SupplierCredentialFormValue['category'] })"><option v-for="category in SUPPLIER_CREDENTIAL_CATEGORIES" :key="category" :value="category">{{ category }}</option></select>
            </label>
            <label class="grid gap-1 text-12px text-ink-soft">生效日期（选填）<input class="field-input min-w-0 w-full" type="date" :value="value.validFrom" @input="$emit('patch', { validFrom: input($event) })"></label>
            <label class="flex items-center gap-2 text-12px text-ink"><input type="checkbox" :checked="value.longTerm" @change="$emit('patch', { longTerm: ($event.target as HTMLInputElement).checked })">长期有效</label>
            <label v-if="!value.longTerm" class="grid gap-1 text-12px text-ink-soft">到期日期（选填）<input class="field-input min-w-0 w-full" type="date" :min="value.validFrom || undefined" :value="value.expiresAt" @input="$emit('patch', { expiresAt: input($event) })"></label>
          </template>
          <template v-else-if="mode === 'requirement'">
            <p class="m-0 text-13px font-700 text-ink">
              {{ value.category }}
            </p>
            <label class="grid gap-1 text-12px text-ink-soft">要求状态<select class="field-input w-full" :value="value.requirement" @change="$emit('patch', { requirement: input($event) as SupplierCredentialFormValue['requirement'] })"><option value="required">需提供</option><option value="optional">可选</option><option value="not_applicable">不适用</option></select></label>
            <label class="grid gap-1 text-12px text-ink-soft">要求原因<textarea class="field-input min-h-24 w-full resize-y" :required="value.requirement === 'required'" :value="value.reason" @input="$emit('patch', { reason: input($event) })" /></label>
          </template>
          <label v-else-if="mode === 'review'" class="grid gap-1 text-12px text-ink-soft">{{ value.decision === 'rejected' ? '退回原因' : '核验备注（选填）' }}<textarea class="field-input min-h-24 w-full resize-y" :required="value.decision === 'rejected'" :value="value.note" @input="$emit('patch', { note: input($event) })" /></label>
        </fieldset>
        <div v-if="error" class="border border-danger/30 bg-danger-soft p-3 text-12px leading-5 text-danger-ink" role="alert">
          {{ error }}
        </div>
        <p v-if="unavailable && !busy" class="m-0 text-12px leading-5 text-warn-ink" role="status">
          {{ unavailable }}
        </p>
        <p v-if="locked && !conflict" class="m-0 text-12px leading-5 text-ink-soft">
          上次提交结果尚未确认。恢复原提交会使用同一请求核对结果，不重复生成证照。
        </p>
        <button v-if="conflict || unavailable" type="button" class="btn-secondary justify-self-start" :disabled="busy" @click="$emit('recheck')">
          重新核对当前资料
        </button>
      </form>
      <div class="flex flex-wrap justify-end gap-2 border-t border-line p-4">
        <button type="button" class="btn-secondary" :disabled="busy" @click="$emit('cancel')">
          取消
        </button>
        <button form="central-credential-form" type="submit" :class="mode === 'delete' ? 'btn-danger' : 'btn-primary'" :disabled="busy || conflict || Boolean(unavailable)">
          {{ submitLabel }}
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
