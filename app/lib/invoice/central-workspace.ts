import type { RecoveryStorage } from '../forms/command-recovery'
import type { CentralInvoiceCommand, CentralInvoiceFields, CentralInvoiceItem, CentralInvoicePrintCommand, CentralInvoiceRecord, InvoiceContractReference, InvoiceTaxVerificationSelection } from './central-contract'
import type { createCentralInvoiceHttp } from './central-http'
import type { LocalInvoiceCandidate } from './recognize'
import { readonly, shallowRef } from 'vue'
import { problemFromHttpFailure } from '../read-model/problem'
import { INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY } from './central-contract'
import { invoiceCandidateForCommand } from './central-recognition'
import { createCentralInvoicePrintSession, createCentralInvoiceSession, pendingCentralInvoiceCommands } from './central-session'
import { prepareInvoiceOriginal } from './central-upload'

type Client = ReturnType<typeof createCentralInvoiceHttp>
interface Context { workspaceId: string, actorId: string, capabilities: readonly string[] }
type Identity = Pick<Context, 'workspaceId' | 'actorId'>

export class CentralInvoiceLoadSupersededError extends Error {
  constructor() {
    super('发票读取目标已变化。')
    this.name = 'CentralInvoiceLoadSupersededError'
  }
}

/** 工作台与台账共用同一中央事实；页面草稿及文件对象由调用方持有。 */
export function createCentralInvoiceWorkspace(options: {
  identity: Identity
  client: Client
  context: () => Promise<Context>
  recognizeLocal: (file: File) => Promise<LocalInvoiceCandidate>
  recognizeCloud?: (file: File) => Promise<LocalInvoiceCandidate>
  storage?: () => RecoveryStorage
  commandId?: () => string
}) {
  const identity = { workspaceId: options.identity.workspaceId, actorId: options.identity.actorId }
  const records = shallowRef<CentralInvoiceRecord[]>([])
  const loading = shallowRef(false)
  const readState = shallowRef<'unread' | 'loading' | 'ready' | 'unavailable'>('unread')
  const sourceVersion = shallowRef<string | null>(null)
  let sourceRevision: number | null = null
  let generation = 0
  const makeId = options.commandId ?? (() => crypto.randomUUID())
  function invalidate() {
    records.value = []
    sourceVersion.value = null
    sourceRevision = null
    readState.value = 'unavailable'
  }
  async function authorize(write = false) {
    let actor: Context
    try {
      actor = await options.context()
    }
    catch (cause) {
      invalidate()
      throw cause
    }
    if (actor.workspaceId !== identity.workspaceId || actor.actorId !== identity.actorId
      || !actor.capabilities.includes(INVOICE_READ_CAPABILITY) || (write && !actor.capabilities.includes(INVOICE_WRITE_CAPABILITY))) {
      invalidate()
      throw new Error('发票工作区身份或权限已变化，请重新登录后核对原提交。')
    }
  }
  const session = (targetId: string | null) => createCentralInvoiceSession({ identity, targetId, repository: options.client, context: options.context, storage: options.storage })
  const printSession = () => createCentralInvoicePrintSession({ identity, repository: options.client, context: options.context, storage: options.storage })
  function updateRecord(record: CentralInvoiceRecord) {
    const index = records.value.findIndex(item => item.id === record.id)
    if (record.deletedAt !== null) {
      records.value = records.value.filter(item => item.id !== record.id)
      return
    }
    if (index < 0)
      records.value = [record, ...records.value]
    else
      records.value = records.value.map(item => item.id === record.id ? record : item)
  }
  async function guarded<T>(operation: () => Promise<T>) {
    try {
      return await operation()
    }
    catch (cause) {
      if (['forbidden', 'unauthenticated'].includes(problemFromHttpFailure(cause)?.code ?? ''))
        invalidate()
      throw cause
    }
  }
  function applyReadBatch(reads: Array<{ record: CentralInvoiceRecord, meta: { sources: Array<{ key: string, sourceVersion: string | null }> }, sourceVersion: string }>) {
    if (loading.value) {
      generation++
      loading.value = false
      invalidate()
      return
    }
    if (readState.value !== 'ready')
      return
    const versions = reads.map(read => read.meta.sources.find(source => source.key === 'invoices')?.sourceVersion ?? '')
    const parsed = versions.map(value => /^invoices:\d+$/.test(value) ? Number(value.slice('invoices:'.length)) : Number.NaN)
    if (!reads.length || sourceRevision === null || parsed.some(value => !Number.isSafeInteger(value) || value !== sourceRevision! + 1)
      || reads.some(read => read.sourceVersion !== reads[0]!.sourceVersion)) {
      invalidate()
      return
    }
    reads.forEach(read => updateRecord(read.record))
    sourceRevision = parsed[0]!
    sourceVersion.value = reads[0]!.sourceVersion
  }
  async function load() {
    const current = ++generation
    loading.value = true
    readState.value = 'loading'
    let checkingAuthority = false
    try {
      checkingAuthority = true
      await authorize()
      checkingAuthority = false
      const next: CentralInvoiceRecord[] = []
      let expectedVersion: string | null = null
      let expectedTotal: number | null = null
      let expectedRevision: number | null = null
      for (let page = 1; ; page++) {
        const response = await options.client.list({ page, pageSize: 100 })
        if ((expectedVersion !== null && response.sourceVersion !== expectedVersion) || (expectedTotal !== null && response.pagination.total !== expectedTotal))
          throw new Error('发票列表读取期间发生变化，请重新读取。')
        expectedVersion = response.sourceVersion
        expectedTotal = response.pagination.total
        const revision = Number(response.meta.sources[0]!.sourceVersion!.slice('invoices:'.length))
        if (!Number.isSafeInteger(revision) || (expectedRevision !== null && revision !== expectedRevision))
          throw new Error('发票列表来源版本无法核验。')
        expectedRevision = revision
        next.push(...response.items)
        if (next.length >= response.pagination.total)
          break
      }
      checkingAuthority = true
      await authorize()
      checkingAuthority = false
      if (generation !== current)
        throw new CentralInvoiceLoadSupersededError()
      if (new Set(next.map(record => record.id)).size !== next.length)
        throw new Error('发票列表身份重复，请重新读取。')
      records.value = next
      sourceVersion.value = expectedVersion
      sourceRevision = expectedRevision
      readState.value = 'ready'
    }
    catch (cause) {
      if (generation === current) {
        invalidate()
      }
      else if (!checkingAuthority && !['forbidden', 'unauthenticated'].includes(problemFromHttpFailure(cause)?.code ?? '')
        && !(cause instanceof CentralInvoiceLoadSupersededError)) {
        throw new CentralInvoiceLoadSupersededError()
      }
      throw cause
    }
    finally {
      if (generation === current)
        loading.value = false
    }
  }
  async function execute(command: CentralInvoiceCommand, beforeSubmit?: () => boolean) {
    await authorize(true)
    const target = 'invoiceId' in command ? command.invoiceId : null
    return guarded(async () => {
      const saved = await session(target).submit(command, beforeSubmit)
      applyReadBatch([saved.read])
      return saved.read.record
    })
  }
  function envelope() {
    return { ...identity, requiredCapability: INVOICE_WRITE_CAPABILITY, commandId: makeId() }
  }
  async function verifiedOriginal(invoice: CentralInvoiceRecord, write = false) {
    await authorize(write)
    if (!invoice.original)
      throw new Error('该发票没有已保存原件，请先关联原件。')
    const blob = await guarded(() => options.client.original(invoice.id, { version: invoice.version, original: invoice.original }))
    await authorize(write)
    const subtle = globalThis.crypto?.subtle
    if (!subtle || blob.size !== invoice.original.fileSize)
      throw new Error('发票原件已变化或无法核对，请重新读取。')
    const bytes = await blob.arrayBuffer()
    const digest = Array.from(new Uint8Array(await subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
    await authorize(write)
    if (digest !== invoice.original.sha256)
      throw new Error('发票原件已变化，请重新读取后再操作。')
    return blob
  }
  async function recognizeFile(invoice: CentralInvoiceRecord, source: 'local' | 'cloud', confirmedCloud = false, cloudSourceIsCurrent?: () => boolean) {
    const blob = await verifiedOriginal(invoice, true)
    if (!invoice.original)
      throw new Error('该发票没有已保存原件，请先关联原件。')
    const file = new File([blob], invoice.original.fileName, { type: invoice.original.mimeType })
    let candidate: LocalInvoiceCandidate
    if (source === 'cloud') {
      if (!confirmedCloud || !options.recognizeCloud)
        throw new Error('云识别尚未启用，或尚未明确确认发送所选文件。')
      if (cloudSourceIsCurrent && !cloudSourceIsCurrent())
        throw new Error('发票或权限已变化，未发送云识别。')
      candidate = await options.recognizeCloud(file)
    }
    else {
      candidate = await options.recognizeLocal(file)
    }
    await authorize(true)
    if (source === 'cloud' && cloudSourceIsCurrent && !cloudSourceIsCurrent())
      throw new Error('发票或权限已变化，识别结果未保存。')
    if (candidate.source !== source || candidate.requiresReview !== true)
      throw new Error('识别来源或人工核对标记不一致，请重新识别。')
    return candidate
  }
  async function recognizeWithCandidate(invoice: CentralInvoiceRecord, source: 'local' | 'cloud' = 'local', confirmedCloud = false, cloudSourceIsCurrent?: () => boolean) {
    const candidate = await recognizeFile(invoice, source, confirmedCloud, cloudSourceIsCurrent)
    const record = await execute({ ...envelope(), action: 'recognize', invoiceId: invoice.id, baseVersion: invoice.version, ...invoiceCandidateForCommand(candidate) }, source === 'cloud' ? cloudSourceIsCurrent : undefined)
    return { record, candidate }
  }
  return {
    records: readonly(records),
    loading: readonly(loading),
    readState: readonly(readState),
    sourceVersion: readonly(sourceVersion),
    load,
    pending: (targetId: string | null) => session(targetId).pending(),
    pendingAll: () => pendingCentralInvoiceCommands(identity, options.storage),
    pendingPrint: () => printSession().pending(),
    async recover(targetId: string | null) {
      return guarded(async () => {
        const result = await session(targetId).recover()
        if (result?.outcome === 'applied') {
          applyReadBatch([result.read])
          if (readState.value !== 'ready')
            await load()
        }
        return result
      })
    },
    async recoverPrint() {
      return guarded(async () => {
        const result = await printSession().recover()
        if (result?.outcome === 'applied')
          applyReadBatch(result.reads)
        return result
      })
    },
    async upload(file: File, projectId: string | null) {
      const original = await prepareInvoiceOriginal(file)
      return projectId === null
        ? execute({ ...envelope(), action: 'upload', baseVersion: null, ownerKind: 'company', projectId: null, original })
        : execute({ ...envelope(), action: 'upload', baseVersion: null, projectId, original })
    },
    async manual(fields: CentralInvoiceFields, items: CentralInvoiceItem[]) {
      return execute({ ...envelope(), action: 'manual', baseVersion: null, fields, items })
    },
    async attachOriginal(invoice: CentralInvoiceRecord, file: File, confirmed: boolean, beforeSubmit?: () => boolean) {
      if (!confirmed)
        throw new Error('请先确认原件属于这张发票。')
      const original = await prepareInvoiceOriginal(file)
      if (beforeSubmit && !beforeSubmit())
        throw new Error('发票或来源已变化，原件关联未提交。')
      return execute({ ...envelope(), action: 'attach-original', invoiceId: invoice.id, baseVersion: invoice.version, original, confirmed: true }, beforeSubmit)
    },
    async recognize(invoice: CentralInvoiceRecord, source: 'local' | 'cloud' = 'local', confirmedCloud = false) {
      return (await recognizeWithCandidate(invoice, source, confirmedCloud)).record
    },
    recognizeWithCandidate,
    prepareRerecognition: recognizeFile,
    async saveRerecognition(invoice: CentralInvoiceRecord, candidate: LocalInvoiceCandidate, currentFields: CentralInvoiceFields, currentItems: CentralInvoiceItem[], confirmed: boolean, beforeSubmit?: () => boolean) {
      if (!confirmed)
        throw new Error('请先确认重新识别后的字段变化。')
      return execute({ ...envelope(), action: 'rerecognize', invoiceId: invoice.id, baseVersion: invoice.version, ...invoiceCandidateForCommand(candidate), currentFields, currentItems, confirmed: true }, beforeSubmit)
    },
    async edit(invoice: CentralInvoiceRecord, fields: CentralInvoiceFields, items: CentralInvoiceItem[], beforeSubmit?: () => boolean) {
      return execute({ ...envelope(), action: 'edit', invoiceId: invoice.id, baseVersion: invoice.version, fields, items }, beforeSubmit)
    },
    async editArchived(_invoice: CentralInvoiceRecord, _fields: CentralInvoiceFields, _items: CentralInvoiceItem[], _confirmed: boolean) {
      throw new Error('已归档发票须使用独立更正单；该流程尚未开放。')
    },
    async linkContract(_invoice: CentralInvoiceRecord, _contract: InvoiceContractReference | null, _confirmed: boolean) {
      throw new Error('已归档发票的合同变更须使用独立更正单；该流程尚未开放。')
    },
    async confirmLegacy(invoice: CentralInvoiceRecord, confirmed: boolean, beforeSubmit?: () => boolean) {
      if (!confirmed)
        throw new Error('请先明确确认旧发票已核对。')
      return execute({ ...envelope(), action: 'confirm-legacy', invoiceId: invoice.id, baseVersion: invoice.version, confirmed: true }, beforeSubmit)
    },
    async review(invoice: CentralInvoiceRecord, manualCompletion: boolean, beforeSubmit?: () => boolean) {
      return execute({ ...envelope(), action: 'review', invoiceId: invoice.id, baseVersion: invoice.version, manualCompletion }, beforeSubmit)
    },
    async archive(invoice: CentralInvoiceRecord, ownerKind: 'project' | 'personal' | 'company', projectId: string | null, supplierId: string, taxNumbersConfirmed: boolean, taxVerification: InvoiceTaxVerificationSelection, contract?: InvoiceContractReference | null, beforeSubmit?: () => boolean) {
      if (!taxNumbersConfirmed)
        throw new Error('请先核对购销双方税号。')
      if (ownerKind === 'company') {
        if (projectId !== null || !contract || contract.domain !== 'company')
          throw new Error('公司开销归档须选择真实公司支出合同。')
        return execute({ ...envelope(), action: 'archive', invoiceId: invoice.id, baseVersion: invoice.version, ownerKind, projectId: null, supplierId, taxNumbersConfirmed: true, taxVerification, contract: { ...contract, domain: 'company' } }, beforeSubmit)
      }
      if (contract && (ownerKind !== 'project' || contract.domain === 'company'))
        throw new Error('请选择与项目归属一致的合同。')
      return execute({ ...envelope(), action: 'archive', invoiceId: invoice.id, baseVersion: invoice.version, ownerKind, projectId, supplierId, taxNumbersConfirmed: true, taxVerification, ...(contract ? { contract } : {}) }, beforeSubmit)
    },
    async discard(invoice: CentralInvoiceRecord, beforeSubmit?: () => boolean) {
      return execute({ ...envelope(), action: 'discard', invoiceId: invoice.id, baseVersion: invoice.version }, beforeSubmit)
    },
    async restore(invoice: CentralInvoiceRecord) {
      return execute({ ...envelope(), action: 'restore', invoiceId: invoice.id, baseVersion: invoice.version })
    },
    async recordPrinted(targets: CentralInvoicePrintCommand['targets']) {
      return guarded(async () => {
        const result = await printSession().submit({ ...envelope(), action: 'record-printed', targets })
        applyReadBatch(result.reads)
        return result.result
      })
    },
    original: (invoiceId: string) => guarded(() => options.client.original(invoiceId)),
    verifiedOriginal,
    previewImport: (input: Parameters<Client['previewImport']>[0]) => guarded(() => options.client.previewImport(input)),
    execute,
  }
}
