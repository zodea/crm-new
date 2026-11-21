<script setup lang="ts">
import { useWorkerRosterArchive } from '~/composables/useWorkerRosterArchive'
import WorkerRosterMemberTable from '~/pages/subcontract/payroll/_components/WorkerRosterMemberTable.vue'

const ui = useWorkerRosterArchive()
const { projectId, list, rows, selectedIds, registeredOn, preview, opened, versions, busy, error, writable, pending } = ui
useTabTitle('工资实名名册归档')
</script>

<template>
  <EntityFormShell title="工资实名名册归档" subtitle="按已发工资的原成员建立独立日期的名册。后来补充的资料形成新版本，原工资和旧名册保持不变。" :sections="[{ key: 'scope', label: '工资范围' }, { key: 'roster', label: '实名名册' }, { key: 'versions', label: '归档版本' }]" :state="list ? 'ready' : busy ? 'loading' : 'error'" state-title="名册权限或资料未能读取" :state-description="error" state-action-label="重新读取" @state-action="ui.load" @back="ui.leave">
    <p v-if="error && list" role="alert" class="panel mb-4 p-4 text-warn">
      {{ error }}
    </p>
    <section v-if="pending" role="status" class="panel mb-4 flex flex-wrap items-center gap-3 p-4">
      <span>上次提交结果待核对。</span><KitButton :disabled="busy || !list" @click="ui.recover">
        核对原提交
      </KitButton>
    </section>
    <section id="section-scope" class="panel mb-4 p-4">
      <SectionHeader title="选择工资与资料登记日期" subtitle="仅能选同项目的已发 A/C1/C2 工资；负责人和零分配人员均来自原冻结成员。" />
      <div class="my-4 grid gap-4 sm:grid-cols-2">
        <label class="grid min-w-0 gap-1 text-12px">项目<select aria-label="项目" :value="projectId" class="field-input min-w-0" :disabled="busy || !!pending" @change="ui.changeProject(($event.target as HTMLSelectElement).value)"><option value="">请选择项目</option><option v-for="project in list?.projects || []" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
        <label class="grid gap-1 text-12px">资料登记日期<input v-model="registeredOn" aria-label="资料登记日期" type="date" class="field-input min-w-0" :disabled="busy || !!pending"></label>
      </div>
      <div v-if="projectId" class="grid max-h-80 gap-2 overflow-y-auto">
        <label v-for="row in rows" :key="row.id" class="flex min-w-0 items-start gap-3 rounded-lg border border-line p-3 text-12px"><input type="checkbox" class="mt-1" :checked="selectedIds.includes(row.id)" :disabled="busy || !!pending || row.snapshot.state !== 'complete'" :aria-label="`选择工资 ${row.id}`" @change="ui.toggle(row.id, ($event.target as HTMLInputElement).checked)"><span class="min-w-0 break-words"><strong>{{ row.month }} · {{ row.formatFamily }} · {{ row.leaderName || '负责人姓名未记录' }}</strong><span class="ml-2">{{ row.crewName || '班组未记录' }}</span><span class="mt-1 block break-all text-ink-soft">{{ row.id }}</span><span v-if="row.snapshot.state !== 'complete'" class="mt-1 block text-warn">冻结资料不完整，不能建立名册</span></span></label>
        <p v-if="!rows.length" class="text-13px text-ink-soft">
          此项目尚无可选的已发工资。
        </p>
      </div>
      <KitButton class="mt-4" :disabled="busy || !!pending || !projectId || !selectedIds.length || !registeredOn" @click="ui.buildPreview">
        {{ busy ? '正在核对…' : `核对所选 ${selectedIds.length} 份工资的名册` }}
      </KitButton>
    </section>
    <section id="section-roster" class="mb-4 min-w-0">
      <p v-if="preview || opened" class="mb-3 text-13px text-ink-soft">
        本名册为独立日期的资料补充，不证明原工资发放时已保存这些资料。资料缺口随该版本保留。
      </p>
      <div v-if="opened" class="panel mb-3 flex flex-wrap items-center justify-between gap-3 p-4">
        <div class="min-w-0">
          <strong>已归档版本 {{ opened.version }}</strong><p class="mt-1 break-all text-12px text-ink-soft">
            实际归档 {{ opened.createdAt }} · {{ opened.id }}
          </p>
        </div><KitButton :disabled="busy || !!pending" @click="ui.download">
          下载名册与照片 ZIP
        </KitButton>
      </div>
      <WorkerRosterMemberTable v-if="opened || preview" :document="(opened || preview)!" />
      <p v-else class="panel p-4 text-13px text-ink-soft">
        先核对工资成员，或打开下方已归档版本。
      </p>
    </section>
    <section id="section-versions" class="panel p-4">
      <SectionHeader title="已有归档版本" subtitle="相同工资范围按版本递增；登记日期和实际归档时间分别保留。" />
      <ul v-if="versions.length" class="mt-3 grid gap-2">
        <li v-for="version in versions" :key="version.id" class="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 text-12px">
          <div class="min-w-0">
            <strong>{{ version.registeredOn }} · 版本 {{ version.version }}</strong><p class="mt-1">
              {{ version.memberCount }} 人 · {{ version.statementIds.length }} 份工资 · {{ version.gapCount }} 项资料缺口
            </p><p class="mt-1 break-all text-ink-soft">
              {{ version.id }}
            </p>
          </div><KitButton :disabled="busy || !!pending" @click="ui.open(version.id)">
            打开此版本
          </KitButton>
        </li>
      </ul>
      <p v-else class="mt-3 text-13px text-ink-soft">
        当前项目还没有名册归档。
      </p>
    </section>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending" @click="ui.leave">
          返回工资
        </KitButton><KitButton variant="primary" :disabled="!writable" @click="ui.save">
          {{ busy ? '正在处理…' : '按当前预览归档新版本' }}
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
