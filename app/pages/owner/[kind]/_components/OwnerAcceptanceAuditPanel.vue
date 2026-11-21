<script setup lang="ts">
import type { OwnerAcceptanceLifecycleEventSource } from '~/lib/owner-document/central-repository'

defineProps<{
  events: OwnerAcceptanceLifecycleEventSource[]
}>()

function eventLabel(action: string): string {
  return {
    'submit': '提交验收',
    'accept': '确认验收',
    'start-warranty': '进入保修',
    'confirm-expiry': '确认保修到期',
  }[action] ?? action
}
</script>

<template>
  <section class="panel p-4" aria-labelledby="acceptance-audit-title">
    <SectionHeader id="acceptance-audit-title" title="生命周期审计" subtitle="状态命令由服务端按顺序追加，终态不可改写" />
    <ol v-if="events.length" class="mt-3 grid gap-2" aria-label="验收生命周期审计记录">
      <li v-for="event in events" :key="event.id" class="grid gap-1 border-l-2 border-brand bg-surface-2 px-3 py-2 text-12px sm:grid-cols-[10rem_1fr_auto] sm:items-center">
        <strong>{{ eventLabel(event.action) }}</strong>
        <span class="text-ink-soft">{{ event.fromStatus }} → {{ event.toStatus }} · {{ event.actorName || event.actorId }}</span>
        <time class="font-mono text-ink-faint">{{ event.occurredAt }}</time>
        <p v-if="event.note" class="sm:col-span-3 text-ink-soft">
          {{ event.note }}
        </p>
      </li>
    </ol>
    <StatePanel v-else class="mt-3" kind="empty" title="暂无历史审计" description="存量记录未追认伪造审计；下一次真实状态命令会开始留痕。" compact />
  </section>
</template>
