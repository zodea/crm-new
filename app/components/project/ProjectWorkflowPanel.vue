<script setup lang="ts">
import type { Project } from '~/stores/project'

defineProps<{
  project: Project
}>()
</script>

<template>
  <section class="mb-3 min-w-0" aria-labelledby="project-workflow-title">
    <SectionHeader :mb="8">
      <span id="project-workflow-title">审批与业务流</span>
      <template #extra>
        <span class="text-10px text-ink-faint">只读事实</span>
      </template>
    </SectionHeader>
    <dl class="grid gap-[1px] overflow-hidden border border-line bg-line sm:grid-cols-3">
      <div class="min-w-0 bg-panel px-3 py-2.5">
        <dt class="text-10px text-ink-faint">
          审批状态
        </dt>
        <dd class="m-0 mt-1 break-words text-12px font-700 text-ink">
          {{ project.approvalStatus || '未登记审批状态' }}
        </dd>
      </div>
      <div class="min-w-0 bg-panel px-3 py-2.5">
        <dt class="text-10px text-ink-faint">
          业务流程阶段
        </dt>
        <dd class="m-0 mt-1 break-words text-12px font-700 text-brand-deep">
          {{ project.status || '未登记业务阶段' }}
        </dd>
      </div>
      <div class="min-w-0 bg-panel px-3 py-2.5">
        <dt class="text-10px text-ink-faint">
          项目风险级别
        </dt>
        <dd class="m-0 mt-1 break-words text-12px font-700 text-ink">
          {{ project.riskLevel || '未登记风险级别' }}
        </dd>
      </div>
    </dl>
  </section>
</template>
