<script setup lang="ts">
import type { CrewDetailReadDTO } from '~/lib/crew-worker/repository'
import { shallowRef } from 'vue'
import { listCrewMembershipCandidates } from '~/lib/crew-worker/member-management'
import { crewWorkerProblemFromUnknown } from '~/lib/crew-worker/repository'
import { CrewWorkerMembershipConflictError, useCrewWorkerCommandStore } from '~/stores/crew-worker-command'

const props = defineProps<{
  detail: Pick<CrewDetailReadDTO, 'crew' | 'members'>
  canManage: boolean
  returnTo?: string
}>()
const emit = defineEmits<{ changed: [] }>()
const busy = shallowRef(false)
const { confirm, error, formModal, success, warning } = useKitUI()
const repositories = useNuxtApp().$repositories
const commandStore = useCrewWorkerCommandStore()

async function addMember() {
  if (busy.value)
    return
  busy.value = true
  try {
    const candidates = await listCrewMembershipCandidates(
      repositories.crewWorkerRead,
      props.detail.crew.id,
      props.detail.members.map(member => member.worker.id),
    )
    if (!candidates.length) {
      warning('没有可加入该班组的正式工人')
      return
    }
    const values = await formModal({
      title: `向「${props.detail.crew.name}」添加成员`,
      subtitle: '选择现有正式工人；如已有班组，将明确确认转组。',
      saveText: '加入班组',
      fields: [{
        key: 'worker',
        label: '工人',
        type: 'select',
        options: candidates.map(candidate => candidate.optionLabel),
        value: '',
        required: true,
      }],
    })
    if (!values)
      return
    const candidate = candidates.find(item => item.optionLabel === values.worker)
    if (!candidate)
      return
    if (candidate.currentCrewId) {
      const accepted = await confirm({
        title: '确认转组',
        message: `${candidate.name} 当前属于「${candidate.currentCrewLabel}」。确认转入「${props.detail.crew.name}」？工资和历史记录不会删除。`,
        confirmLabel: '确认转组',
      })
      if (!accepted)
        return
    }
    await commandStore.setWorkerCrewMembership({
      workerId: candidate.id,
      expectedCrewId: candidate.currentCrewId,
      crewId: props.detail.crew.id,
    })
    success(`已将${candidate.name}加入${props.detail.crew.name}`)
    emit('changed')
  }
  catch (cause) {
    if (cause instanceof CrewWorkerMembershipConflictError) {
      warning(cause.message)
      emit('changed')
      return
    }
    error(crewWorkerProblemFromUnknown(cause).problem.message)
  }
  finally {
    busy.value = false
  }
}

async function removeMember(workerId: string, workerName: string) {
  if (busy.value)
    return
  const accepted = await confirm({
    title: '移出班组',
    message: `确认将${workerName}移出「${props.detail.crew.name}」？这只会解除班组归属，不会删除工人、工资或历史记录。`,
    confirmLabel: '移出班组',
  })
  if (!accepted)
    return
  busy.value = true
  try {
    await commandStore.setWorkerCrewMembership({ workerId, expectedCrewId: props.detail.crew.id, crewId: null })
    success(`已将${workerName}移出${props.detail.crew.name}`)
    emit('changed')
  }
  catch (cause) {
    if (cause instanceof CrewWorkerMembershipConflictError) {
      warning(cause.message)
      emit('changed')
      return
    }
    error(crewWorkerProblemFromUnknown(cause).problem.message)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" data-ui="crew-member-section">
    <SectionHeader class="p-4 pb-2" title="成员" :subtitle="`${detail.members.length} 人，按稳定工人 ID 关联`">
      <template v-if="canManage" #extra>
        <KitButton type="button" variant="primary" class="px-2.5 py-1.5 text-11px" :loading="busy" @click="addMember">
          <span class="i-lucide-user-plus mr-1" aria-hidden="true" />添加成员
        </KitButton>
      </template>
    </SectionHeader>
    <div class="max-w-full overflow-x-auto" tabindex="0" aria-label="班组成员表，可横向滚动查看全部列">
      <table class="w-full min-w-860px text-left text-12px">
        <thead class="bg-surface-2 text-ink-soft">
          <tr>
            <th class="p-3">
              工人
            </th>
            <th class="p-3">
              工种
            </th>
            <th class="p-3">
              联系电话
            </th>
            <th class="p-3">
              当前项目
            </th>
            <th class="p-3">
              项目状态
            </th>
            <th class="p-3">
              日工资
            </th>
            <th v-if="canManage" class="p-3 text-right">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in detail.members" :key="row.worker.id" class="border-t border-line">
            <td class="p-3">
              <EntityLink :id="row.worker.id" type="worker" :label="row.worker.label" :intent="row.navigation" :return-to="returnTo" />
            </td>
            <td class="p-3">
              {{ row.trade || '—' }}
            </td>
            <td class="p-3">
              {{ row.phone || '—' }}
            </td>
            <td class="p-3">
              <EntityLink :id="row.currentProject.state === 'resolved' ? row.currentProject.id : null" type="project" :label="row.currentProject.state === 'resolved' ? row.currentProject.label : null" :intent="row.currentProjectNavigation" :return-to="returnTo" />
            </td>
            <td class="p-3">
              {{ row.projectStatus || '—' }}
            </td>
            <td class="p-3">
              {{ row.dailyWage == null ? '历史未记录' : `¥${row.dailyWage}` }}
            </td>
            <td v-if="canManage" class="p-3 text-right">
              <KitButton type="button" variant="ghost" class="px-2 py-1 text-11px text-danger" :loading="busy" @click="removeMember(row.worker.id, row.worker.label)">
                移出班组
              </KitButton>
            </td>
          </tr>
          <tr v-if="!detail.members.length">
            <td :colspan="canManage ? 7 : 6" class="p-6 text-center text-ink-faint">
              暂无成员关系
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
