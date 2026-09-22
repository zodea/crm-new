<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useTargetCostDetail } from '~/composables/useTargetCostDetail'
import { useTargetCostFiles } from '~/composables/useTargetCostFiles'
import { presentTargetCostHistory } from '~/lib/target-cost/history-presentation'
import { TARGET_COST_LIST_PATH } from '~/lib/target-cost/navigation'
import { targetCostProjectTarget } from '~/lib/target-cost/project-navigation'
import { yuan } from '~/lib/util/money'

const route = useRoute()
const ui = useTargetCostDetail()
const { current, latest, itemDrafts, itemEditor, editing, loading, error, pending, busy, editable, returnTo, origin } = ui
const activeTab = shallowRef(route.query.tab === 'comparison' ? 'comparison' : 'items')
const view = computed(() => current.value?.view ?? null)
const header = computed(() => view.value?.header ?? null)
const history = computed(() => current.value?.history.map(presentTargetCostHistory) ?? [])
const readonlyPath = computed(() => `${TARGET_COST_LIST_PATH}/${encodeURIComponent(ui.id.value)}?${new URLSearchParams({ origin: origin.value ?? 'real', tab: activeTab.value, returnTo: returnTo.value })}`)
const editPath = computed(() => `${TARGET_COST_LIST_PATH}/form/${encodeURIComponent(ui.id.value)}?${new URLSearchParams({ origin: origin.value ?? 'real', returnTo: readonlyPath.value })}`)
const projectPath = computed(() => header.value && origin.value ? targetCostProjectTarget({ projectId: header.value.projectId, projectName: header.value.projectName, origin: origin.value, allowed: !!(latest.value?.context ?? current.value?.context)?.capabilities.includes('project:list:read'), returnTo: readonlyPath.value }) : null)
const amounts = [['contractRevenue', '合同收入'], ['plannedProfit', '计划利润'], ['signedContractSum', '已签合同额（录入值）'], ['taxExclusiveTotal', '无税合价'], ['taxAmount', '税额']] as const
const files = useTargetCostFiles({ current: () => current.value, active: () => ui.active.value && !!current.value, error: message => error.value = message })
useTabTitle(() => header.value?.name || '目标成本详情')
watch(activeTab, (tab) => {
  if (ui.active.value && current.value)
    void useRouter().replace({ path: route.path, query: { ...route.query, tab } })
})
</script>

<template>
  <EntityDetailShell :title="header?.name || '未填写版本名'" :subtitle="header ? `${header.projectName || '未关联项目'}${header.projectCode ? ` · ${header.projectCode}` : ''}` : ''" aside-label="目标成本版本信息" :state="view ? 'ready' : loading ? 'loading' : ui.readState.value" :state-title="ui.readState.value === 'not-found' ? '目标成本版本不存在或不可用' : '目标成本详情无法读取'" :state-description="error" state-action-label="重新加载" @state-action="ui.load()">
    <template v-if="!view" #back>
      <KitButton type="button" variant="secondary" @click="ui.navigate(returnTo)">
        返回目标成本列表
      </KitButton>
    </template>
    <template #status>
      <template v-if="header">
        <span class="chip" :class="header.status === 'submitted' ? 'chip-ok' : 'chip-warn'">{{ header.status === 'submitted' ? '已提交' : '草稿' }}</span>
        <span v-if="current?.deletedAt" class="chip bg-danger-soft text-danger">已删除</span>
        <span v-if="header.isBaseline" class="chip-brand">{{ current?.deletedAt ? '已删除基线 · 不参与正式控制' : header.status === 'submitted' ? '当前正式基线' : '草稿基线 · 不参与正式控制' }}</span>
        <span v-else class="chip bg-surface-3 text-ink-faint">历史/非基线</span>
        <span v-if="origin === 'demo'" class="chip bg-warn-soft text-warn-ink">演示 · 只读</span>
      </template>
    </template>
    <template #actions>
      <KitButton type="button" variant="secondary" @click="ui.navigate(returnTo)">
        返回目标成本列表
      </KitButton>
      <KitButton v-if="projectPath" type="button" variant="secondary" @click="ui.navigate(projectPath)">
        查看项目
      </KitButton>
      <KitButton v-if="header && editable" type="button" variant="primary" @click="ui.navigate(editPath)">
        编辑版本
      </KitButton>
    </template>
    <template #summary>
      <CentralTargetCostSummary v-if="view" :view="view" />
    </template>
    <TargetCostCommandState :error="error" :pending="!!pending" :busy="busy" @recover="ui.recover" @recheck="ui.load(true)" />
    <section v-if="latest" class="panel my-3 grid gap-2 p-3 text-12px" aria-label="科目最新资料核对">
      <p>已读取最新版本；科目草稿与原保存依据保持不变。{{ latest.context.sourceVersion !== current?.context.sourceVersion ? '预算版本已变化。' : '预算来源版本未变化。' }}</p>
      <KitButton type="button" class="justify-self-start" variant="secondary" :disabled="busy || !!pending" @click="ui.replaceWithLatest">
        放弃修改并载入最新
      </KitButton>
    </section>
    <template v-if="view">
      <nav class="my-4" aria-label="目标成本详情分类">
        <SegTab v-model="activeTab" :tabs="[{ key: 'items', label: `科目明细 (${view.items.length})` }, { key: 'comparison', label: `成本对比 (${view.categories.length})` }]" />
      </nav>
      <TargetCostItemEditor v-if="activeTab === 'items' && editing" ref="itemEditor" v-model="itemDrafts" :saving="busy || !!pending || !editable" @save="ui.saveItems" @cancel="ui.cancelEdit" />
      <TargetCostItemTable v-else-if="activeTab === 'items'" :items="view.items" :editable="editable" @edit="ui.beginEdit" />
      <CentralTargetCostComparison v-else :categories="view.categories" :return-to="readonlyPath" />
      <TargetCostAttachments v-if="current" class="mt-4" :files="current.files" :pending="[]" :remove-ids="[]" :restore-ids="[]" readonly :busy="busy" @open="files.download" />
      <details v-if="current" class="panel mt-4 min-w-0 p-4 text-12px" aria-label="预算版本历史">
        <summary class="cursor-pointer font-700">
          查看版本来源与操作历史（{{ current.history.length }}）
        </summary>
        <p v-if="!history.length" class="mt-2 text-ink-faint">
          当前版本没有可读取的操作记录。
        </p>
        <ol class="mt-3 grid gap-3">
          <li v-for="entry in history" :key="entry.id" class="border-t border-line pt-3">
            <p class="font-700">
              {{ entry.subject }} · {{ entry.action }}
            </p>
            <p class="mt-1 break-words text-ink-faint">
              {{ entry.time }} · {{ entry.operator }}
            </p>
            <dl class="mt-2 grid gap-2">
              <div v-for="change in entry.changes" :key="change.label" class="grid gap-1 sm:grid-cols-[10rem_1fr]">
                <dt class="text-ink-faint">
                  {{ change.label }}
                </dt><dd class="min-w-0 break-words">
                  {{ change.before }} → {{ change.after }}
                </dd>
              </div>
            </dl>
            <p v-if="entry.missingDetail" class="mt-2 text-ink-faint">
              {{ entry.missingDetail }}
            </p>
          </li>
        </ol>
      </details>
    </template>
    <template #aside>
      <section v-if="header" class="panel min-w-0 p-4">
        <h3 class="mb-3 text-13px font-800">
          版本信息
        </h3>
        <dl class="grid gap-3 text-12px">
          <div v-for="[key, label] in amounts" :key="key">
            <dt class="text-ink-faint">
              {{ label }}
            </dt><dd class="mt-1 font-mono">
              {{ yuan(header[key]) }}
            </dd>
          </div>
        </dl>
        <h3 class="mb-2 mt-4 text-13px font-800">
          备注
        </h3><p class="break-words text-12px leading-6 text-ink-soft">
          {{ header.note || '暂无备注' }}
        </p>
      </section>
    </template>
  </EntityDetailShell>
</template>
