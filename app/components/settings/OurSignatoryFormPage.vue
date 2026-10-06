<script setup lang="ts">
import type { FormFooterAction } from '~/lib/master-data/page'
import type { OurSignatoryDraft, OurSignatoryHistory } from '~/lib/our-signatory/contract'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { createFormCommandActions } from '~/lib/forms/command-session'
import { OurSignatoryRepositoryProblem } from '~/lib/our-signatory/contract'
import { createOurSignatoryRepository } from '~/lib/our-signatory/http-repository'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { bindReadAuthority } from '~/lib/read-model/authority'

const route = useRoute()
const router = useRouter()
const kit = useKitUI()
const repository = createOurSignatoryRepository((url, options) => $fetch<unknown>(url, { ...options, retry: 0 }))
const latestConflict = shallowRef<Awaited<ReturnType<typeof repository.loadForm>> | null>(null)
const actions = createFormCommandActions({
  repository: () => repository,
  capability: 'our-signatory:write' as const,
  problemFromUnknown: cause => cause instanceof OurSignatoryRepositoryProblem ? cause : new OurSignatoryRepositoryProblem({ code: 'unavailable', message: cause instanceof Error ? cause.message : '资料暂不可用', retryable: true, fieldErrors: {}, traceId: null }),
  conflict: (latest) => {
    latestConflict.value = latest
    return new Error('主体资料已更新，请核对最新版本；当前输入仍保留。')
  },
})
const session = actions.createSession()
const defaults = (): OurSignatoryDraft => ({ name: '', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '', status: 'active' })
const draft = ref<OurSignatoryDraft & {
  id?: string
}>(defaults())
const baseline = ref(JSON.stringify(draft.value))
const history = shallowRef<OurSignatoryHistory[]>([])
const dirty = computed(() => JSON.stringify(draft.value) !== baseline.value)
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : null)
const title = computed(() => `${id.value ? '编辑' : '新增'} · 我方签约主体`)
const loading = ref(false)
const error = ref('')
const closeAfter = ref(true)
const loadingAction = ref<FormFooterAction | null>(null)
let generation = 0
let active = true
let submittedInput: string | null = null
function invalidate(message: string) {
  generation++
  actions.invalidate(session)
  history.value = []
  latestConflict.value = null
  loading.value = false
  loadingAction.value = null
  error.value = message
}
bindReadAuthority(problem => invalidate(problem.message))
async function initialize(retain = false) {
  const current = ++generation
  if (!retain)
    submittedInput = null
  loading.value = true
  error.value = ''
  try {
    if (isDesktopRuntime())
      throw new Error('此独立桌面路径尚未接入一致主体目录，请使用已开放的中央入口。')
    const data = retain ? await actions.revalidate(session) : await actions.hydrate(session, id.value)
    if (current !== generation || !active)
      return
    history.value = data.form?.history ?? []
    if (!retain) {
      draft.value = data.form?.draft ?? defaults()
      baseline.value = JSON.stringify(draft.value)
    }
  }
  catch (cause) {
    if (current === generation && active)
      error.value = cause instanceof Error ? cause.message : '读取失败'
  }
  finally {
    if (current === generation && active)
      loading.value = false
  }
}
async function save(action: FormFooterAction) {
  if (action === 'cancel') {
    await leave()
    return
  }
  if (loading.value || error.value || session.busy || session.pending)
    return
  const input = JSON.stringify(draft.value)
  submittedInput = input
  const current = generation
  loadingAction.value = action
  try {
    const result = await actions.saveForm(session, draft.value, 'save', {})
    if (current !== generation || !active)
      return
    baseline.value = JSON.stringify(result.form.draft)
    history.value = result.form.history
    if (result.retainedInput || input !== JSON.stringify(draft.value)) {
      kit.success('原提交已保存并读回，后来的输入仍保留')
      return
    }
    draft.value = result.form.draft
    kit.success('我方主体已保存并读取确认')
    if (action === 'saveNew') {
      actions.startNew(session)
      draft.value = defaults()
      baseline.value = JSON.stringify(draft.value)
      await router.push('/settings/our-signatories/form')
      await initialize()
      return
    }
    if (closeAfter.value)
      await router.push('/settings/our-signatories')
  }
  catch (cause) {
    if (current === generation && active)
      kit.error(cause instanceof Error ? cause.message : '保存失败')
  }
  finally {
    if (current === generation && active)
      loadingAction.value = null
  }
}
async function recover() {
  const input = JSON.stringify(draft.value)
  const current = generation
  try {
    const result = await actions.recover(session)
    if (current !== generation || !active)
      return
    if (result.outcome === 'applied' && result.form) {
      baseline.value = JSON.stringify(result.form.draft)
      history.value = result.form.history
      if ((submittedInput === null || input === submittedInput) && input === JSON.stringify(draft.value))
        draft.value = result.form.draft
      kit.success('原提交已保存并读取确认，当前输入保留')
    }
    else {
      kit.success('原编号已封存为未应用，可以核对输入后重新提交')
    }
    error.value = ''
  }
  catch (cause) {
    if (current === generation && active)
      kit.error(cause instanceof Error ? cause.message : '核对失败')
  }
}
function adoptLatestVersion() {
  if (!latestConflict.value)
    return
  try {
    actions.adoptConflictVersion(session, latestConflict.value)
    history.value = latestConflict.value.history
    latestConflict.value = null
    kit.success('已核对最新保存版本，当前输入仍保留；请再次明确保存。')
  }
  catch (cause) {
    kit.error(cause instanceof Error ? cause.message : '版本核对失败')
  }
}
async function leave() {
  if (!dirty.value || await kit.confirm({ variant: 'simple', title: '放弃修改', message: '当前资料还有未保存修改，确认返回？', confirmLabel: '放弃修改' }))
    await router.push('/settings/our-signatories')
}
useTabCloseGuard(async () => !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃修改', message: '资料尚未保存，确认关闭？', confirmLabel: '放弃修改' }))
watch(id, () => void initialize(), { immediate: true })
onDeactivated(() => {
  active = false
  invalidate('页面已停用，请重新核对原编辑身份')
})
onBeforeUnmount(() => {
  active = false
  invalidate('页面已关闭')
})
onActivated(() => {
  if (!active) {
    active = true
    void initialize(true)
  }
})
useTabTitle(title)
const fields = [{ key: 'name' as const, label: '真实签约名称', required: true }, { key: 'taxNo' as const, label: '纳税识别号', required: false }, { key: 'registeredAddress' as const, label: '注册地址', required: false }, { key: 'legalRepresentative' as const, label: '法定代表人', required: false }]
function updateField(field: typeof fields[number]['key'], event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (field === 'name')
    draft.value.name = value
  else
    draft.value[field] = value || null
}
</script>

<template>
  <EntityFormShell :title="title" back-label="返回主体目录" :sections="[{ key: 'facts', label: '核实资料' }]" :state="loading && !session.pending ? 'loading' : error && !session.pending ? 'error' : 'ready'" :state-title="error || '正在读取主体资料'" state-action-label="重新核对" @back="leave" @state-action="initialize(Boolean(session.authority))">
    <form class="grid min-w-0 gap-4" @submit.prevent>
      <CommandRecoveryPanel v-if="session.pending" :command-id="session.pending.id" :saved="Boolean(session.pending.result)" :busy="session.busy" @recover="recover" />
      <p v-if="error && session.pending" role="status" class="m-0 text-13px text-ink-soft">
        {{ error }}
      </p>
      <section v-if="latestConflict" role="status" class="panel grid gap-2 p-4 text-13px">
        <strong>资料已更新：版本 {{ latestConflict.version }} · {{ latestConflict.draft.name }}</strong><span>最近保存 {{ latestConflict.updatedAt }}。请核对已保存资料后，决定是否用当前输入继续修改。</span><button type="button" class="btn-secondary justify-self-start" :disabled="Boolean(session.pending)" @click="adoptLatestVersion">
          核对最新版本并保留当前输入
        </button>
      </section>
      <section id="section-facts" class="panel grid gap-4 p-4">
        <SectionHeader title="核实资料" /><p class="m-0 text-13px text-ink-soft">
          资料未核实时留空。主体更名保留核实历史，合同继续采用原签约快照。
        </p><div class="grid gap-4 sm:grid-cols-2">
          <label v-for="field in fields" :key="field.key" class="grid gap-2 text-13px"><span>{{ field.label }}{{ field.required ? ' *' : '' }}</span><input :value="draft[field.key] ?? ''" class="field-input w-full" :required="field.required" :data-testid="`our-signatory-${field.key}`" @input="updateField(field.key, $event)"></label><label class="grid gap-2 text-13px sm:col-span-2"><span>真实核实依据说明</span><textarea v-model="draft.verificationNote" rows="3" class="field-input w-full" data-testid="our-signatory-verificationNote" /></label><label class="grid gap-2 text-13px"><span>使用状态</span><select v-model="draft.status" class="field-input w-full" data-testid="our-signatory-status"><option value="active">可选择</option><option value="inactive">已停用（保留历史）</option></select></label>
        </div>
      </section>
      <section v-if="history.length" class="panel grid gap-3 p-4" aria-label="主体核实历史">
        <SectionHeader title="不可变核实历史" /><article v-for="version in history" :key="version.id" class="rounded border border-line p-3 text-13px">
          <strong>版本 {{ version.version }} · {{ version.draft.name }}</strong><p class="mb-0 mt-2 text-12px text-ink-soft">
            {{ version.occurredAt }} · {{ version.draft.status === 'active' ? '可选择' : '已停用' }} · {{ version.draft.verificationNote || '核实说明未记录' }}
          </p>
        </article>
      </section>
      <FormFooter v-model="closeAfter" :dirty="dirty" close-after-save :loading-action="loadingAction" @action="save" />
    </form>
  </EntityFormShell>
</template>
