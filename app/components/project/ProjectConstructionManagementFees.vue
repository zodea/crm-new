<script setup lang="ts">
import type { ProjectConstructionManagementFeeRead } from '~/lib/project/construction-management-fee'
import ConstructionManagementFeeConfiguration from '~/components/contract/ConstructionManagementFeeConfiguration.vue'
import { validateConstructionContractProjectReturnTo } from '~/lib/construction-contract/return-context'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{ configuration: ProjectConstructionManagementFeeRead, returnTo?: string }>()
function contractTarget(row: ProjectConstructionManagementFeeRead['contracts'][number]) {
  const result = resolveNavigationTarget(row.navigation, { returnTo: props.returnTo })
  if (result.state !== 'resolved')
    return null
  const projectReturn = validateConstructionContractProjectReturnTo(props.returnTo, props.configuration.projectId, props.configuration.dataOrigin)
  return projectReturn ? `${result.to}&returnTo=${encodeURIComponent(projectReturn)}` : result.to
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden p-4" data-testid="project-construction-management-fees">
    <SectionHeader title="总合同管理费配置" />
    <p v-if="configuration.state !== 'complete'" role="status" class="mt-2 break-words text-13px text-ink-muted">
      {{ configuration.reason }}
    </p>
    <p v-else-if="!configuration.contracts.length" role="status" class="mt-2 text-13px text-ink-muted">
      当前项目暂无总合同配置记录。
    </p>
    <div v-else class="mt-3 grid min-w-0 gap-4">
      <article v-for="row in configuration.contracts" :key="row.id" class="min-w-0 rounded border border-line p-3">
        <div class="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-2">
          <h3 class="min-w-0 break-words text-14px font-semibold">
            {{ row.name || '未命名总合同' }} <span class="break-all text-12px font-normal text-ink-muted">{{ row.no }}</span>
          </h3>
          <NuxtLink v-if="contractTarget(row)" :to="contractTarget(row)!" class="text-13px text-primary underline-offset-2 hover:underline">
            查看总合同
          </NuxtLink>
        </div>
        <ConstructionManagementFeeConfiguration :configuration="row.configuration" />
      </article>
    </div>
  </section>
</template>
