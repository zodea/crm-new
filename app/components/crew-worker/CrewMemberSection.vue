<script setup lang="ts">
import type { CrewDetailReadDTO } from '~/lib/crew-worker/repository'
import type { CrewMembershipRecovery } from '~/stores/crew-worker-command'
import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, shallowRef, watch } from 'vue'
import { listCrewMembershipCandidates } from '~/lib/crew-worker/member-management'
import { crewWorkerProblemFromUnknown } from '~/lib/crew-worker/repository'
import { bindReadAuthority } from '~/lib/read-model/authority'
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
const membershipSession = commandStore.createMembershipSession()
let operationGeneration = 0
let viewActive = true
let recoveryGeneration = 0
const recoveryItems = shallowRef<CrewMembershipRecovery[]>([])
const recoveryChecking = shallowRef(true)
const recoveryProblem = shallowRef('')
const newIntentBlocked = computed(() => busy.value || recoveryChecking.value || !!recoveryProblem.value || !!recoveryItems.value.length)
function invalidateOperation() {
  operationGeneration++
  busy.value = false
  recoveryGeneration++
  recoveryItems.value = []
  recoveryChecking.value = false
  recoveryProblem.value = ''
}
async function inspectRecovery() {
  const generation = ++recoveryGeneration
  const crewId = props.detail.crew.id
  const current = () => viewActive && generation === recoveryGeneration && props.canManage && props.detail.crew.id === crewId
  recoveryItems.value = []
  recoveryProblem.value = ''
  if (!current()) {
    recoveryChecking.value = false
    return
  }
  recoveryChecking.value = true
  try {
    const items = await commandStore.inspectMembershipRecovery(membershipSession, crewId, current)
    if (current())
      recoveryItems.value = items
  }
  catch (cause) {
    if (current())
      recoveryProblem.value = crewWorkerProblemFromUnknown(cause).problem.message
  }
  finally {
    if (current())
      recoveryChecking.value = false
  }
}
watch(() => [props.detail.crew.id, props.canManage], () => {
  invalidateOperation()
  void inspectRecovery()
}, { flush: 'sync' })
bindReadAuthority(() => {
  invalidateOperation()
  recoveryProblem.value = '访问状态已变化，请按当前身份重新核对成员恢复定位。'
})
onMounted(() => {
  void inspectRecovery()
})
onActivated(() => {
  if (!viewActive) {
    viewActive = true
    void inspectRecovery()
  }
})
onDeactivated(() => {
  viewActive = false
  invalidateOperation()
})
onScopeDispose(() => {
  viewActive = false
  invalidateOperation()
})
function beginOperation(recovering = false) {
  if (!viewActive || busy.value || !props.canManage || (!recovering && newIntentBlocked.value))
    return null
  const generation = ++operationGeneration
  const crew = { id: props.detail.crew.id, name: props.detail.crew.name }
  const current = () => viewActive && operationGeneration === generation && props.canManage && props.detail.crew.id === crew.id
  busy.value = true
  return { crew, current }
}

async function recoverMember(item: CrewMembershipRecovery) {
  if (recoveryChecking.value)
    return
  const operation = beginOperation(true)
  if (!operation)
    return
  try {
    const result = await commandStore.recoverMembership(membershipSession, operation.crew.id, item.descriptor, operation.current)
    if (!operation.current())
      return
    if (result.outcome === 'applied')
      success('已核对原成员提交并重新读取工人档案')
    else
      warning('原成员提交没有应用，迟到请求已封存，可以重新选择')
    emit('changed')
  }
  catch (cause) {
    if (operation.current())
      error(crewWorkerProblemFromUnknown(cause).problem.message)
  }
  finally {
    if (operation.current()) {
      busy.value = false
      await inspectRecovery()
    }
  }
}

async function addMember() {
  const operation = beginOperation()
  if (!operation)
    return
  const { crew, current } = operation
  try {
    const candidates = await listCrewMembershipCandidates(
      repositories.crewWorkerRead,
      crew.id,
      props.detail.members.map(member => member.worker.id),
      current,
    )
    if (!current())
      return
    if (!candidates.length) {
      warning('没有可加入该班组的正式工人')
      return
    }
    const values = await formModal({
      title: `向「${crew.name}」添加成员`,
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
    if (!current() || !values)
      return
    const candidate = candidates.find(item => item.optionLabel === values.worker)
    if (!candidate)
      return
    if (candidate.currentCrewId) {
      const accepted = await confirm({
        title: '确认转组',
        message: `${candidate.name} 当前属于「${candidate.currentCrewLabel}」。确认转入「${crew.name}」？工资和历史记录不会删除。`,
        confirmLabel: '确认转组',
      })
      if (!current() || !accepted)
        return
    }
    await commandStore.setWorkerCrewMembership(membershipSession, {
      workerId: candidate.id,
      expectedCrewId: candidate.currentCrewId,
      crewId: crew.id,
    }, current)
    if (!current())
      return
    success(`已将${candidate.name}加入${crew.name}`)
    emit('changed')
  }
  catch (cause) {
    if (!current())
      return
    if (cause instanceof CrewWorkerMembershipConflictError) {
      warning(cause.message)
      emit('changed')
      return
    }
    error(crewWorkerProblemFromUnknown(cause).problem.message)
  }
  finally {
    if (current()) {
      busy.value = false
      await inspectRecovery()
    }
  }
}

async function removeMember(workerId: string, workerName: string) {
  const operation = beginOperation()
  if (!operation)
    return
  const { crew, current } = operation
  try {
    const accepted = await confirm({
      title: '移出班组',
      message: `确认将${workerName}移出「${crew.name}」？这只会解除班组归属，不会删除工人、工资或历史记录。`,
      confirmLabel: '移出班组',
    })
    if (!current() || !accepted)
      return
    await commandStore.setWorkerCrewMembership(membershipSession, { workerId, expectedCrewId: crew.id, crewId: null }, current)
    if (!current())
      return
    success(`已将${workerName}移出${crew.name}`)
    emit('changed')
  }
  catch (cause) {
    if (!current())
      return
    if (cause instanceof CrewWorkerMembershipConflictError) {
      warning(cause.message)
      emit('changed')
      return
    }
    error(crewWorkerProblemFromUnknown(cause).problem.message)
  }
  finally {
    if (current()) {
      busy.value = false
      await inspectRecovery()
    }
  }
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" data-ui="crew-member-section">
    <SectionHeader class="p-4 pb-2" title="成员" :subtitle="`${detail.members.length} 人，按稳定工人 ID 关联`">
      <template v-if="canManage" #extra>
        <KitButton type="button" variant="primary" class="px-2.5 py-1.5 text-11px" :loading="busy" :disabled="newIntentBlocked" @click="addMember">
          <span class="i-lucide-user-plus mr-1" aria-hidden="true" />添加成员
        </KitButton>
      </template>
    </SectionHeader>
    <div v-if="canManage && (recoveryChecking || recoveryProblem || recoveryItems.length)" role="status" aria-label="原成员提交恢复" class="m-4 mt-2 min-w-0 space-y-3 rounded border border-line bg-surface-2 p-3 text-12px">
      <p v-if="recoveryChecking">
        正在核对原成员恢复定位…
      </p>
      <template v-else-if="recoveryProblem">
        <p>{{ recoveryProblem }}</p>
        <KitButton type="button" variant="ghost" :disabled="busy" @click="inspectRecovery">
          重新核对成员恢复定位
        </KitButton>
      </template>
      <div v-for="item in recoveryItems" :key="item.key" class="min-w-0 space-y-2">
        <p>{{ item.resultKnown ? '成员已保存，等待重新读取' : '原成员提交结果待核对' }}。完成核对前请勿新增成员操作。</p>
        <p v-if="item.descriptor.scopeId === undefined">
          历史记录未保留班组上下文；这里只核对原工人提交，不将其归入当前班组。
        </p>
        <p class="break-all text-ink-soft">
          工人编号：{{ item.descriptor.targetId }} · 原提交编号：{{ item.descriptor.commandId }}
        </p>
        <KitButton type="button" variant="primary" :loading="busy" :disabled="busy || recoveryChecking" @click="recoverMember(item)">
          {{ item.resultKnown ? '重新读取已保存成员' : '核对原成员提交' }}
        </KitButton>
      </div>
    </div>
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
              <KitButton type="button" variant="ghost" class="px-2 py-1 text-11px text-danger" :loading="busy" :disabled="newIntentBlocked" @click="removeMember(row.worker.id, row.worker.label)">
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
