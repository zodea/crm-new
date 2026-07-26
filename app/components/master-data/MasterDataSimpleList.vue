<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type {
  MasterDataListKind,
  MasterDataListRow,
} from '~/stores/master-data-read'
import { FORM_META } from '~/lib/master-data/page'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  kind: MasterDataListKind
}>()

const { confirm, success, warning, error } = useKitUI()
const readStore = useMasterDataReadStore()
const { rowsByKind, loadingByKind } = storeToRefs(readStore)
const customerStore = useCustomerStore()
const crewStore = useCrewStore()
const workerStore = useWorkerStore()
const targetCostStore = useTargetCostStore()
const stores = {
  customer: customerStore,
  crew: crewStore,
  worker: workerStore,
  target_cost: targetCostStore,
}
const search = shallowRef('')
const rows = computed<MasterDataListRow[]>(() => [
  ...rowsByKind.value[props.kind],
])
const loading = computed(() => loadingByKind.value[props.kind])
const meta = computed(() => FORM_META[props.kind])
const activeStore = computed(() => stores[props.kind])
const activeRevision = computed(() => activeStore.value.revision)

const columns = computed<KitTableColumn[]>(() => {
  switch (props.kind) {
    case 'customer':
      return [
        { field: 'name', title: '客户名称', minWidth: 190 },
        { field: 'taxNo', title: '统一社会信用代码', width: 190 },
        { field: 'contact', title: '联系人', width: 110 },
        { field: 'contactPhone', title: '联系电话', width: 130 },
        { field: 'status', title: '状态', width: 90 },
        { title: '操作', type: 'action', width: 96 },
      ]
    case 'crew':
      return [
        { field: 'name', title: '班组名称', minWidth: 180 },
        { field: 'trade', title: '工种', width: 110 },
        { field: 'contactName', title: '负责人', width: 110 },
        { field: 'contactPhone', title: '联系电话', width: 130 },
        { field: 'status', title: '状态', width: 90 },
        { title: '操作', type: 'action', width: 96 },
      ]
    case 'worker':
      return [
        { field: 'name', title: '姓名', minWidth: 130 },
        { field: 'trade', title: '工种', width: 110 },
        { field: 'crewName', title: '所属班组', minWidth: 150 },
        { field: 'projectName', title: '当前项目', minWidth: 170 },
        { field: 'projectStatus', title: '在场状态', width: 100 },
        { field: 'phone', title: '联系电话', width: 130 },
        { title: '操作', type: 'action', width: 96 },
      ]
    case 'target_cost':
      return [
        { field: 'name', title: '版本名', minWidth: 170 },
        { field: 'projectName', title: '项目', minWidth: 190 },
        { field: 'isBaselineLabel', title: '当前基线', width: 100 },
        { field: 'taxInclusiveTotal', title: '含税合价', type: 'money', width: 140 },
        { field: 'signedContractSum', title: '已签合同额', type: 'money', width: 140 },
        { field: 'status', title: '状态', width: 90 },
        { title: '操作', type: 'action', width: 96 },
      ]
  }
  return []
})

const filtered = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase('zh-CN')
  if (!keyword)
    return rows.value
  return rows.value.filter(row =>
    Object.values(row).some(value =>
      typeof value === 'string' && value.toLocaleLowerCase('zh-CN').includes(keyword),
    ),
  )
})

async function load() {
  await readStore.load(props.kind)
}

async function remove(row: MasterDataListRow) {
  const accepted = await confirm({
    variant: 'simple',
    title: `删除${meta.value.label}`,
    message: `确认删除「${row.name}」？记录将进入软删除状态。`,
    confirmLabel: '删除',
  })
  if (!accepted)
    return
  try {
    const logId = await removeThroughStore(row.id)
    if (!logId) {
      error('记录不存在或已删除')
      return
    }
    success(`已删除「${row.name}」`)
    await load()
  }
  catch (cause) {
    warning(`无法删除「${row.name}」：${toErrorMessage(cause)}`)
  }
}

async function removeThroughStore(id: string) {
  return activeStore.value.remove(id)
}

let mounted = false
watch(activeRevision, () => {
  if (mounted)
    void load()
})
onMounted(async () => {
  mounted = true
  await load()
})
onActivated(() => {
  if (mounted)
    void load()
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <header class="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <div class="mr-auto">
        <h1 class="text-17px font-800 text-ink">
          {{ meta.listLabel }}
        </h1>
        <p class="mt-0.5 text-11px text-ink-faint">
          共 {{ rows.length }} 条 · 所有编辑进入整页表单
        </p>
      </div>
      <SearchInput v-model="search" :placeholder="`搜索${meta.label}`" />
      <KitButton type="button" variant="secondary" :loading="loading" @click="load">
        刷新
      </KitButton>
      <KitButton type="button" variant="primary" @click="navigateTo(meta.newPath)">
        <span class="i-lucide-plus mr-1" aria-hidden="true" />
        新建
      </KitButton>
    </header>

    <KitTable
      :columns="columns"
      :data="filtered"
      :loading="loading"
      :min-rows="10"
      :empty="`暂无${meta.label}数据`"
    >
      <template #action="{ row }">
        <div class="flex items-center justify-end gap-1">
          <button
            type="button"
            class="icon-btn"
            :aria-label="`编辑${row.name}`"
            @click="navigateTo(`${meta.newPath}/${row.id}`)"
          >
            <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-btn-danger"
            :aria-label="`删除${row.name}`"
            @click="remove(row)"
          >
            <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
          </button>
        </div>
      </template>
    </KitTable>
  </div>
</template>
