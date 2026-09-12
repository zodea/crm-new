<script setup lang="ts">
import type { TaxpayerVerificationDraft } from '~/lib/supplier/taxpayer-verification'
import { useClipboard } from '@vueuse/core'
import { shallowRef } from 'vue'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { TAXPAYER_TYPES, TAXPAYER_VERIFICATION_LABELS } from '~/lib/supplier/taxpayer-verification'

const props = defineProps<{ value: TaxpayerVerificationDraft, taxNo: string, busy: boolean, locked: boolean, conflict: boolean, error: string, summary: string }>()
defineEmits<{ patch: [value: Partial<TaxpayerVerificationDraft>], submit: [], cancel: [], recheck: [] }>()
const { copy, isSupported } = useClipboard()
const copyMessage = shallowRef('')
async function copyTaxNo() {
  try {
    if (!isSupported.value) {
      copyMessage.value = '当前环境不支持自动复制，请手工复制此税号'
      return
    }
    await copy(props.taxNo)
    copyMessage.value = '核验税号已复制'
  }
  catch { copyMessage.value = '复制失败，请手工复制此税号' }
}
</script>

<template>
  <Dialog :open="true" @update:open="value => { if (!value) $emit('cancel') }">
    <DialogContent :show-close="false" class="grid max-h-[85dvh] w-[min(36rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0" @interact-outside.prevent>
      <div class="border-b border-line p-4">
        <DialogTitle>记录纳税人核验结果</DialogTitle>
        <DialogDescription class="mb-0 mt-1 text-12px leading-5 text-ink-soft">
          验证码和查询由你在官网完成；未查到保持未核验。此操作只保存人工核验，主档其他未保存内容继续保留。
        </DialogDescription>
      </div>
      <form id="supplier-taxpayer-form" class="grid min-h-0 gap-3 overflow-y-auto p-4" @submit.prevent="$emit('submit')">
        <div class="min-w-0 border border-line bg-surface-2 p-3 text-12px leading-5">
          <div class="flex flex-wrap items-start gap-2">
            <span class="min-w-0 flex-1 break-all">本次核验税号：{{ taxNo }}</span>
            <button type="button" class="btn-secondary focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2" @click="copyTaxNo">
              复制本次税号
            </button>
          </div>
          <p v-if="copyMessage" class="mb-0 mt-1" role="status">
            {{ copyMessage }}
          </p>
        </div>
        <p v-if="summary" class="m-0 break-words text-12px leading-5 text-warn-ink" role="status">
          {{ summary }}
        </p>
        <fieldset :disabled="busy || locked || conflict" class="m-0 grid min-w-0 gap-3 border-0 p-0">
          <label class="grid gap-1 text-12px text-ink-soft">核验结果
            <select class="field-input w-full" :value="value.status" @change="$emit('patch', { status: ($event.target as HTMLSelectElement).value as TaxpayerVerificationDraft['status'] })">
              <option v-for="(label, status) in TAXPAYER_VERIFICATION_LABELS" :key="status" :value="status">{{ label }}</option>
            </select>
          </label>
          <label v-if="value.status === 'manually_confirmed'" class="grid gap-1 text-12px text-ink-soft">人工确认类型
            <select class="field-input w-full" :value="value.taxpayerType" @change="$emit('patch', { taxpayerType: ($event.target as HTMLSelectElement).value as TaxpayerVerificationDraft['taxpayerType'] })">
              <option v-for="type in TAXPAYER_TYPES" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
          <label class="grid gap-1 text-12px text-ink-soft">核验备注
            <textarea class="field-input min-h-24 w-full resize-y" :value="value.note" maxlength="10000" placeholder="查询范围、材料来源或未查到原因" @input="$emit('patch', { note: ($event.target as HTMLTextAreaElement).value })" />
          </label>
        </fieldset>
        <p v-if="error" class="m-0 border border-danger/30 bg-danger-soft p-3 text-12px leading-5 text-danger-ink" role="alert">
          {{ error }}
        </p>
        <p v-if="locked" class="m-0 text-12px leading-5 text-ink-soft">
          上次提交结果尚未确认，请恢复原提交核对结果。
        </p>
        <button v-if="conflict" type="button" class="btn-secondary justify-self-start" :disabled="busy || locked" @click="$emit('recheck')">
          重新核对当前主档
        </button>
      </form>
      <div class="flex flex-wrap justify-end gap-2 border-t border-line p-4">
        <button type="button" class="btn-secondary" :disabled="busy || locked" @click="$emit('cancel')">
          取消
        </button>
        <button form="supplier-taxpayer-form" type="submit" class="btn-primary" :disabled="busy || conflict">
          {{ busy ? '正在保存…' : locked ? '恢复原提交' : '保存核验记录' }}
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
