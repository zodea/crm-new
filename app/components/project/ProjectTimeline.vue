<script setup lang="ts">
interface PhaseTask {
  title: string
  description: string
  responsible: string
  status: 'pending' | 'uploaded' | 'confirmed'
}

interface Phase {
  name: string
  tasks: PhaseTask[]
}

const phases: Phase[] = [
  {
    name: '项目立项',
    tasks: [
      { title: '项目立项审批文件', description: '项目经理提交并存档', responsible: '项目经理', status: 'confirmed' },
    ],
  },
  {
    name: '施工准备',
    tasks: [
      { title: '施工组织设计方案', description: '资料员扫描上传并存档', responsible: '资料员', status: 'uploaded' },
      { title: '开工报告及开工令', description: '资料员扫描上传并存档', responsible: '资料员', status: 'uploaded' },
      { title: '材料定样板', description: '资料员照片上传，封样件存档', responsible: '资料员', status: 'pending' },
      { title: '图纸会审记录', description: '设计师扫描上传并原件存档', responsible: '设计师', status: 'pending' },
      { title: '施工蓝图', description: '设计师勾选不上传但原蓝图存档', responsible: '设计师', status: 'pending' },
    ],
  },
  {
    name: '施工中',
    tasks: [
      { title: '排版图签确白图', description: '设计师上传', responsible: '设计师', status: 'pending' },
      { title: '隐蔽验收记录', description: '资料员扫描上传', responsible: '资料员', status: 'pending' },
      { title: '送检报告验收记录', description: '资料员扫描上传', responsible: '资料员', status: 'pending' },
    ],
  },
  {
    name: '完工及验收',
    tasks: [
      { title: '竣工验收报告/移交', description: '项目经理提交', responsible: '项目经理', status: 'pending' },
    ],
  },
  {
    name: '交付',
    tasks: [
      { title: '工期一览表', description: '资料员编制', responsible: '资料员', status: 'pending' },
      { title: '工期延期说明工联单', description: '项目经理起草', responsible: '项目经理', status: 'pending' },
      { title: '范围界面确认文件', description: '甲方签章', responsible: '项目经理', status: 'pending' },
      { title: '无甩项确认工联单', description: '甲方签章', responsible: '项目经理', status: 'pending' },
      { title: '结算封板图', description: '设计师出图', responsible: '设计师', status: 'pending' },
    ],
  },
  {
    name: '保修',
    tasks: [],
  },
]

const expandedPhases = ref<Set<number>>(new Set([1]))

function togglePhase(idx: number) {
  if (expandedPhases.value.has(idx))
    expandedPhases.value.delete(idx)
  else
    expandedPhases.value.add(idx)
}

function phaseStatus(phase: Phase): 'done' | 'active' | 'pending' {
  if (phase.tasks.length === 0)
    return 'pending'
  const allDone = phase.tasks.every(t => t.status === 'confirmed' || t.status === 'uploaded')
  if (allDone)
    return 'done'
  const hasAny = phase.tasks.some(t => t.status === 'confirmed' || t.status === 'uploaded')
  if (hasAny)
    return 'active'
  return 'pending'
}

function phaseProgress(phase: Phase): string {
  if (phase.tasks.length === 0)
    return ''
  const done = phase.tasks.filter(t => t.status !== 'pending').length
  return `${done}/${phase.tasks.length}`
}

// 预派生每个阶段的状态/进度，避免模板对同一 phase 反复调 phaseStatus/phaseProgress
const phaseViews = computed(() =>
  phases.map((phase, idx) => ({
    phase,
    idx,
    status: phaseStatus(phase),
    progress: phaseProgress(phase),
  })),
)

const TASK_STATUS: Record<string, { label: string, cls: string }> = {
  pending: { label: '待上传', cls: 'text-ink-faint' },
  uploaded: { label: '已上传', cls: 'text-brand font-600' },
  confirmed: { label: '已确认', cls: 'text-ok font-600' },
}
</script>

<template>
  <div class="border border-line bg-panel p-4 mb-4">
    <!-- 时间线节点 -->
    <div class="flex items-center gap-1 mb-4 overflow-x-auto">
      <template v-for="pv in phaseViews" :key="pv.idx">
        <button
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-btn)] text-13px font-600 whitespace-nowrap cursor-pointer transition-colors"
          :class="{
            'bg-ok/10 text-ok': pv.status === 'done',
            'bg-brand-soft text-brand-deep': pv.status === 'active',
            'bg-surface-3 text-ink-faint': pv.status === 'pending',
          }"
          @click="togglePhase(pv.idx)"
        >
          <span v-if="pv.status === 'done'" class="i-lucide-circle-check text-13px" />
          <span v-else-if="pv.status === 'active'" class="i-lucide-circle-dot text-13px" />
          <span v-else class="i-lucide-circle text-13px" />
          {{ pv.phase.name }}
          <span v-if="pv.progress" class="text-10px opacity-70">({{ pv.progress }})</span>
        </button>
        <span v-if="pv.idx < phases.length - 1" class="text-line">→</span>
      </template>
    </div>

    <!-- 展开的阶段任务 -->
    <template v-for="(phase, idx) in phases" :key="`tasks-${idx}`">
      <div v-if="expandedPhases.has(idx) && phase.tasks.length > 0" class="mb-3">
        <h4 class="text-12px font-700 text-ink mb-2">
          ▾ {{ phase.name }}阶段
        </h4>
        <div class="space-y-1.5">
          <div
            v-for="(task, ti) in phase.tasks"
            :key="ti"
            class="flex items-center gap-3 px-3 py-2 border border-line"
          >
            <span class="text-11px text-ink-faint font-mono w-5">{{ ti + 1 }}.</span>
            <div class="flex-1 min-w-0">
              <span class="text-12px font-600">{{ task.title }}</span>
              <span class="text-11px text-ink-faint ml-2">{{ task.description }}</span>
            </div>
            <span class="text-11px" :class="TASK_STATUS[task.status]?.cls || ''">
              {{ TASK_STATUS[task.status]?.label || task.status }}
            </span>
            <button class="icon-btn" title="上传">
              <span class="i-lucide-upload text-13px" />
            </button>
            <button class="icon-btn" title="查看">
              <span class="i-lucide-eye text-13px" />
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
