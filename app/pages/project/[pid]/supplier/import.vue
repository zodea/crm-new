<script setup lang="ts">
import type { FileRefDraft } from '~/lib/forms/file-refs'
import type { ProjectSupplierImportItem } from '~/lib/supplier/import'
import { computed, shallowRef } from 'vue'
import ProjectSupplierImportWizard from '~/components/project-supplier/ProjectSupplierImportWizard.vue'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { toErrorMessage } from '~/lib/util/error'

const route = useRoute()
const router = useRouter()
const pid = computed(() => String(route.params.pid ?? ''))
const commandStore = useProjectSupplierCommandStore()
const { error, success } = useKitUI()
const busy = shallowRef(false)
const initialized = shallowRef(false)

const project = shallowRef<{ id: string, name: string } | null>(null)
const suppliers = shallowRef<Array<{ id: string, name: string, aliases: string[] }>>([])
const existingSupplierIds = shallowRef(new Set<string>())

async function initialize() {
  try {
    if (route.query.origin !== 'real')
      throw new Error('项目分供方导入只用于中央正式项目')
    const context = await commandStore.hydrate(pid.value)
    project.value = context.project
    suppliers.value = context.suppliers
    existingSupplierIds.value = new Set(context.existingSupplierIds)
  }
  catch (cause) {
    error('导入向导加载失败', toErrorMessage(cause))
  }
  finally {
    initialized.value = true
  }
}

async function confirmImport(items: readonly ProjectSupplierImportItem[]) {
  if (busy.value || !project.value)
    return
  busy.value = true
  try {
    const groups = new Map<string, {
      supplierId: string
      supplierName: string
      files: FileRefDraft[]
    }>()

    for (const item of items) {
      const key = item.supplierId || `new:${item.supplierName.trim().toLocaleLowerCase('zh-CN')}`
      const group = groups.get(key) ?? {
        supplierId: item.supplierId,
        supplierName: item.supplierName.trim(),
        files: [],
      }
      group.files.push(await fileRefDraftFromFile(item.file, { category: item.category }))
      groups.set(key, group)
    }

    const result = await commandStore.importFiles(pid.value, [...groups.values()])

    success(
      `已归档 ${result.fileCount} 个文件，关联 ${result.relationshipCount} 家分供方`,
      [
        result.createdSupplierCount ? `新建分供方 ${result.createdSupplierCount} 家` : '',
        result.reusedRelationshipCount ? `复用已有关系 ${result.reusedRelationshipCount} 条` : '',
      ].filter(Boolean).join('；') || '项目分供方关系已生成',
    )
    await router.push({
      path: `/project/${pid.value}`,
      query: { origin: 'real' },
    })
  }
  catch (cause) {
    error('项目分供方导入失败', toErrorMessage(cause))
  }
  finally {
    busy.value = false
  }
}

onMounted(initialize)
</script>

<template>
  <div class="min-w-0 space-y-4">
    <section class="panel p-4">
      <NuxtLink
        :to="{ path: `/project/${pid}`, query: { origin: 'real' } }"
        class="inline-flex items-center gap-1 text-11px font-700 text-brand"
      >
        <span class="i-lucide-arrow-left" aria-hidden="true" />
        返回项目详情
      </NuxtLink>
      <h1 class="mt-1 text-20px font-850 text-ink">
        项目分供方文件导入
      </h1>
      <p class="mt-1 text-12px text-ink-soft">
        {{ project?.name || '正在读取项目…' }} · 文件只归档到项目分供方关系，不回写分供方证照。
      </p>
    </section>

    <StatePanel
      v-if="!initialized"
      kind="loading"
      title="正在读取项目与分供方"
      description="准备本地分类所需资料。"
    />
    <StatePanel
      v-else-if="!project"
      kind="error"
      title="项目不存在或已删除"
      description="无法继续导入，请返回项目列表重新选择。"
      action-label="返回项目列表"
      @action="router.push('/project')"
    />
    <ProjectSupplierImportWizard
      v-else
      :project-name="project.name"
      :suppliers="suppliers"
      :existing-supplier-ids="existingSupplierIds"
      :busy="busy"
      @confirm="confirmImport"
    />
  </div>
</template>
