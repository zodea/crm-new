<script setup lang="ts">
import type { ProjectInfoField } from '~/components/project/ProjectInfoSection.vue'
import type { Project } from '~/stores/project'
import { computed } from 'vue'
import ProjectInfoSection from '~/components/project/ProjectInfoSection.vue'

const props = defineProps<{
  project: Project
}>()

interface ProjectInfoGroup {
  key: string
  title: string
  fields: ProjectInfoField[]
}

function display(value: unknown): string {
  if (value == null || value === '')
    return '—'
  if (typeof value === 'number')
    return value.toLocaleString()
  return String(value)
}

function displayDate(value: string | undefined): string {
  return value?.slice(0, 19).replace('T', ' ') || '—'
}

const groups = computed<ProjectInfoGroup[]>(() => [
  {
    key: 'basic',
    title: '基础信息',
    fields: [
      { key: 'name', label: '项目名称', value: display(props.project.name), span: 2 },
      { key: 'code', label: '项目编号', value: display(props.project.code) },
      { key: 'developer', label: '客户(甲方)', value: display(props.project.developer) },
      { key: 'region', label: '工程地域', value: display(props.project.region) },
      { key: 'operationType', label: '经营类型', value: display(props.project.operationType) },
      { key: 'address', label: '工程详细地址', value: display(props.project.address), span: 3 },
      { key: 'startDate', label: '计划开工日期', value: display(props.project.startDate) },
      { key: 'plannedEnd', label: '计划竣工日期', value: display(props.project.plannedEnd) },
      { key: 'status', label: '业务流程阶段', value: display(props.project.status) },
    ],
  },
  {
    key: 'participants',
    title: '参建单位',
    fields: [
      { key: 'developer', label: '建设单位(甲方)', value: display(props.project.developer) },
      { key: 'supervisor', label: '监理单位', value: display(props.project.supervisor) },
      { key: 'designer', label: '设计单位', value: display(props.project.designer) },
      { key: 'contractor', label: '总包单位', value: display(props.project.contractor) },
      { key: 'manager', label: '项目经理', value: display(props.project.manager) },
      { key: 'managerPhone', label: '项目经理电话', value: display(props.project.managerPhone) },
    ],
  },
  {
    key: 'system',
    title: '系统信息',
    fields: [
      { key: 'createdAt', label: '创建时间', value: displayDate(props.project.createdAt) },
      { key: 'updatedAt', label: '更新时间', value: displayDate(props.project.updatedAt) },
      { key: 'note', label: '备注', value: display(props.project.note), span: 2 },
    ],
  },
])
</script>

<template>
  <div class="space-y-1">
    <ProjectInfoSection
      v-for="group in groups"
      :key="group.key"
      :title="group.title"
      :fields="group.fields"
    />
  </div>
</template>
