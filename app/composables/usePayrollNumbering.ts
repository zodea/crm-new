import type { PayrollNumberingCommand, PayrollNumberingRead } from '~/lib/payroll/central-numbering-contract'
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { officialNumber } from '~/lib/payroll/central-numbering-codec'
import { createPayrollOfficialWorkbook, payrollOfficialFilename } from '~/lib/payroll/numbering-export'
import { toErrorMessage } from '~/lib/util/error'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { usePayrollNumberingStore } from '~/stores/payroll-numbering'

export function usePayrollNumbering(projectId: () => string, statementId: () => string) {
  const store = usePayrollNumberingStore()
  const kit = useKitUI()
  const current = shallowRef<PayrollNumberingRead | null>(null)
  const printRead = shallowRef<PayrollNumberingRead | null>(null)
  const nextNumber = ref('')
  const evidenceNote = ref('')
  const busy = shallowRef(false)
  const error = shallowRef('')
  const active = shallowRef(true)
  const pending = computed(() => current.value ? store.getPending(current.value) : null)
  const dirty = computed(() => !current.value?.settings && (!!nextNumber.value || !!evidenceNote.value))
  const writable = computed(() => !!current.value && !current.value.context.readonly && !busy.value && !pending.value && active.value)
  let generation = 0
  let controller = new AbortController()
  const target = () => JSON.stringify([projectId(), statementId()])
  const same = (token: number, key: string) => active.value && token === generation && key === target()
  async function load() {
    if (!active.value || busy.value)
      return
    const token = ++generation
    const key = target()
    busy.value = true
    error.value = ''
    try {
      if (!isStableRouteIdentity(projectId()) || !isStableRouteIdentity(statementId()))
        throw new Error('请从原工资详情进入正式出具，保留原项目与工资身份。')
      const read = await store.load({ projectId: projectId(), statementId: statementId() })
      if (!same(token, key))
        return
      current.value = read
      const original = store.getPending(read)?.command
      if (original?.action.kind === 'initialize') {
        nextNumber.value = String(original.action.nextNumber)
        evidenceNote.value = original.action.evidenceNote
      }
    }
    catch (cause) {
      if (same(token, key)) {
        current.value = null
        error.value = toErrorMessage(cause)
      }
    }
    finally {
      if (same(token, key))
        busy.value = false
    }
  }
  async function submit(kind: 'initialize' | 'issue' | 'recover') {
    const read = current.value
    if (!read || busy.value || !active.value || (kind !== 'recover' && !writable.value))
      return
    const token = generation
    const key = target()
    busy.value = true
    error.value = ''
    try {
      let action: PayrollNumberingCommand['action'] | null = null
      if (kind === 'initialize') {
        const number = /^\d+$/.test(nextNumber.value.trim()) ? Number(nextNumber.value.trim()) : NaN
        if (!read.eligibility.canInitialize || !officialNumber(number) || !evidenceNote.value.trim())
          throw new Error('请填写已核对的下一张正整数编号及旧纸号核对依据。')
        const confirmed = await kit.confirm({ variant: 'simple', title: '登记项目编号起点', message: `确认旧纸号已核对，下一张正式工资从 ${number} 开始？登记后不能直接重置序列。`, confirmLabel: '确认登记起点' })
        if (!confirmed || !same(token, key))
          return
        action = { kind: 'initialize', nextNumber: number, evidenceNote: evidenceNote.value.trim() }
      }
      else if (kind === 'issue') {
        if (!read.eligibility.canIssue || read.issue)
          return
        const confirmed = await kit.confirm({ variant: 'simple', title: '正式出具工资', message: '确认已预览这份冻结工资？正式出具将固定项目唯一编号，下载失败或重复下载仍沿用这个编号。', confirmLabel: '正式出具' })
        if (!confirmed || !same(token, key))
          return
        action = { kind: 'issue' }
      }
      const result = kind === 'recover' ? await store.recover(read) : await store.submit(read, action!)
      if (!same(token, key))
        return
      current.value = result
      printRead.value = null
      kit.success(kind === 'initialize' ? '项目编号起点已登记' : result.issue ? `已读回正式编号 ${result.issue.number}` : '原提交已核对')
    }
    catch (cause) {
      if (same(token, key))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (same(token, key))
        busy.value = false
    }
  }
  async function freshOutput(read: PayrollNumberingRead, token: number, key: string) {
    const fresh = await store.load(read.input)
    if (!same(token, key) || fresh.context.workspaceId !== read.context.workspaceId || fresh.context.actorId !== read.context.actorId
      || !fresh.eligibility.canDownload || !fresh.issue || fresh.issue.id !== read.issue?.id) {
      throw new Error('正式原件、权限或查看范围已变化，输出已停止。')
    }
    return fresh
  }
  async function output(kind: 'download' | 'print') {
    const read = current.value
    if (!read?.eligibility.canDownload || busy.value || pending.value || !active.value)
      return
    const token = generation
    const key = target()
    busy.value = true
    error.value = ''
    try {
      if (kind === 'download') {
        await kit.exportFile({ defaultName: payrollOfficialFilename(read), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', signal: controller.signal, data: async () => {
          const file = createPayrollOfficialWorkbook(await freshOutput(read, token, key))
          if (typeof file.data === 'function')
            throw new Error('正式工资正文无效')
          return file.data
        } })
      }
      else {
        printRead.value = await freshOutput(read, token, key)
        await nextTick()
        if (same(token, key))
          window.print()
      }
    }
    catch (cause) {
      if (same(token, key)) {
        printRead.value = null
        error.value = toErrorMessage(cause)
      }
    }
    finally {
      if (same(token, key))
        busy.value = false
    }
  }
  async function mayLeave() {
    if (busy.value || pending.value) {
      error.value = '请先核对原编号提交结果，再离开此页。'
      return false
    }
    return !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃起点登记输入', message: '旧纸号起点尚未登记，确认放弃这些输入？', confirmLabel: '放弃输入' })
  }
  useTabCloseGuard(mayLeave)
  onBeforeRouteLeave(mayLeave)
  onBeforeRouteUpdate(mayLeave)
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (dirty.value || pending.value || busy.value) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  useEventListener('afterprint', () => {
    printRead.value = null
  })
  function suspend() {
    generation++
    active.value = false
    busy.value = false
    current.value = null
    printRead.value = null
    controller.abort()
  }
  onDeactivated(suspend)
  onScopeDispose(suspend)
  onActivated(() => {
    if (!active.value) {
      active.value = true
      controller = new AbortController()
      void load()
    }
  })
  watch(target, () => {
    generation++
    controller.abort()
    controller = new AbortController()
    busy.value = false
    current.value = null
    printRead.value = null
    nextNumber.value = ''
    evidenceNote.value = ''
    void load()
  }, { immediate: true })
  return { current, printRead, nextNumber, evidenceNote, busy, error, dirty, writable, pending, load, submit, output }
}
