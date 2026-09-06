<script setup lang="ts">
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { auxiliaryMoney } from '~/lib/auxiliary-contract/presentation'

const props = defineProps<{ projectId?: string, supplierId?: string }>()
const route = useRoute()
const repository = useNuxtApp().$repositories.auxiliaryContracts
const { data, problem, load } = useAuxiliaryContractRead(() => repository.list({ kind: 'other_expense', projectId: props.projectId, supplierId: props.supplierId, origin: 'real' }))
const anchor = 'auxiliary-contract-journey'
const source = computed(() => validateAuxiliaryReturnTo(`${route.fullPath.split('#')[0]}#${anchor}`))
const to = computed(() => ({ path: '/contract/other-expense', query: { origin: 'real', projectId: props.projectId, supplierId: props.supplierId, returnTo: source.value ?? undefined } }))
function remember() {
  if (source.value)
    sessionStorage.setItem(`auxiliary-scroll:${source.value}`, String(document.querySelector('[data-shell-workspace]')?.scrollTop ?? 0))
}
async function refresh() {
  await load()
  await nextTick()
  if (route.hash !== `#${anchor}`)
    return
  const element = document.getElementById(anchor)
  const saved = source.value ? sessionStorage.getItem(`auxiliary-scroll:${source.value}`) : null
  const workspace = document.querySelector('[data-shell-workspace]')
  if (saved !== null && workspace)
    workspace.scrollTop = Number(saved) || 0
  else element?.scrollIntoView({ block: 'nearest' })
  element?.focus({ preventScroll: true })
}
watch(() => `${props.projectId}:${props.supplierId}`, refresh, { immediate: true })
onActivated(refresh)
</script>

<template>
  <section class="panel min-w-0 p-3" data-testid="auxiliary-journey">
    <SectionHeader title="其他支出合同" />
    <StatePanel v-if="problem" :kind="problem.code === 'forbidden' ? 'forbidden' : 'error'" :title="problem.message" :action-label="problem.retryable ? '重新加载' : ''" compact @action="refresh" />
    <div v-else-if="data" class="mt-2 flex flex-wrap items-center gap-4 text-13px">
      <span>{{ data.pagination.total }} 份 · 合同金额 {{ auxiliaryMoney(data.summary.real.amount) }}</span>
      <NuxtLink :id="anchor" :to="to" class="text-brand underline underline-offset-3" @click="remember">
        查看其他支出合同
      </NuxtLink>
    </div>
    <p v-else class="text-12px text-ink-soft">
      正在读取合同…
    </p>
  </section>
</template>
