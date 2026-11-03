<script setup lang="ts">
import type { MaterialExcelDecision, MaterialExcelFile, MaterialExcelPreviewRow } from '~/lib/material-contract/excel-contract'
import { computed, shallowRef } from 'vue'
import { materialExcelFieldLabel } from '~/lib/material-contract/excel-import'
import { useMaterialExcelImportStore } from '~/stores/material-excel-import'

interface Choice { mode?: string, project?: string, supplier?: string, main?: string, signatory?: string }
const baseURL = useRuntimeConfig().app.baseURL
const store = useMaterialExcelImportStore()
const router = useRouter()
const file = shallowRef<MaterialExcelFile | null>(null)
const hash = shallowRef('')
const rows = shallowRef<MaterialExcelPreviewRow[]>([])
const choices = shallowRef<Readonly<Record<string, Choice>>>({})
const page = shallowRef(1)
const busy = shallowRef(false)
const pending = shallowRef(false)
const message = shallowRef('')
const error = shallowRef('')
const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / 10)))
const visible = computed(() => rows.value.slice((page.value - 1) * 10, page.value * 10))
const normalized = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
const numberText = (value: unknown) => String(value ?? '').trim()
const duplicateRows = computed(() => {
  const result = new Map<string, number[]>()
  for (const row of rows.value) {
    const peers = rows.value.filter(other => other.key !== row.key && ((normalized(row.draft.name) && normalized(row.draft.name) === normalized(other.draft.name)) || (numberText(row.draft.no) && numberText(row.draft.no) === numberText(other.draft.no))))
    if (peers.length)
      result.set(row.key, peers.map(peer => peer.rowNumber))
  }
  return result
})
const invalid = computed(() => rows.value.filter((row) => {
  const choice = choices.value[row.key]
  if (choice?.mode === 'skip')
    return false
  const selected = row.candidates.find(item => `replace:${item.id}` === choice?.mode)
  return !choice?.mode || (choice.mode !== 'create' && !selected) || (!!selected && !!selected.lineCount && !!row.lineCount)
    || !row.projects.some(item => item.id === choice.project) || !row.suppliers.some(item => item.id === choice.supplier)
    || !row.mains.some(item => item.id === choice.main && item.projectId === choice.project)
    || (!!row.signatoryName && !row.signatories.some(item => item.id === choice.signatory))
}))
const remaining = computed(() => rows.value.filter(row => choices.value[row.key]?.mode !== 'skip').length)
function change(key: string, field: keyof Choice, value: string) {
  if (busy.value || pending.value)
    return
  const previous = choices.value[key] ?? {}
  choices.value = { ...choices.value, [key]: { ...previous, [field]: value, ...(field === 'project' ? { main: '' } : {}) } }
}
async function selectFile(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0]
  if (!selected || busy.value || pending.value)
    return
  error.value = ''
  message.value = ''
  rows.value = []
  file.value = null
  if (!/\.xlsx$/i.test(selected.name) || selected.size > 10 * 1024 * 1024) {
    error.value = '请选择不超过 10 MiB 的 .xlsx 文件'
    return
  }
  busy.value = true
  try {
    const bytes = new Uint8Array(await selected.arrayBuffer())
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    hash.value = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    file.value = { fileName: selected.name, fileSize: selected.size, payloadBase64: btoa(binary) }
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '文件读取失败' }
  finally { busy.value = false }
}
async function check() {
  if (!file.value || busy.value || pending.value)
    return
  busy.value = true
  error.value = ''
  try {
    const recovered = await store.recoverPending()
    if (recovered.applied || recovered.notApplied)
      message.value = `已核对上次批次：${recovered.applied} 份已保存，${recovered.notApplied} 份未保存。请重新核对。`
    const result = await store.preview(file.value)
    if (result.fileHash !== hash.value)
      throw new Error('工作簿摘要与本次文件不一致')
    rows.value = result.rows
    choices.value = {}
    page.value = 1
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '合同预览失败' }
  finally { busy.value = false }
}
function decisions(): MaterialExcelDecision[] {
  return rows.value.map((row) => {
    const choice = choices.value[row.key]!
    if (choice.mode === 'skip')
      return { key: row.key, fingerprint: row.fingerprint, kind: 'skip' }
    const target = row.candidates.find(item => `replace:${item.id}` === choice.mode)
    const project = row.projects.find(item => item.id === choice.project)!
    const supplier = row.suppliers.find(item => item.id === choice.supplier)!
    const signatory = row.signatories.find(item => item.id === choice.signatory)
    const main = row.mains.find(item => item.id === choice.main && item.projectId === project.id)!
    return { key: row.key, fingerprint: row.fingerprint, ...(target ? { kind: 'replace', id: target.id, version: target.version } : { kind: 'create' }), project, supplier, ...(signatory ? { signatory } : {}), main: { id: main.id, projectId: main.projectId, basis: main.basis } }
  })
}
async function submit() {
  if (!file.value || busy.value || pending.value || invalid.value.length || !remaining.value)
    return
  busy.value = true
  error.value = ''
  try {
    const count = await store.importBatch(file.value, hash.value, decisions())
    rows.value = []
    file.value = null
    message.value = `已保存 ${count} 份采购合同及其来源原件。`
  }
  catch (cause) {
    pending.value = true
    error.value = cause instanceof Error ? cause.message : '批次结果未知，请核对原提交'
  }
  finally { busy.value = false }
}
async function recover() {
  if (busy.value)
    return
  busy.value = true
  try {
    const result = await store.recoverPending()
    pending.value = false
    rows.value = []
    error.value = ''
    message.value = `已核对原批次：${result.applied} 份已保存，${result.notApplied} 份未保存。请重新预览。`
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '暂时无法核对原批次' }
  finally { busy.value = false }
}
const display = (value: unknown) => value == null || value === '' ? '（空）' : String(value)
</script>

<template>
  <main class="mx-auto grid max-w-4xl min-w-0 gap-4 p-4" aria-labelledby="material-excel-title">
    <header>
      <h1 id="material-excel-title" class="text-18px text-ink font-800">
        批量导入采购合同
      </h1><p class="mt-1 text-12px text-ink-soft">
        整份工作簿确认后一起保存；合同、采购明细、工作簿原件及施工归属同批写入。
      </p>
    </header>
    <section class="panel grid gap-3 p-4" aria-label="选择工作簿">
      <p class="text-12px text-ink-soft">
        下载 <a :href="`${baseURL}templates/material-contract-excel-template.xlsx`" download="采购合同批量导入模板.xlsx" class="text-brand underline">采购合同 Excel 参考模板</a>，填写“合同主档”和“采购明细”。
      </p>
      <label class="grid gap-1 text-12px">选择导入文件<input type="file" accept=".xlsx" :disabled="busy || pending" aria-label="选择导入文件" @change="selectFile"></label>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary" :disabled="!file || busy || pending" @click="check">
          核对工作簿
        </button><button v-if="pending" type="button" class="btn-secondary" :disabled="busy" @click="recover">
          核对原批次并重新预览
        </button><button type="button" class="btn-secondary" :disabled="busy" @click="router.push('/contract/material')">
          返回合同列表
        </button>
      </div>
      <p v-if="error" role="alert" class="text-12px text-danger">
        {{ error }}
      </p><p v-if="message" role="status" class="text-12px text-ink-soft">
        {{ message }}
      </p>
    </section>
    <section v-if="rows.length" class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" aria-label="采购合同核对">
      <h2 class="text-14px font-700">
        核对 {{ rows.length }} 份合同；{{ invalid.length }} 份待处理
      </h2>
      <article v-for="row in visible" :key="row.key" class="panel min-w-0 p-4">
        <h3 class="text-13px font-700">
          第 {{ row.rowNumber }} 行 · {{ display(row.draft.name) }}（分组 {{ row.key }}）
        </h3>
        <p class="mt-1 text-12px text-ink-soft">
          {{ row.lineCount }} 条采购明细。空白字段不覆盖原资料。
        </p>
        <p v-if="duplicateRows.get(row.key)?.length" class="mt-1 text-12px text-danger">
          与文件第 {{ duplicateRows.get(row.key)?.join('、') }} 行名称或编号相同，请逐项核对。草稿允许同号，正式提交时按现行规则检查编号。
        </p>
        <details v-if="row.lineItems.length" class="mt-2 text-12px">
          <summary>查看采购明细</summary><div class="mt-2 overflow-x-auto" tabindex="0" aria-label="采购明细">
            <table class="w-full min-w-[36rem] text-left">
              <thead><tr><th>物资</th><th>规格</th><th>单位</th><th>数量</th><th>含税单价</th></tr></thead><tbody>
                <tr v-for="(line, index) in row.lineItems" :key="index">
                  <td>{{ display(line.materialName) }}</td><td>{{ display(line.spec) }}</td><td>{{ display(line.unit) }}</td><td>{{ display(line.qty) }}</td><td>{{ display(line.taxInclusiveUnitPrice) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
        <div v-for="candidate in row.candidates" :key="candidate.id" class="mt-3 border-t border-line pt-3 text-12px">
          <p class="font-600">
            已有：{{ candidate.no }} {{ candidate.name }}（{{ candidate.lineCount }} 条明细，{{ candidate.attachmentCount }} 个原件）
          </p>
          <p v-if="numberText(row.draft.no) && numberText(row.draft.no) === numberText(candidate.no)" class="text-danger">
            合同编号相同，请核对；草稿可同号，正式提交时检查编号。
          </p><p v-if="candidate.lineCount && row.lineCount" class="text-danger">
            已有明细与文件明细冲突。明细可能被补充协议、财务或其他历史资料采用；当前无法完整核验所有引用，暂不能批量替换。请查看原合同和相关资料后，在合同页面处理。
          </p><div class="overflow-x-auto" tabindex="0" aria-label="已有合同与文件对比">
            <table class="w-full min-w-[28rem] text-left">
              <thead><tr><th>字段</th><th>已有</th><th>文件</th></tr></thead><tbody>
                <tr v-for="(oldValue, key) in candidate.fields" :key="key">
                  <td>{{ materialExcelFieldLabel(String(key)) }}</td><td>{{ display(oldValue) }}</td><td>{{ display((row.draft as Record<string, unknown>)[String(key)]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <label class="mt-3 grid gap-1 text-12px">处理方式<select class="field-input w-full" :value="choices[row.key]?.mode ?? ''" :disabled="busy || pending" :aria-label="`第 ${row.rowNumber} 行处理方式`" @change="change(row.key, 'mode', ($event.target as HTMLSelectElement).value)"><option value="">请选择</option><option value="skip">跳过此合同</option><option value="create">确认新建</option><option v-for="candidate in row.candidates" :key="candidate.id" :value="`replace:${candidate.id}`" :disabled="!!candidate.lineCount && !!row.lineCount">替换 {{ candidate.no }} {{ candidate.name }}（{{ candidate.id }}）</option></select></label>
        <template v-if="choices[row.key]?.mode && choices[row.key]?.mode !== 'skip'">
          <label class="mt-2 grid gap-1 text-12px">项目：{{ row.projectName }}<select class="field-input w-full" :value="choices[row.key]?.project ?? ''" :disabled="busy || pending" :aria-label="`第 ${row.rowNumber} 行项目`" @change="change(row.key, 'project', ($event.target as HTMLSelectElement).value)"><option value="">{{ row.projects.length ? '请选择项目' : '未找到项目' }}</option><option v-for="item in row.projects" :key="item.id" :value="item.id">{{ item.name }}（{{ item.id }}）</option></select></label>
          <label class="mt-2 grid gap-1 text-12px">施工主合同：{{ row.constructionName }}<select class="field-input w-full" :value="choices[row.key]?.main ?? ''" :disabled="busy || pending" :aria-label="`第 ${row.rowNumber} 行施工主合同`" @change="change(row.key, 'main', ($event.target as HTMLSelectElement).value)"><option value="">请选择所选项目的施工主合同</option><option v-for="item in row.mains.filter(main => main.projectId === choices[row.key]?.project)" :key="item.id" :value="item.id">{{ item.no }} {{ item.name }}（{{ item.id }}）</option></select></label>
          <label class="mt-2 grid gap-1 text-12px">分供方：{{ row.supplierName }}<select class="field-input w-full" :value="choices[row.key]?.supplier ?? ''" :disabled="busy || pending" :aria-label="`第 ${row.rowNumber} 行分供方`" @change="change(row.key, 'supplier', ($event.target as HTMLSelectElement).value)"><option value="">{{ row.suppliers.length ? '请选择分供方' : '未找到分供方' }}</option><option v-for="item in row.suppliers" :key="item.id" :value="item.id">{{ item.name }}（{{ item.id }}）</option></select></label>
          <label v-if="row.signatoryName" class="mt-2 grid gap-1 text-12px">我方签约主体：{{ row.signatoryName }}<select class="field-input w-full" :value="choices[row.key]?.signatory ?? ''" :disabled="busy || pending" :aria-label="`第 ${row.rowNumber} 行我方主体`" @change="change(row.key, 'signatory', ($event.target as HTMLSelectElement).value)"><option value="">{{ row.signatories.length ? '请选择我方主体' : '未找到有效主体' }}</option><option v-for="item in row.signatories" :key="item.id" :value="item.id">{{ item.name }}（{{ item.id }}）</option></select></label>
        </template>
      </article>
      <div v-if="pageCount > 1" class="flex items-center gap-2 text-12px">
        <button type="button" class="btn-secondary" :disabled="page === 1 || busy" @click="page--">
          上一页
        </button><span>第 {{ page }} / {{ pageCount }} 页</span><button type="button" class="btn-secondary" :disabled="page === pageCount || busy" @click="page++">
          下一页
        </button>
      </div>
      <button type="button" class="btn-primary" :disabled="busy || pending || !!invalid.length || !remaining" @click="submit">
        确认并保存整批合同
      </button>
    </section>
  </main>
</template>
