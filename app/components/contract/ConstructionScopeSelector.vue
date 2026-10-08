<script setup lang="ts">
import type { ConstructionScopeRead, ConstructionScopeRepository, ConstructionScopeResult, ConstructionScopeSource } from '~/lib/construction-scope/contract'
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, watch } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { useKitUI } from '~/composables/useKitUI'
import { constructionScopeSourceKey } from '~/lib/construction-scope/contract'
import { createConstructionScopeRepository } from '~/lib/construction-scope/repository'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'

const props = defineProps<{ source: ConstructionScopeSource, disabledReason?: string, repository?: ConstructionScopeRepository }>()
const emit = defineEmits<{ saved: [result: ConstructionScopeResult] }>()
const repository = props.repository ?? createConstructionScopeRepository((url, options) => $fetch<unknown, string>(url, { ...options, body: options?.body && typeof options.body === 'object' ? options.body : undefined, retry: 0 }))
const recovery = createCommandRecoveryStorage(() => sessionStorage)
const kit = useKitUI()
const read = shallowRef<ConstructionScopeRead | null>(null)
const pending = shallowRef<CommandRecoveryDescriptor | null>(null)
const reliable = shallowRef<ConstructionScopeResult | null>(null)
const selected = ref<string | null>(null)
const changed = ref(false)
const busy = ref(false)
const error = ref('')
let generation = 0
let active = true
const key = () => read.value ? commandRecoveryKey({ workspaceId: read.value.workspaceId, actorId: read.value.actorId, family: 'construction-scope', targetId: constructionScopeSourceKey(props.source) }) : ''
const baseDisabled = computed(() => props.disabledReason || (busy.value ? '正在核对当前来源' : pending.value ? '请先核对原关联编号' : !read.value ? '尚未读取真实来源' : !read.value.capabilities.includes('construction-scope:write') ? '当前身份无关联写入权限' : ''))
const disabled = computed(() => baseDisabled.value || (!read.value?.eligible || read.value.candidateState !== 'readable' ? read.value?.reason || '主合同候选来源尚不可用' : ''))
const fetchMains = async (keyword: string) => (read.value?.candidates ?? []).filter(row => `${row.id} ${row.name} ${row.no}`.includes(keyword)).map(row => ({ id: row.id, label: row.name, hint: row.no }))
function current(token: number) {
  if (!active || token !== generation)
    throw new Error('关联身份或来源已变化，请重新读取当前资料。')
}
function invalidate(message = '') {
  generation++
  read.value = null
  reliable.value = null
  pending.value = null
  busy.value = false
  error.value = message
}
bindReadAuthority(problem => invalidate(problem.message))
onDeactivated(() => {
  active = false
  invalidate()
})
onActivated(() => {
  if (!active) {
    active = true
    void load()
  }
})
onBeforeUnmount(() => {
  active = false
  generation++
})
async function load(token = ++generation, receipt?: ConstructionScopeResult) {
  busy.value = true
  error.value = ''
  try {
    const value = await repository.read(props.source)
    current(token)
    read.value = value
    pending.value = recovery.read(key())
    if (!changed.value)
      selected.value = value.relation?.mainId ?? null
    if (receipt) {
      if (!value.relation || value.relation.id !== receipt.relation.id || BigInt(value.relation.version) < BigInt(receipt.relation.version))
        throw new Error('已保存关联尚未得到同目标可靠后读，请保留原编号。')
      recovery.clear(key(), receipt.commandId)
      pending.value = null
      reliable.value = null
      selected.value = value.relation.mainId
      changed.value = false
      emit('saved', receipt)
    }
  }
  catch (cause) {
    if (active && token === generation)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active && token === generation)
      busy.value = false
  }
}
async function save(unbind = false) {
  const value = read.value
  if (!value?.projectId || !value.sourceBasis || baseDisabled.value || (!unbind && (disabled.value || !selected.value)))
    return
  const main = value.candidates.find(row => row.id === selected.value)
  if (!unbind && !main)
    return
  const accepted = await kit.confirm({ title: unbind ? '撤销施工主合同关联' : '保存施工主合同关联', message: '只更新本条来源的施工主合同归属，原合同、费用与实际付款保持原记录。', confirmLabel: unbind ? '撤销关联' : '保存关联' })
  if (!accepted || read.value !== value || baseDisabled.value || (!unbind && disabled.value))
    return
  const token = generation
  const descriptor: CommandRecoveryDescriptor = { workspaceId: value.workspaceId, actorId: value.actorId, family: 'construction-scope', targetId: constructionScopeSourceKey(props.source), scopeId: value.parentId, commandId: generateId('scope'), action: unbind ? 'unbind' : 'bind' }
  busy.value = true
  error.value = ''
  try {
    recovery.remember(key(), descriptor)
    pending.value = descriptor
    const result = await repository.execute({ workspaceId: value.workspaceId, actorId: value.actorId, commandId: descriptor.commandId, requiredCapability: 'construction-scope:write', source: props.source, projectId: value.projectId, action: unbind ? 'unbind' : 'bind', mainId: unbind ? null : main!.id, baseVersion: value.relation?.version ?? null, sourceBasis: value.sourceBasis, mainBasis: unbind ? null : main!.basis })
    current(token)
    reliable.value = result
    await load(token, result)
  }
  catch (cause) {
    if (active && token === generation)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active && token === generation)
      busy.value = false
  }
}
async function recover() {
  const descriptor = pending.value
  if (!descriptor || busy.value)
    return
  const token = generation
  busy.value = true
  error.value = ''
  try {
    const resolution = reliable.value ? { outcome: 'applied' as const, result: reliable.value } : await repository.resolve(descriptor)
    current(token)
    if (resolution.outcome === 'applied') {
      reliable.value = resolution.result
      await load(token, resolution.result)
    }
    else {
      recovery.clear(key(), descriptor.commandId)
      pending.value = null
      await load(token)
    }
  }
  catch (cause) {
    if (active && token === generation)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (active && token === generation)
      busy.value = false
  }
}
watch(() => constructionScopeSourceKey(props.source), () => {
  invalidate()
  selected.value = null
  changed.value = false
  void load()
}, { immediate: true })
</script>

<template>
  <section class="min-w-0 space-y-3 rounded-[var(--radius-sm)] border border-[var(--line)] p-4" aria-label="施工主合同归属">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="font-medium">
          施工主合同归属
        </h3>
        <p class="text-sm text-[var(--ink-soft)]">
          {{ read?.sourceName || '核对真实合同或原费用明细' }}
        </p>
      </div>
      <KitButton type="button" variant="ghost" size="sm" :disabled="busy" @click="load()">
        重新读取
      </KitButton>
    </div>
    <p v-if="error" role="alert" class="text-sm text-[var(--danger)]">
      {{ error }}
    </p>
    <p v-if="pending" class="text-sm">
      原关联编号 {{ pending.commandId }} 待核对。<KitButton type="button" variant="ghost" size="sm" :disabled="busy" @click="recover">
        核对原编号
      </KitButton>
    </p>
    <p v-if="read?.relation?.mainId" class="break-words text-sm" aria-label="已有施工主合同关联">
      已关联：<template v-if="read.existingMain?.state === 'resolved'">
        {{ read.existingMain.label }}<span v-if="read.existingMain.no"> · {{ read.existingMain.no }}</span>
      </template>
      <template v-else>
        {{ read.existingMain?.state === 'forbidden' ? '无权读取合同资料' : '合同资料暂不可读取' }} · 原编号 {{ read.relation.mainId }}
      </template>
    </p>
    <div v-if="read" class="flex flex-wrap items-end gap-3">
      <div class="min-w-0 flex-1 basis-60">
        <label class="mb-1 block text-sm">本条来源仅归属一份施工主合同</label>
        <LookupSelect :model-value="selected" :fetch="fetchMains" :disabled-reason="disabled" placeholder="按实际范围选择施工主合同" @update:model-value="selected = $event; changed = true" />
      </div>
      <KitButton type="button" :disabled="Boolean(disabled) || !selected || !changed" @click="save()">
        保存关联
      </KitButton>
      <KitButton type="button" variant="ghost" :disabled="Boolean(baseDisabled) || !read.relation?.mainId" @click="save(true)">
        撤销关联
      </KitButton>
    </div>
    <p v-if="disabled && !pending" class="text-sm text-[var(--ink-soft)]">
      {{ disabled }}
    </p>
    <p v-if="read && !read.relation?.mainId" class="text-sm text-[var(--ink-soft)]">
      未关联来源单列待核，不会自动选项目的第一份主合同。共用费用请先拆成真实原费用明细。
    </p>
  </section>
</template>
