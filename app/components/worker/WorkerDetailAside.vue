<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { WorkerCrew, WorkerRelatedPerson } from '~/lib/worker/detail'

defineProps<{
  crew: DeepReadonly<WorkerCrew> | null
  relatedWorkers: DeepReadonly<WorkerRelatedPerson[]>
}>()
</script>

<template>
  <div class="grid gap-4">
    <section class="panel p-4">
      <SectionHeader title="所属班组" />
      <template v-if="crew">
        <p class="m-0 text-14px font-700">
          {{ crew.name }}
        </p>
        <p class="m-0 mt-2 text-12px text-ink-soft">
          负责人：{{ crew.contactName || '—' }}
        </p>
        <NuxtLink :to="`/base/crew/${crew.id}`" class="mt-3 inline-flex text-12px text-brand">
          查看班组详情
        </NuxtLink>
      </template>
      <p v-else class="m-0 mt-2 text-12px text-ink-faint">
        未加入班组。
      </p>
    </section>

    <section class="panel p-4">
      <SectionHeader title="亲属与关联人员" />
      <ul v-if="relatedWorkers.length" class="m-0 grid list-none gap-2 p-0">
        <li v-for="person in relatedWorkers" :key="person.id" class="rounded border border-line p-3">
          <NuxtLink :to="`/base/worker/${person.id}`" class="text-12px font-700 text-brand">
            {{ person.name }}
          </NuxtLink>
          <p class="m-0 mt-1 text-11px text-ink-faint">
            {{ person.trade || '未设置工种' }} · {{ person.source === 'family' ? '亲属组' : '历史关联' }}
          </p>
        </li>
      </ul>
      <p v-else class="m-0 mt-2 text-12px text-ink-faint">
        暂无亲属或历史关联。
      </p>
    </section>
  </div>
</template>
