<script setup lang="ts">
import type { Project } from '~/stores/project'
import { computed } from 'vue'

const props = defineProps<{
  project: Project
}>()

const members = computed(() => [
  { role: '项目经理', name: props.project.manager, phone: props.project.managerPhone },
  { role: '执行经理', name: props.project.execManager, phone: '' },
  { role: '施工负责人', name: props.project.builder, phone: '' },
  { role: '现场负责人', name: props.project.siteLeader, phone: props.project.siteLeaderPhone },
].filter(member => member.name))
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="project-team-title">
    <div class="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
      <h3 id="project-team-title" class="m-0 text-13px font-700 text-ink">
        项目组成员
      </h3>
      <span class="chip ml-auto bg-panel text-ink-soft">{{ members.length }} 人</span>
    </div>
    <div v-if="members.length" class="min-w-0 overflow-x-auto" aria-label="项目组成员表格，可横向滚动">
      <table class="w-full min-w-60 border-collapse text-left text-11px">
        <thead class="bg-surface-2 text-ink-faint">
          <tr>
            <th class="px-3 py-2 font-600">
              角色
            </th>
            <th class="px-3 py-2 font-600">
              姓名
            </th>
            <th class="px-3 py-2 font-600">
              联系电话
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="member in members" :key="member.role" class="bg-panel">
            <td class="whitespace-nowrap px-3 py-2 text-ink-soft">
              {{ member.role }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 font-700 text-ink">
              {{ member.name }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 font-mono text-ink-soft">
              {{ member.phone || '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="m-0 px-3 py-5 text-center text-11px text-ink-faint">
      尚未登记项目组成员
    </p>
  </section>
</template>
