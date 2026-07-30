<script setup lang="ts">
import type { TargetCostItemDraft } from '~/lib/target-cost/items'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { yuan } from '~/lib/util/money'

type DetailTab = 'items' | 'comparison'

const route = useRoute()
const store = useTargetCostDetailStore()
const { current, loadedId, loading, error, savingItems } = storeToRefs(store)
const { confirm, success, warning, error: notifyError } = useKitUI()

const targetCostId = computed(() => String(route.params.id ?? ''))
const activeTab = shallowRef<DetailTab>('items')
const editingItems = shallowRef(false)
const itemDrafts = shallowRef<TargetCostItemDraft[]>([])
const itemEditor = useTemplateRef<{
  validate: () => Promise<{ row: number, key: string }[]>
}>('itemEditor')
const detail = computed(() =>
  current.value?.header.id === targetCostId.value ? current.value : null,
)
const header = computed(() => detail.value?.header ?? null)
const tabs = computed(() => [
  { key: 'items' as const, label: `科目明细 (${detail.value?.items.length ?? 0})` },
  { key: 'comparison' as const, label: `成本对比 (${detail.value?.categories.length ?? 0})` },
])
const shellState = computed(() => {
  if (detail.value)
    return 'ready'
  if (loading.value || loadedId.value !== targetCostId.value)
    return 'loading'
  if (error.value)
    return 'error'
  return 'not-found'
})
const statusLabel = computed(() =>
  header.value?.status === 'submitted' ? '已提交' : '草稿',
)
const statusClass = computed(() =>
  header.value?.status === 'submitted' ? 'chip-ok' : 'chip-warn',
)
const itemDraftsDirty = computed(() =>
  editingItems.value
  && JSON.stringify(itemDrafts.value) !== JSON.stringify(detail.value?.items ?? []),
)

useTabTitle(() => header.value?.name)

function displayDate(value: string): string {
  return value ? value.slice(0, 10) : '—'
}

async function load() {
  if (!targetCostId.value)
    return
  await store.load(targetCostId.value)
}

function beginItemEdit() {
  if (!detail.value)
    return
  itemDrafts.value = detail.value.items.map(item => ({ ...item }))
  editingItems.value = true
}

function discardItemDrafts() {
  editingItems.value = false
  itemDrafts.value = []
}

async function confirmDiscard(message: string): Promise<boolean> {
  if (!itemDraftsDirty.value)
    return true
  return confirm({
    variant: 'simple',
    title: '放弃科目修改',
    message,
    confirmLabel: '放弃修改',
  })
}

async function cancelItemEdit() {
  if (!await confirmDiscard('当前科目明细还有未保存内容，确认放弃？'))
    return
  discardItemDrafts()
}

async function saveItems() {
  if (!targetCostId.value)
    return
  const errors = await itemEditor.value?.validate() ?? []
  if (errors.length) {
    warning(`还有 ${errors.length} 处科目明细需要修正`)
    return
  }
  try {
    await store.saveItems(targetCostId.value, itemDrafts.value)
    discardItemDrafts()
    success('科目明细已保存')
  }
  catch (cause) {
    await itemEditor.value?.validate()
    notifyError(`科目明细保存失败：${cause instanceof Error ? cause.message : '未知错误'}`)
  }
}

async function guardUnsavedRouteChange() {
  const accepted = await confirmDiscard('当前科目明细还有未保存内容，离开后修改将丢失，确认放弃并离开？')
  if (accepted)
    discardItemDrafts()
  return accepted
}

onBeforeRouteLeave(guardUnsavedRouteChange)
onBeforeRouteUpdate(guardUnsavedRouteChange)

useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (!itemDraftsDirty.value)
    return
  event.preventDefault()
  event.returnValue = ''
})

watch(targetCostId, () => void load(), { immediate: true })
watch(targetCostId, () => {
  editingItems.value = false
  itemDrafts.value = []
})
</script>

<template>
  <EntityDetailShell
    :title="header?.name ?? '目标成本详情'"
    :subtitle="header ? `${header.projectName || '未关联项目'}${header.projectCode ? ` · ${header.projectCode}` : ''}` : ''"
    back-to="/project/target-cost"
    back-label="返回目标成本列表"
    aside-label="目标成本版本信息"
    :state="shellState"
    :state-title="shellState === 'not-found' ? '目标成本版本不存在或已删除' : '目标成本详情加载失败'"
    :state-description="shellState === 'error' ? error : ''"
    :state-action-label="shellState === 'error' ? '重新加载' : ''"
    @state-action="load"
  >
    <template #mark>
      <div class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-brand">
        <span class="i-lucide-target h-5 w-5" aria-hidden="true" />
      </div>
    </template>

    <template #status>
      <template v-if="header">
        <span class="chip" :class="statusClass">{{ statusLabel }}</span>
        <span v-if="header.isBaseline" class="chip-brand">当前对比基线</span>
        <span v-else class="chip bg-surface-3 text-ink-faint">历史/非基线</span>
      </template>
    </template>

    <template #actions>
      <template v-if="header">
        <KitButton
          v-if="header.projectId"
          type="button"
          variant="secondary"
          @click="navigateTo(`/project/${header.projectId}`)"
        >
          <span class="i-lucide-building-2 mr-1" aria-hidden="true" />
          查看项目
        </KitButton>
        <KitButton
          type="button"
          variant="primary"
          @click="navigateTo(`/project/target-cost/form/${header.id}`)"
        >
          <span class="i-lucide-square-pen mr-1" aria-hidden="true" />
          编辑版本
        </KitButton>
      </template>
    </template>

    <template #summary>
      <TargetCostDetailSummary
        v-if="detail"
        :header="detail.header"
        :summary="detail.summary"
      />
    </template>

    <template v-if="detail">
      <nav class="mb-4 min-w-0" aria-label="目标成本详情分类">
        <SegTab v-model="activeTab" :tabs="tabs" />
      </nav>

      <TargetCostItemEditor
        v-if="activeTab === 'items' && editingItems"
        ref="itemEditor"
        v-model="itemDrafts"
        :saving="savingItems"
        @save="saveItems"
        @cancel="cancelItemEdit"
      />
      <TargetCostItemTable
        v-else-if="activeTab === 'items'"
        :items="detail.items"
        @edit="beginItemEdit"
      />
      <TargetCostComparisonTable
        v-else
        :categories="detail.categories"
      />
    </template>

    <template #aside>
      <div v-if="header" class="flex min-w-0 flex-col gap-4">
        <section class="panel p-4" aria-labelledby="target-version-info-title">
          <h3 id="target-version-info-title" class="mb-3 text-13px font-800 text-ink">
            版本信息
          </h3>
          <dl class="grid gap-3 text-11px">
            <div>
              <dt class="text-ink-faint">
                合同收入
              </dt>
              <dd class="mt-0.5 font-mono font-700 tabular-nums text-ink">
                {{ yuan(header.contractRevenue) }}
              </dd>
            </div>
            <div>
              <dt class="text-ink-faint">
                计划利润
              </dt>
              <dd class="mt-0.5 font-mono font-700 tabular-nums text-ink">
                {{ yuan(header.plannedProfit) }}
              </dd>
            </div>
            <div>
              <dt class="text-ink-faint">
                已签合同额（录入值）
              </dt>
              <dd class="mt-0.5 font-mono font-700 tabular-nums text-ink">
                {{ yuan(header.signedContractSum) }}
              </dd>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <dt class="text-ink-faint">
                  无税合价
                </dt>
                <dd class="mt-0.5 font-mono tabular-nums text-ink">
                  {{ yuan(header.taxExclusiveTotal) }}
                </dd>
              </div>
              <div>
                <dt class="text-ink-faint">
                  税额
                </dt>
                <dd class="mt-0.5 font-mono tabular-nums text-ink">
                  {{ yuan(header.taxAmount) }}
                </dd>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <dt class="text-ink-faint">
                  创建日期
                </dt>
                <dd class="mt-0.5 text-ink">
                  {{ displayDate(header.createdAt) }}
                </dd>
              </div>
              <div>
                <dt class="text-ink-faint">
                  更新日期
                </dt>
                <dd class="mt-0.5 text-ink">
                  {{ displayDate(header.updatedAt) }}
                </dd>
              </div>
            </div>
          </dl>
        </section>

        <section class="panel p-4" aria-labelledby="target-version-note-title">
          <h3 id="target-version-note-title" class="mb-2 text-13px font-800 text-ink">
            备注
          </h3>
          <p class="break-words text-11px leading-5 text-ink-soft">
            {{ header.note || '暂无备注' }}
          </p>
        </section>
      </div>
    </template>
  </EntityDetailShell>
</template>
