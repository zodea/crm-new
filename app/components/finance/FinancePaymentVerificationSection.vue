<script setup lang="ts">
import type { PaymentVerificationInput, PaymentVerificationState } from '~/lib/finance/payment-verification'
import type { FileRefRecord } from '~/lib/forms/file-refs'

const props = defineProps<{ state?: PaymentVerificationState, attachments: readonly FileRefRecord[], disabled: boolean, unsaved: boolean }>()
const emit = defineEmits<{ verify: [] }>()
const input = defineModel<PaymentVerificationInput>({ required: true })
const originals = computed(() => props.attachments.filter(file => !file.deletedAt && 'sha256' in file && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)))
function chooseFile(id: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  input.value = { ...input.value, fileIds: checked ? [...input.value.fileIds, id] : input.value.fileIds.filter(value => value !== id) }
}
</script>

<template>
  <section class="min-w-0 rounded-[var(--radius-card)] border border-line bg-white p-4" aria-label="历史付款业务核验">
    <h2 class="text-14px font-700">
      历史付款业务核验
    </h2>
    <p class="mt-2 break-words text-12px text-ink-muted">
      核实原费用、已确认结算与累计批复后再确认新支付。两项金额均为累计结论，本次银行实付继续在支付记录填写。原批复、原申请及既有现金保持原事实。
    </p>
    <p v-if="state?.message" class="mt-2 break-words text-12px" role="status">
      {{ state.message }}
    </p>
    <dl v-if="state?.proof" class="mt-3 grid min-w-0 gap-3 sm:grid-cols-2" aria-label="已冻结业务核验">
      <div>
        <dt class="text-12px text-ink-muted">
          核实累计应付
        </dt><dd class="font-mono">
          {{ state.proof.actualDueAmount }}
        </dd>
      </div>
      <div>
        <dt class="text-12px text-ink-muted">
          核实累计可付
        </dt><dd class="font-mono">
          {{ state.proof.cumulativePayableAmount }}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-12px text-ink-muted">
          核验人
        </dt><dd class="break-words">
          {{ state.proof.actorId }}
        </dd>
      </div>
      <div>
        <dt class="text-12px text-ink-muted">
          核验时间
        </dt><dd class="break-words">
          {{ state.proof.verifiedAt }}
        </dd>
      </div>
      <div class="min-w-0 sm:col-span-2">
        <dt class="text-12px text-ink-muted">
          核验依据
        </dt><dd class="whitespace-pre-wrap break-words">
          {{ state.proof.basis }}
        </dd>
      </div>
    </dl>
    <p v-if="unsaved" class="mt-3 text-12px text-warn-ink">
      请先保存申请编辑和依据原件，再核验已保存版本。
    </p>
    <div class="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
      <label class="field-block min-w-0"><span class="field-label">核实累计应付金额</span><input v-model="input.actualDueAmount" class="field-input" inputmode="decimal" aria-label="核实累计应付金额" :disabled="disabled"></label>
      <label class="field-block min-w-0"><span class="field-label">核实累计可付金额</span><input v-model="input.cumulativePayableAmount" class="field-input" inputmode="decimal" aria-label="核实累计可付金额" :disabled="disabled"></label>
      <label class="field-block min-w-0 sm:col-span-2"><span class="field-label">业务核验依据</span><textarea v-model="input.basis" class="field-input min-h-80px" maxlength="2000" aria-label="业务核验依据" :disabled="disabled" /></label>
    </div>
    <fieldset class="mt-3 min-w-0" :disabled="disabled">
      <legend class="field-label">
        采用已保存依据原件
      </legend>
      <label v-for="file in originals" :key="file.id" class="mt-2 flex min-w-0 items-start gap-2 text-12px">
        <input type="checkbox" :checked="input.fileIds.includes(file.id)" :aria-label="`核验依据 ${file.fileName}`" @change="chooseFile(file.id, $event)">
        <span class="break-all">{{ file.fileName }} · {{ file.fileSize }} 字节</span>
      </label>
      <p v-if="!originals.length" class="text-12px text-ink-muted">
        先保存实际依据原件；历史缺件元数据不能代替真实正文。
      </p>
    </fieldset>
    <KitButton class="mt-4" type="button" :disabled="disabled || unsaved || !originals.length" @click="emit('verify')">
      保存业务核验
    </KitButton>
  </section>
</template>
