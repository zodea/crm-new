<script setup lang="ts">
import type { PayrollAConfigRead, PayrollALine, PayrollAPriceDraft, PayrollAPriceRevision, PayrollAPriceScope } from '~/lib/payroll/central-a-contract'
import { computed, onActivated, onDeactivated, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '~/components/ui/dialog'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{ open: boolean, line: PayrollALine, projectId: string, month: string, crewId: string | null, leaderWorkerId: string, returnTo: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'saved': [] }>()
const store = usePayrollStore()
const read = shallowRef<PayrollAConfigRead | null>(null)
const latest = shallowRef<PayrollAConfigRead | null>(null)
const verified = shallowRef(false)
const draft = ref<PayrollAPriceDraft>({ priceId: null, itemId: '', unit: null, mode: 'baseline', workerId: null, effectiveMonth: '', unitPrice: null, scope: { kind: 'project' } })
const error = shallowRef('')
const busy = shallowRef(false)
const active = shallowRef(true)
const pending = computed(() => read.value ? store.getAPending(read.value) : null)
const readonly = computed(() => {
  const value = latest.value ?? read.value
  return !verified.value || !value || value.context.readonly || !!value.readonlyReasons.length || !value.context.capabilities.includes('payroll:write')
})
const target = () => JSON.stringify([props.projectId, props.month, props.crewId, props.leaderWorkerId, props.line.id])
const config = computed(() => ({ path: '/subcontract/payroll/config', query: { origin: 'real', project: props.projectId, month: props.month, crew: props.crewId || '', leader: props.leaderWorkerId, returnTo: props.returnTo } }))
let sequence = 0
const same = (key: string, request: number) => active.value && props.open && key === target() && request === sequence
const scopeKey = (scope: PayrollAPriceScope) => scope.kind === 'project' ? 'project' : JSON.stringify(scope.cells.map(cell => [cell.unitId, cell.roomId, cell.itemId]).sort())
function selectPrice(mode: PayrollAPriceDraft['mode'], scope: PayrollAPriceScope, applied?: PayrollAPriceRevision) {
  const existing = applied ?? read.value?.prices.filter(price => price.itemId === props.line.itemId && price.unit === props.line.unit && price.mode === mode && price.workerId === (mode === 'worker-exception' ? props.line.workerId : null) && scopeKey(price.scope) === scopeKey(scope) && price.effectiveMonth <= props.month).sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth) || b.revision - a.revision)[0]
  draft.value = { priceId: existing?.priceId ?? null, itemId: props.line.itemId, unit: props.line.unit, mode, workerId: mode === 'worker-exception' ? props.line.workerId : null, effectiveMonth: props.month, unitPrice: existing?.unitPrice ?? null, scope }
}
async function load(preserve = false) {
  const key = target()
  const request = ++sequence
  busy.value = true
  verified.value = false
  error.value = ''
  try {
    const value = await store.loadAConfig({ origin: 'real' }, { projectId: props.projectId, month: props.month, crewId: props.crewId, leaderWorkerId: props.leaderWorkerId })
    if (!same(key, request))
      return
    latest.value = value
    verified.value = true
    if (!preserve || !read.value) {
      read.value = value
      const applied = value.prices.find(price => props.line.priceRevisionIds.includes(price.id))
      selectPrice(applied?.mode ?? 'baseline', applied?.scope ?? { kind: 'project' }, applied)
    }
  }
  catch (cause) {
    if (same(key, request))
      error.value = toErrorMessage(cause)
  }
  finally {
    if (same(key, request))
      busy.value = false
  }
}
function close(value: boolean) {
  if (!busy.value && !pending.value)
    emit('update:open', value)
}
async function save(recover = false) {
  const value = read.value
  const operation = pending.value
  if (!value || busy.value || (!recover && (operation || readonly.value)))
    return
  const key = target()
  const request = sequence
  busy.value = true
  try {
    if (recover && operation)
      await store.recoverA(operation)
    else
      await store.saveAPrices(value, [{ ...draft.value }])
    if (!same(key, request))
      return
    const submitted = operation ?? store.getAPending(value)
    if (!submitted)
      throw new Error('原调价提交回执不可读，请保留原稿并核对。')
    const refreshed = await store.loadAConfig({ origin: 'real' }, value.scope)
    if (same(key, request)) {
      latest.value = refreshed
      store.acknowledgeA(submitted, refreshed)
      emit('saved')
      emit('update:open', false)
    }
  }
  catch (cause) {
    if (same(key, request))
      error.value = toErrorMessage(cause)
  }
  finally {
    if (same(key, request))
      busy.value = false
  }
}
function patch(value: Partial<PayrollAPriceDraft>) {
  if (value.mode && value.mode !== draft.value.mode)
    selectPrice(value.mode, draft.value.scope)
  else
    draft.value = { ...draft.value, ...value }
}
watch([() => props.open, target], ([open]) => {
  if (open && active.value)
    void load()
}, { immediate: true })
onDeactivated(() => {
  active.value = false
  sequence += 1
  busy.value = false
})
onActivated(() => {
  const returning = !active.value
  active.value = true
  if (returning && props.open)
    void load(true)
})
onScopeDispose(() => {
  active.value = false
  sequence += 1
})
</script>

<template>
  <Dialog :open="open && active" @update:open="close">
    <DialogContent class="w-[min(780px,calc(100dvw-24px))]" @escape-key-down="(busy || pending) && $event.preventDefault()" @interact-outside="(busy || pending) && $event.preventDefault()">
      <DialogTitle>调整工资单价</DialogTitle><DialogDescription>统一改影响当前负责人的分项基准；单独改仅保留该工人的例外。保存后仍须重新核对未发工资。</DialogDescription>
      <div class="grid max-h-[65dvh] min-w-0 gap-3 overflow-y-auto">
        <PayrollAPriceEditor v-if="read" :draft="{ ...draft, priceId: null }" :read="read" :disabled="busy || !!pending || readonly" identity-locked @patch="patch" @remove="close(false)" /><p v-if="error" role="alert" class="text-12px text-danger">
          {{ error }}
        </p><p v-for="reason in read?.readonlyReasons || []" :key="reason" class="text-12px text-warn">
          {{ reason }}
        </p><NuxtLink :to="config" class="cell--link">
          进入完整工资配置
        </NuxtLink>
      </div>
      <DialogFooter>
        <KitButton variant="secondary" :disabled="busy || !!pending" @click="close(false)">
          取消
        </KitButton><KitButton v-if="pending" :disabled="busy" @click="save(true)">
          核对原提交
        </KitButton><KitButton v-else :disabled="busy || !read || readonly" @click="save()">
          保存单价
        </KitButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
