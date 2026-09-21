<script setup lang="ts">
import type { QuantityHollowRecord } from '~/lib/quantity/central-hollow-contract'
import SectionHeader from '~/components/ui/SectionHeader.vue'

defineProps<{ record: QuantityHollowRecord, revisionId?: string | null }>()
</script>

<template>
  <section class="panel grid min-w-0 gap-4 p-4" aria-label="空鼓检查与整改历史">
    <SectionHeader title="检查与整改记录" :mb="0" />
    <div class="grid min-w-0 gap-3">
      <article v-for="(revision, index) in record.revisions" :key="revision.revisionId" :data-hollow-revision="revision.revisionId" tabindex="-1" class="grid min-w-0 gap-2 rounded border p-3 text-12px" :class="revisionId === revision.revisionId ? 'border-brand bg-brand-soft' : 'border-line'">
        <h3 class="font-700">
          {{ index === 0 ? '原检查' : `检查修订 ${index}` }} · {{ revision.input.inspectedOn }} · 发现 {{ revision.input.count }} 处
        </h3><p v-if="revision.reason" class="whitespace-pre-wrap break-words leading-5">
          修订原因：{{ revision.reason }}
        </p><p class="whitespace-pre-wrap break-words leading-5">
          {{ revision.input.note || '检查说明未填写' }}
        </p><p class="break-words text-ink-faint">
          经办 {{ revision.actorId }} · {{ revision.createdAt }}
        </p>
      </article>
    </div>
    <div class="grid min-w-0 gap-3" aria-label="已登记整改">
      <p v-if="!record.rectifications.length" class="text-12px text-ink-faint">
        尚无整改销记。
      </p><article v-for="event in record.rectifications" :key="event.id" class="grid min-w-0 gap-2 rounded border border-line p-3 text-12px">
        <h3 class="font-700">
          {{ event.rectifiedOn }} · 本次整改 {{ event.count }} 处
        </h3><p class="whitespace-pre-wrap break-words leading-5">
          {{ event.note || '整改说明未填写' }}
        </p><p class="break-words text-ink-faint">
          经办 {{ event.actorId }} · {{ event.createdAt }}
        </p>
      </article>
    </div>
  </section>
</template>
