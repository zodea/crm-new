<script setup lang="ts">
import type { BoqFormatClass, BoqImportRow } from '~/lib/boq/import'
import { toErrorMessage } from '~/lib/util/error'

const route = useRoute()
const router = useRouter()
const store = useBoqStore()
const { error: toastError, success } = useKitUI()
const projectId = shallowRef('')
const contractId = shallowRef('')
const initialized = shallowRef(false)

const projects = computed(() => store.catalog.map(project => ({
  id: project.id,
  code: project.code,
  name: project.name,
})))
const selectedProject = computed(() => store.catalog.find(project => project.id === projectId.value) ?? null)
const contracts = computed(() => (selectedProject.value?.contracts ?? []).map(contract => ({
  key: contract.id,
  label: contract.no ? `${contract.name} · ${contract.no}` : contract.name,
})))

async function initialize() {
  try {
    await store.loadCatalog()
    const preferredProject = store.catalog.find(project => project.id === route.query.project)
      ?? store.catalog[0]
    projectId.value = preferredProject?.id ?? ''
    contractId.value = preferredProject?.contracts.find(contract => contract.id === route.query.contract)?.id
      ?? preferredProject?.contracts[0]?.id
      ?? ''
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
  finally {
    initialized.value = true
  }
}

watch(projectId, (next, previous) => {
  if (!initialized.value || !next || next === previous)
    return
  contractId.value = store.catalog.find(project => project.id === next)?.contracts[0]?.id ?? ''
})

async function importRows(payload: {
  fileName: string
  formatClass: BoqFormatClass
  rows: readonly BoqImportRow[]
}) {
  try {
    const result = await store.importWorkbook({
      projectId: projectId.value,
      contractId: contractId.value,
      fileName: payload.fileName,
      formatClass: payload.formatClass,
      rows: payload.rows,
    })
    success(`已导入 ${result.lineCount} 行，${result.linkedTemplateLineCount} 行已回接户型工程量`)
    await router.push({
      path: '/contract/boq',
      query: { project: projectId.value, contract: contractId.value },
    })
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

onMounted(initialize)
</script>

<template>
  <div class="min-w-0 space-y-4">
    <section class="panel p-4">
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-52 flex-1">
          <NuxtLink
            :to="{ path: '/contract/boq', query: { project: projectId, contract: contractId } }"
            class="inline-flex items-center gap-1 text-11px font-700 text-brand"
          >
            <span class="i-lucide-arrow-left" /> 返回工程量清单
          </NuxtLink>
          <h1 class="mt-1 text-20px font-850 text-ink">
            合同清单拆表
          </h1>
          <p class="mt-1 text-12px text-ink-soft">
            自定义 A–E 类解析流程；不走通用业务导入映射，确认后直接成为合同量与合同价来源。
          </p>
        </div>
        <div class="min-w-52">
          <span class="field-label block">项目</span>
          <ProjectSwitcher
            v-model="projectId"
            :projects="projects"
            :loading="!initialized && store.loading"
            :error="store.error"
            aria-label="选择导入项目"
          />
        </div>
        <div class="min-w-64">
          <span class="field-label block">施工合同</span>
          <SelectFilter v-model="contractId" :options="contracts" :min-width="250" />
        </div>
      </div>
    </section>

    <BoqImportWizard
      v-if="initialized && projectId && contractId"
      :project-id="projectId"
      :contract-id="contractId"
      :busy="store.saving"
      @import="importRows"
    />
    <section v-else class="panel grid min-h-72 place-items-center p-6 text-center text-12px text-ink-soft">
      {{ store.loading ? '正在读取施工合同…' : '请先选择有施工合同的项目。' }}
    </section>
  </div>
</template>
