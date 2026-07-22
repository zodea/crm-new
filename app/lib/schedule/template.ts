export interface ScheduleTaskTemplate {
  key: string
  name: string
  durationDays: number
  trade: string
  color: string
  stageCode?: string
  itemCodes: string[]
}

/**
 * 现场进度计划表的 22 道精装修工序标准库。
 * stageCode 是跨排程/工程量域的稳定接缝；没有 stageCode 的工序只能人工填报。
 */
export const SCHEDULE_TASK_TEMPLATES: readonly ScheduleTaskTemplate[] = [
  { key: 'setting-out', name: '放线及新建墙体', durationDays: 30, trade: '泥水工', color: '#8b5cf6', itemCodes: [] },
  { key: 'plumbing', name: '给排水安装', durationDays: 30, trade: '水暖工', color: '#f59e0b', itemCodes: [] },
  { key: 'waterproof', name: '卫生间回填及防水', durationDays: 30, trade: '防水工', color: '#06b6d4', stageCode: 'WP-02', itemCodes: ['WP-WALL', 'WP-FLOOR'] },
  { key: 'wiring', name: '电线敷设', durationDays: 30, trade: '水电工', color: '#f59e0b', itemCodes: [] },
  { key: 'air-conditioning', name: '空调安装（天花机）', durationDays: 18, trade: '水电工', color: '#f59e0b', itemCodes: [] },
  { key: 'ceiling', name: '天花龙骨及封板（含楼梯）', durationDays: 30, trade: '木工', color: '#d97706', stageCode: 'CEILING', itemCodes: ['DEC-CEILING'] },
  { key: 'leveling', name: '水泥沙找平', durationDays: 18, trade: '泥水工', color: '#6366f1', stageCode: 'LEVELING', itemCodes: ['DEC-LEVELING'] },
  { key: 'gypsum-line', name: '石膏线安装', durationDays: 18, trade: '油漆工', color: '#10b981', stageCode: 'GYPSUM-LINE', itemCodes: ['DEC-GYPSUM-LINE'] },
  { key: 'wall-tile', name: '墙砖粘贴', durationDays: 50, trade: '泥水工', color: '#6366f1', stageCode: 'MASON-WALL', itemCodes: ['DEC-WALL-TILE'] },
  { key: 'floor-tile', name: '地砖铺贴', durationDays: 30, trade: '泥水工', color: '#4f46e5', stageCode: 'MASON-FLOOR', itemCodes: ['DEC-FLOOR-TILE'] },
  { key: 'putty-1', name: '天花及墙身一遍腻子', durationDays: 20, trade: '油漆工', color: '#10b981', stageCode: 'PUTTY-01', itemCodes: ['DEC-PUTTY'] },
  { key: 'putty-2', name: '天花及墙身二遍腻子', durationDays: 20, trade: '油漆工', color: '#10b981', stageCode: 'PUTTY-02', itemCodes: ['DEC-PUTTY'] },
  { key: 'doors', name: '户内门安装', durationDays: 18, trade: '木工', color: '#d97706', itemCodes: [] },
  { key: 'wood-floor', name: '木地板安装', durationDays: 25, trade: '木工', color: '#d97706', stageCode: 'WOOD-FLOOR', itemCodes: ['DEC-WOOD-FLOOR'] },
  { key: 'latex-paint', name: '天花及墙身乳胶漆', durationDays: 30, trade: '油漆工', color: '#059669', stageCode: 'LATEX-PAINT', itemCodes: ['DEC-LATEX-PAINT'] },
  { key: 'aluminum-ceiling', name: '铝扣板安装', durationDays: 20, trade: '干挂工', color: '#0ea5e9', stageCode: 'ALUMINUM-CEILING', itemCodes: ['DEC-ALUMINUM-CEILING'] },
  { key: 'kitchen-cabinet', name: '橱柜安装', durationDays: 20, trade: '木工', color: '#d97706', itemCodes: [] },
  { key: 'fixed-cabinet', name: '固装柜子安装', durationDays: 25, trade: '木工', color: '#d97706', itemCodes: [] },
  { key: 'finishing-paint', name: '收口石膏线及油漆', durationDays: 10, trade: '油漆工', color: '#10b981', itemCodes: [] },
  { key: 'switch-light', name: '开关插座及灯具安装', durationDays: 20, trade: '水电工', color: '#f59e0b', itemCodes: [] },
  { key: 'sanitary-hardware', name: '五金洁具安装', durationDays: 20, trade: '水电工', color: '#f59e0b', itemCodes: [] },
  { key: 'cleaning', name: '开荒保洁', durationDays: 8, trade: '杂工', color: '#9ca3af', itemCodes: [] },
]

export const SCHEDULE_TEMPLATE_BY_KEY = new Map(
  SCHEDULE_TASK_TEMPLATES.map(template => [template.key, template]),
)
