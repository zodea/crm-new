<script setup lang="ts">
import type { SupplierCredentialReviewProof, SupplierCredentialStatus } from '~/lib/supplier/credential-contract'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUS_TONE } from '~/lib/supplier/status'
import { formatShanghaiDateTime } from '~/lib/util/datetime'

defineProps<{ status: SupplierCredentialStatus, review: SupplierCredentialReviewProof | null, reviewCurrent?: boolean, reviewHistory?: SupplierCredentialReviewProof[], canWrite: boolean }>()
defineEmits<{ review: [decision: 'qualified' | 'rejected'] }>()
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="central-credential-status-title">
    <div class="flex flex-wrap items-start gap-3">
      <div class="min-w-0 flex-1">
        <h3 id="central-credential-status-title" class="m-0 text-14px font-700 text-ink">
          资料核验状态
        </h3>
        <p class="mb-0 mt-1 text-12px leading-5 text-ink-soft">
          文件齐全进入待核验；人工通过或退回会记录核验凭证。
        </p>
      </div>
      <KitStatusTag :tone="CREDENTIAL_STATUS_TONE[status]">
        {{ CREDENTIAL_STATUS_LABEL[status] }}
      </KitStatusTag>
    </div>
    <p v-if="review" class="mb-0 mt-3 break-words text-12px leading-5 text-ink-soft">
      最近人工核验：<time :datetime="review.reviewedAt">{{ formatShanghaiDateTime(review.reviewedAt, '历史时间未知') }}</time> · {{ review.actorId || '历史核验人未知' }}
      <span v-if="review.note"> · {{ review.note }}</span>
      <span v-if="reviewCurrent === false" class="block text-warn">历史凭证已保留；当前资料或有效期已变化，不能据此认定当前资料已核验。</span>
    </p>
    <details v-if="(reviewHistory?.length ?? 0) > 1" class="mt-2 text-12px leading-5 text-ink-soft">
      <summary class="cursor-pointer">
        查看 {{ reviewHistory?.length }} 次人工核验历史
      </summary>
      <ul class="mb-0 pl-4">
        <li v-for="(proof, index) in reviewHistory" :key="proof.historyIdentity?.id ?? `${proof.reviewedAt}-${index}`" class="break-words">
          {{ formatShanghaiDateTime(proof.reviewedAt, '历史时间未知') }} · {{ proof.decision === 'qualified' ? '通过' : '退回' }} · {{ proof.actorId || '历史核验人未知' }}<span v-if="proof.note"> · {{ proof.note }}</span>
        </li>
      </ul>
    </details>
    <div v-if="canWrite" class="mt-3 flex flex-wrap justify-end gap-2">
      <button type="button" class="btn-secondary" :disabled="status !== 'reviewing'" title="仅齐全待核验状态可以人工退回" @click="$emit('review', 'rejected')">
        退回整改
      </button>
      <button type="button" class="btn-primary" :disabled="status !== 'reviewing'" title="仅齐全待核验状态可以人工通过" @click="$emit('review', 'qualified')">
        人工核验通过
      </button>
    </div>
  </section>
</template>
