<script setup lang="ts">
import { computed } from 'vue'
import { useTargetCostForm } from '~/composables/useTargetCostForm'

const ui = useTargetCostForm()
const { read, matchingRead, latest, draft, pendingFiles, removeIds, restoreIds, error, fieldErrors, loading, loadingAction, pending, busy, editable, dirty, projectLabel, sessionKey, formElement, id } = ui
const title = computed(() => `${id.value ? '编辑' : '新建'} · 目标成本`)
useTabTitle(title)
function footer(action: 'cancel' | 'draft' | 'save' | 'saveNew' | 'saveSubmit') {
  if (action === 'cancel')
    void ui.leave()
  else
    void ui.save(action)
}
</script>

<template>
  <EntityFormShell :title="title" subtitle="草稿可保留缺项目与空金额；版本头和科目明细分别保存。" back-label="返回目标成本" :sections="[{ key: 'basic', label: '基本信息' }, { key: 'amount', label: '金额基准' }, { key: 'attachments', label: '预算附件' }, { key: 'note', label: '备注' }]" :state="!matchingRead ? loading ? 'loading' : 'error' : 'ready'" state-title="预算版本载入失败" :state-description="error" state-action-label="重新加载" @back="ui.leave" @state-action="ui.load()">
    <TargetCostCommandState :error="error" :pending="!!pending" :busy="busy" @recover="ui.recover" @recheck="ui.load(true)" />
    <section v-if="latest" class="panel my-3 grid gap-2 p-3 text-12px" aria-label="预算最新资料核对">
      <p>已读取最新资料，当前草稿仍按原保存依据保留。{{ latest.context.sourceVersion !== read?.context.sourceVersion ? '资料版本已发生变化。' : '当前来源版本没有变化。' }}</p>
      <KitButton type="button" variant="secondary" class="justify-self-start" :disabled="busy || !!pending" @click="ui.replaceWithLatest">
        放弃修改并载入最新
      </KitButton>
    </section>
    <p v-if="matchingRead?.deletedAt" class="panel my-3 p-3 text-12px text-warn-ink">
      此版本已删除，仅可核对；请从已删除版本列表执行恢复。
    </p>
    <p v-else-if="matchingRead && !matchingRead.context.capabilities.includes('target-cost:write')" class="panel my-3 p-3 text-12px text-warn-ink">
      当前身份仅可查看预算。
    </p>
    <p v-if="matchingRead?.context.origin === 'demo'" class="panel my-3 p-3 text-12px text-warn-ink">
      演示预算只读，正式预算请从正式来源新建。
    </p>
    <form v-if="matchingRead" ref="formElement" class="grid min-w-0 gap-4" @submit.prevent="ui.save('save')">
      <TargetCostFormFields v-model="draft" :field-errors="fieldErrors" :fetch-projects="ui.fetchProjects" :disabled="!editable" :project-label="projectLabel" :lookup-key="`target-cost-projects:${sessionKey}`" @clear-error="field => { const next = { ...fieldErrors }; delete next[field]; fieldErrors = next }" />
      <p v-if="matchingRead.projectOptionsStatus !== 'available'" class="panel p-3 text-12px text-warn-ink">
        当前项目候选{{ matchingRead.projectOptionsStatus === 'forbidden' ? '无权读取' : '暂时不可用' }}；不会用同名项目代替原关系。
      </p>
      <p v-if="draft.isBaseline && draft.status !== 'submitted'" class="panel p-3 text-12px text-warn-ink">
        草稿基线不参与正式成本控制；提交后按当前项目的唯一基线规则核对。
      </p>
      <TargetCostAttachments :files="matchingRead.files" :pending="pendingFiles" :remove-ids="removeIds" :restore-ids="restoreIds" :readonly="!editable && !busy && !pending" :busy="busy || !!pending" @files="ui.addFiles" @open="ui.downloadFile" @toggle="ui.toggleFile" @remove-pending="localId => { if (editable) pendingFiles = pendingFiles.filter(file => file.localId !== localId) }" @category="(localId, category) => { if (editable) pendingFiles = pendingFiles.map(file => file.localId === localId ? { ...file, category } : file) }" />
      <section id="section-note" class="panel scroll-mt-4 p-4">
        <SectionHeader title="备注" />
        <textarea v-model="draft.note" class="field-input mt-3 w-full" rows="4" aria-label="预算备注" :disabled="!editable" />
        <p class="mt-2 text-11px text-ink-faint">
          科目明细在当前版本详情维护；保存版本头不会提交未保存的明细。
        </p>
      </section>
    </form>
    <template #footer>
      <FormFooter v-if="matchingRead && !pending" class="mt-4" :actions="editable || busy ? ['cancel', 'draft', 'saveNew', 'saveSubmit', 'save'] : ['cancel']" :dirty="dirty" :loading-action="loadingAction" @action="footer" />
    </template>
  </EntityFormShell>
</template>
