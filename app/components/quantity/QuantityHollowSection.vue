<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { computed } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { useQuantityHollowRead } from '~/composables/useQuantityHollowRead'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { quantityHollowPath, quantityHollowQuery, quantityHollowSourceQuery } from '~/lib/quantity/hollow-navigation'

const props = defineProps<{ projectId: string, unitId: string, origin: DataOriginDTO | null }>()
const route = useRoute()
const query = computed(() => quantityHollowQuery(props.projectId, props.unitId, props.origin))
const ui = useQuantityHollowRead(() => query.value)
const { current, loading, error } = ui
const create = computed(() => query.value && current.value?.data.targets.some(target => target.create.allowed) ? { path: quantityHollowPath(query.value, 'new'), query: quantityHollowSourceQuery(query.value, route.query) } : null)
const records = computed(() => (current.value?.data.records ?? []).map((record) => {
  const resolved = record.source.navigation ? resolveNavigationTarget(record.source.navigation) : null
  const target = resolved?.state === 'resolved' ? new URL(resolved.to, 'https://quantity.invalid') : null
  if (target && query.value) {
    for (const [key, value] of Object.entries(quantityHollowSourceQuery(query.value, route.query)))
      target.searchParams.set(key, value)
  }
  const to = target ? `${target.pathname}?${target.searchParams}` : null
  return { record, to }
}))
</script>

<template>
  <section id="section-hollow" class="panel grid min-w-0 gap-4 p-4" aria-label="户级空鼓检查与整改">
    <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <SectionHeader title="空鼓检查与整改" :mb="0" /><NuxtLink v-if="create" :to="create" class="btn-primary">
        记录空鼓检查
      </NuxtLink>
    </div>
    <p class="text-12px leading-5 text-ink-soft">
      检查归原户、分项和原责任。整改追加销记，不删除原记录，也不自动生成工资扣款或退款。
    </p>
    <p v-if="loading" role="status" class="text-12px">
      正在读取原户空鼓记录…
    </p><div v-else-if="error" class="grid gap-2 text-12px" role="alert">
      <p>{{ error }}</p><KitButton variant="secondary" class="justify-self-start" @click="ui.load">
        重新读取空鼓记录
      </KitButton>
    </div><template v-else-if="current">
      <p v-if="!records.length && !current.data.unavailable.length && current.data.targets.length" class="text-12px" role="status">
        暂未排查：当前原责任下尚无空鼓检查记录。
      </p><p v-else-if="!records.length && !current.data.targets.length && !current.data.unavailable.length" class="text-12px text-ink-faint">
        当前没有可用的原责任检查范围。
      </p><p v-for="(diagnostic, index) in current.data.unavailable" :key="index" class="break-words text-12px text-warn" role="alert">
        {{ diagnostic.message }}
      </p>
      <article v-for="row in records" :key="row.record.recordId" class="grid min-w-0 gap-2 rounded border border-line p-3 text-12px">
        <p class="break-words font-700">
          {{ row.record.location.locationLabel }} · {{ row.record.originalPartyName }}
        </p><p>
          {{ row.record.inspection.input.inspectedOn }} · 检查 {{ row.record.inspection.input.count }} 处 · 已整改 {{ row.record.rectifiedCount }} 处 · <strong :class="row.record.remainingCount ? 'text-warn' : 'text-ok'">未整改 {{ row.record.remainingCount }} 处</strong>
        </p><NuxtLink v-if="row.to" :to="row.to" class="cell--link justify-self-start">
          查看检查与整改
        </NuxtLink><p v-for="reason in row.record.source.reasons" v-else :key="reason" class="break-words text-ink-faint">
          {{ reason }}
        </p>
      </article>
    </template>
  </section>
</template>
