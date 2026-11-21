<script setup lang="ts">
import { usePayrollWorkbook } from '~/composables/usePayrollWorkbook'
import PayrollWorkbookHistory from '~/pages/subcontract/payroll/_components/PayrollWorkbookHistory.vue'
import PayrollWorkbookPreview from '~/pages/subcontract/payroll/_components/PayrollWorkbookPreview.vue'
import PayrollWorkbookSelection from '~/pages/subcontract/payroll/_components/PayrollWorkbookSelection.vue'

const ui = usePayrollWorkbook()
const { projectId, mode, subjectKey, rosterArchiveId, list, subjects, selected, matchingRosters, current, opened, versions, busy, error, canSave, privateReadable, returnTo, rosterTo, pending } = ui
useTabTitle('完整工资工作簿')
</script>

<template>
  <EntityFormShell title="完整工资工作簿" subtitle="固定原工资、正式编号和独立名册版本，再下载可复核的工资文件。" :sections="[{ key: 'scope', label: '工资范围' }, { key: 'preview', label: '固定目录' }, { key: 'history', label: '已存版本' }]" :state="list ? 'ready' : busy ? 'loading' : 'error'" state-title="工资目录未能读取" :state-description="error" state-action-label="重新读取" @state-action="ui.load" @back="ui.leave">
    <p v-if="error && list" role="alert" class="panel mb-4 p-4 text-warn">
      {{ error }}
    </p>
    <section v-if="pending" role="status" class="panel mb-4 flex flex-wrap items-center gap-3 p-4">
      <span>上次目录保存结果待核对；请勿重复保存。</span><KitButton :disabled="busy || !list" @click="ui.recover">
        核对原保存结果
      </KitButton>
    </section>
    <div class="grid min-w-0 grid-cols-1 gap-4">
      <PayrollWorkbookSelection :project-id="projectId" :projects="list?.projects || []" :mode="mode" :subject-key="subjectKey" :subjects="subjects" :selected="selected" :roster-archive-id="rosterArchiveId" :rosters="matchingRosters" :disabled="busy || !!pending" :private-readable="privateReadable" @project="ui.changeProject" @change="ui.change" @preview="ui.buildPreview">
        <template #roster-link>
          <NuxtLink v-if="privateReadable && selected.length && !busy && !pending" :to="rosterTo" class="text-12px text-brand underline">
            为当前工资范围准备实名名册版本
          </NuxtLink>
        </template>
      </PayrollWorkbookSelection>
      <PayrollWorkbookPreview v-if="current" :document="current" :return-to="returnTo" :disabled="busy || !!pending" />
      <section v-if="opened" class="panel flex flex-wrap items-center gap-3 p-4" aria-label="已保存目录下载">
        <KitButton v-if="opened.input.mode === 'leader-cycle'" :disabled="busy || !!pending" @click="ui.download('xlsx')">
          下载工资 XLSX
        </KitButton><KitButton variant="secondary" :disabled="busy || !!pending" @click="ui.download('public-zip')">
          下载工资 ZIP（不含实名附件）
        </KitButton><KitButton v-if="privateReadable && opened.rosterRef" :disabled="busy || !!pending" @click="ui.download('private-zip')">
          下载工资、名册与照片 ZIP
        </KitButton><p class="w-full text-12px text-ink-soft">
          XLSX 和工资 ZIP 不含私密附件。完整包每次下载重新核对名册权限与原件摘要；保存目录不会自动发放、占号或另建名册。
        </p>
      </section>
      <PayrollWorkbookHistory :versions="versions" :disabled="busy || !!pending" @open="ui.open" />
    </div>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending" @click="ui.leave">
          返回工资
        </KitButton><KitButton variant="secondary" :disabled="busy || !!pending" @click="ui.load">
          重新读取
        </KitButton><KitButton :disabled="!canSave" @click="ui.save">
          {{ busy ? '正在核对…' : '保存当前目录版本' }}
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
