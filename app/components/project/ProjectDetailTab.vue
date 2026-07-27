<script setup lang="ts">
import type { Project } from '~/stores/project'

defineProps<{
  project: Project
}>()

function display(val: unknown): string {
  if (val == null || val === '')
    return '—'
  if (typeof val === 'number')
    return val.toLocaleString()
  return String(val)
}
</script>

<template>
  <div>
    <h4 class="section-heading mb-2 text-13px font-700 text-ink">
      <span aria-hidden="true" class="h-3.5 w-[3px] flex-none rounded-[1px] bg-brand" />
      基础信息
    </h4>
    <div class="form-grid mb-5">
      <div class="form-cell" data-form-span="2">
        <span class="text-9px text-ink-faint">项目名称</span>
        <span class="text-12px">{{ project.name }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">项目编号</span>
        <span class="text-12px">{{ display(project.code) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">客户(甲方)</span>
        <span class="text-12px">{{ display(project.developer) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">工程地域</span>
        <span class="text-12px">{{ display(project.region) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">经营类型</span>
        <span class="text-12px">{{ display(project.operationType) }}</span>
      </div>
      <div class="form-cell" data-form-span="3">
        <span class="text-9px text-ink-faint">工程详细地址</span>
        <span class="text-12px">{{ display(project.address) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">计划开工日期</span>
        <span class="text-12px">{{ display(project.startDate) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">计划竣工日期</span>
        <span class="text-12px">{{ display(project.plannedEnd) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">业务流程阶段</span>
        <span class="text-12px">{{ display(project.status) }}</span>
      </div>
    </div>

    <h4 class="section-heading mb-2 text-13px font-700 text-ink">
      <span aria-hidden="true" class="h-3.5 w-[3px] flex-none rounded-[1px] bg-brand" />
      参建单位
    </h4>
    <div class="form-grid mb-5">
      <div class="form-cell">
        <span class="text-9px text-ink-faint">建设单位(甲方)</span>
        <span class="text-12px">{{ display(project.developer) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">监理单位</span>
        <span class="text-12px">{{ display(project.supervisor) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">设计单位</span>
        <span class="text-12px">{{ display(project.designer) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">总包单位</span>
        <span class="text-12px">{{ display(project.contractor) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">项目经理</span>
        <span class="text-12px">{{ display(project.manager) }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">项目经理电话</span>
        <span class="text-12px">{{ display(project.managerPhone) }}</span>
      </div>
    </div>

    <h4 class="section-heading mb-2 text-13px font-700 text-ink">
      <span aria-hidden="true" class="h-3.5 w-[3px] flex-none rounded-[1px] bg-brand" />
      系统信息
    </h4>
    <div class="form-grid">
      <div class="form-cell">
        <span class="text-9px text-ink-faint">创建时间</span>
        <span class="text-12px">{{ project.createdAt?.slice(0, 19).replace('T', ' ') || '—' }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">更新时间</span>
        <span class="text-12px">{{ project.updatedAt?.slice(0, 19).replace('T', ' ') || '—' }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">备注</span>
        <span class="text-12px">{{ display(project.note) }}</span>
      </div>
    </div>
  </div>
</template>
