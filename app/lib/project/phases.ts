export type PhaseTaskStatus = 'pending' | 'uploaded' | 'confirmed'

export interface PhaseTaskData {
  id: string
  projectId: string
  phaseIndex: number
  taskIndex: number
  title: string
  description: string
  responsible: string
  status: PhaseTaskStatus
}

interface PhaseDefinition {
  name: string
  tasks: Omit<PhaseTaskData, 'id' | 'projectId' | 'phaseIndex' | 'taskIndex' | 'status'>[]
}

export const PROJECT_PHASES: readonly PhaseDefinition[] = [
  {
    name: '项目立项',
    tasks: [{ title: '项目立项审批表', description: '立项文件归档', responsible: '经营部' }],
  },
  {
    name: '施工准备',
    tasks: [
      { title: '施工组织设计方案', description: '资料员扫描上传并存档', responsible: '资料员' },
      { title: '开工报告及开工令', description: '资料员扫描上传并存档', responsible: '资料员' },
      { title: '材料定样板', description: '资料员照片上传，封样件存档', responsible: '资料员' },
      { title: '图纸会审记录', description: '设计师扫描上传并原件存档', responsible: '设计师' },
      { title: '施工蓝图', description: '设计师勾选不上传但原蓝图存档', responsible: '设计师' },
    ],
  },
  {
    name: '施工中',
    tasks: [
      { title: '排版图签确白图', description: '现场签认后上传', responsible: '项目经理' },
      { title: '隐蔽验收记录', description: '监理签认后存档', responsible: '质检员' },
      { title: '送检报告验收记录', description: '检测单位出具', responsible: '质检员' },
    ],
  },
  {
    name: '完工及验收',
    tasks: [{ title: '竣工验收报告/移交', description: '五方验收并移交', responsible: '项目经理' }],
  },
  {
    name: '交付',
    tasks: [
      { title: '工期一览表', description: '归档', responsible: '资料员' },
      { title: '工期延期说明工联单', description: '如有延期', responsible: '项目经理' },
      { title: '范围界面确认文件', description: '甲乙双方确认', responsible: '经营部' },
      { title: '无甩项确认工联单', description: '现场确认', responsible: '项目经理' },
      { title: '结算封板图', description: '结算用图归档', responsible: '预算员' },
    ],
  },
  { name: '保修', tasks: [] },
]
