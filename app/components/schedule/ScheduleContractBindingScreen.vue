<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { ScheduleContractBindingPreview } from '~/lib/schedule/contract-binding'
import { computed, shallowRef, watch } from 'vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  projectId: string
  groupId: string
}>()

const router = useRouter()
const store = useScheduleStore()
const { confirm, error: toastError, success } = useKitUI()

const selectedContractId = shallowRef<string | null>(null)
const preview = shallowRef<ScheduleContractBindingPreview | null>(null)
const initializing = shallowRef(false)
const previewing = shallowRef(false)
const fatalError = shallowRef('')
const previewError = shallowRef('')
let loadGeneration = 0
let previewGeneration = 0

const group = computed(() =>
  store.snapshot?.groups.find(candidate => candidate.id === props.groupId) ?? null,
)

const canChooseContract = computed(() =>
  Boolean(group.value && group.value.scopeBasis === 'provisional'),
)

async function fetchContracts(keyword: string): Promise<LookupOption[]> {
  const needle = keyword.trim().toLocaleLowerCase('zh-CN')
  return store.contracts
    .filter(contract =>
      !needle
      || contract.name.toLocaleLowerCase('zh-CN').includes(needle)
      || contract.no.toLocaleLowerCase('zh-CN').includes(needle),
    )
    .map(contract => ({
      id: contract.id,
      label: contract.name,
      hint: `${contract.no || '未编号'} · ${contract.lineCount} 条已拆清单`,
    }))
}

async function initialize() {
  const generation = ++loadGeneration
  initializing.value = false
  selectedContractId.value = null
  preview.value = null
  fatalError.value = ''
  previewError.value = ''
  if (!props.projectId || !props.groupId) {
    fatalError.value = '项目或楼栋分组参数缺失'
    return
  }
  initializing.value = true
  try {
    await Promise.all([
      store.loadProject(props.projectId),
      store.loadContracts(props.projectId),
    ])
    if (generation !== loadGeneration)
      return
    if (!store.snapshot)
      fatalError.value = '项目不存在或已删除'
    else if (!group.value)
      fatalError.value = '楼栋分组不存在、已删除或不属于当前项目'
    else if (group.value.scopeBasis !== 'provisional')
      fatalError.value = '该楼栋分组已经绑定施工合同，无需重复操作'
  }
  catch (cause) {
    if (generation !== loadGeneration)
      return
    fatalError.value = toErrorMessage(cause)
  }
  finally {
    if (generation === loadGeneration)
      initializing.value = false
  }
}

watch(
  () => [props.projectId, props.groupId] as const,
  () => {
    void initialize()
  },
  { immediate: true },
)

watch(selectedContractId, async (contractId) => {
  const generation = ++previewGeneration
  preview.value = null
  previewing.value = false
  previewError.value = ''
  if (!contractId || !canChooseContract.value)
    return
  previewing.value = true
  try {
    const result = await store.previewContractBinding(props.groupId, contractId)
    if (generation === previewGeneration)
      preview.value = result
  }
  catch (cause) {
    if (generation !== previewGeneration)
      return
    previewError.value = toErrorMessage(cause)
    toastError('合同差异复核失败', previewError.value)
  }
  finally {
    if (generation === previewGeneration)
      previewing.value = false
  }
})

function returnToSchedule() {
  return router.push({
    path: `/schedule/${props.projectId}`,
    query: { group: props.groupId },
  })
}

async function bindContract() {
  const current = preview.value
  if (!current?.canBind)
    return
  const warningText = current.warnings.length
    ? `；另有 ${current.warnings.length} 项警示已展示，不会自动纳入分组`
    : ''
  const approved = await confirm({
    variant: 'simple',
    title: `绑定施工合同「${current.contractName}」？`,
    message: `将把「${current.groupName}」的范围依据改为合同清单，保留现有工序、基线、完成事实和暂估量${warningText}。`,
    confirmLabel: '确认绑定',
  })
  if (!approved)
    return
  try {
    await store.bindContract(current.groupId, current.contractId)
    success('施工合同已绑定')
    await returnToSchedule()
  }
  catch (cause) {
    toastError('施工合同绑定失败', toErrorMessage(cause))
  }
}
</script>

<template>
  <div class="binding-screen flex min-w-0 flex-col gap-4">
    <section class="panel flex flex-wrap items-start gap-3 p-4">
      <button
        type="button"
        class="icon-btn mt-0.5 flex-none"
        aria-label="返回施工进度"
        @click="returnToSchedule"
      >
        <span class="i-lucide-arrow-left" />
      </button>
      <div class="min-w-52 flex-1">
        <div class="text-11px font-700 tracking-wide text-brand">
          施工进度 · 合同后补
        </div>
        <h1 class="mt-0.5 text-20px font-850 text-ink">
          绑定施工合同
        </h1>
        <p class="mt-1 text-12px text-ink-soft">
          暂估排程不重建；先核对楼栋、分项和数量差异，再切换范围依据。
        </p>
      </div>
      <div v-if="group" class="min-w-48 rounded-[var(--radius-btn)] bg-surface-2 px-3 py-2">
        <span class="block text-10px text-ink-faint">楼栋分组</span>
        <strong class="mt-0.5 block truncate text-12px text-ink">{{ group.name }}</strong>
        <span class="mt-1 inline-flex text-10px text-warn-ink">待绑定合同</span>
      </div>
    </section>

    <StatePanel
      v-if="initializing"
      kind="loading"
      title="正在读取合同绑定资料"
      compact
    />
    <StatePanel
      v-else-if="fatalError"
      kind="error"
      title="合同绑定资料读取失败"
      :description="fatalError"
      action-label="返回施工进度"
      @action="returnToSchedule"
    />
    <template v-else>
      <section class="panel p-4" aria-labelledby="contract-selector-title">
        <div class="contract-selector-grid grid grid-cols-[minmax(0,1fr)_minmax(16rem,30rem)] items-end gap-4">
          <div class="min-w-0">
            <h2 id="contract-selector-title" class="text-14px font-800 text-ink">
              选择同项目施工合同
            </h2>
            <p class="mt-1 text-11px text-ink-soft">
              支持按合同名称或编号搜索；选择后只读预览，不会直接写入。
            </p>
          </div>
          <div class="min-w-0">
            <label class="field-label block">施工合同</label>
            <LookupSelect
              v-model="selectedContractId"
              :fetch="fetchContracts"
              :disabled-reason="canChooseContract ? undefined : '当前分组不可绑定施工合同'"
              field="scheduleContractId"
              placeholder="搜索合同名称或编号"
            />
          </div>
        </div>
      </section>

      <StatePanel
        v-if="previewing"
        kind="loading"
        title="正在核对合同差异"
        compact
      />
      <StatePanel
        v-else-if="previewError"
        kind="error"
        title="合同差异复核失败"
        :description="`${previewError}。可重新选择其他施工合同。`"
        compact
      />
      <ScheduleContractBindingReview
        v-else-if="preview"
        :preview="preview"
        :busy="store.saving"
        @bind="bindContract"
      />
      <StatePanel
        v-else
        kind="empty"
        title="请选择一份施工合同"
        description="系统随后展示楼栋覆盖、分项映射与数量差异。"
        compact
      />
    </template>
  </div>
</template>

<style scoped>
.binding-screen {
  container-type: inline-size;
}

@container (max-width: 44rem) {
  .contract-selector-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
