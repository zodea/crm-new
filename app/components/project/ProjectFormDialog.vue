<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { Project } from '~/stores/project'
import { select } from '~/lib/db/connection'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import { PROJECT_STATUSES } from '~/lib/project/status'

// 项目新增/编辑共享表单（#59 红圈式分组两列表单）。
// 字段集 = 设计稿 ProjectScreen.jsx 编辑表单 17 字段 ∪ ProjectDetailScreen.jsx 详情编辑的
// 承包单位（contractor）= 18 字段：两处原型（列表 17 / 详情 15，互为对称差）合并成一份
// 权威表单，避免同一实体两套会漂移的编辑表单（AGENTS.md 单一权威源）。列表页与详情页共用：
// v-model:open 控开关，project=null 为新增、传行为编辑；保存走 store，store 内 load() 刷新
// 共享状态，两页计算属性自动联动（反馈轮9 双页联动），故无需 emit 回调。
const props = defineProps<{
  project?: Project | null
}>()

const open = defineModel<boolean>('open', { required: true })

const store = useProjectStore()
const { success, warning, error } = useKitUI()

const isEditing = computed(() => !!props.project?.id)
const draft = ref<Partial<Project>>({})

const OPERATION_TYPES = ['自营', '联营', '挂靠'] as const
const RISK_LEVELS = ['低', '中', '高'] as const

async function fetchCustomers(keyword: string): Promise<LookupOption[]> {
  const pattern = `%${keyword.trim()}%`
  const rows = await select<{ id: string, name: string }>(
    selectVisibleSql(
      'customers',
      `AND (name LIKE ? OR aliases LIKE ?) ORDER BY name LIMIT 50`,
    ),
    [pattern, pattern],
  )
  return rows.map(customer => ({
    id: customer.id,
    label: customer.name,
  }))
}

// 打开时按来源初始化草稿：编辑回填现值（整行展开，未在表单里的列如监理/设计单位随之保留，
// 不被 store 写路径抹空）、新增给设计稿默认值。同时监听 project：详情/列表切换编辑对象
// （open 保持 true）也按新行重填。
watch([open, () => props.project], ([isOpen]) => {
  if (!isOpen)
    return
  draft.value = props.project
    ? { ...props.project }
    : { status: '筹备中', operationType: '自营', riskLevel: '低' }
})

async function handleSave() {
  const data = draft.value
  if (!data.name?.trim()) {
    warning('请填写项目名称')
    return
  }
  if (isEditing.value && data.id) {
    const logId = await store.update(data.id, data)
    if (!logId) {
      error('项目不存在或已删除，保存失败')
      return
    }
    success('项目已更新')
  }
  else {
    await store.add(data)
    success('项目已创建')
  }
  open.value = false
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="isEditing ? '编辑项目' : '新增项目'"
    :sections="[
      { key: 'basic', label: '基本信息' },
      { key: 'team', label: '参建与团队' },
      { key: 'schedule', label: '工期与风险' },
      { key: 'remark', label: '概况备注' },
    ]"
    @save="handleSave"
    @cancel="open = false"
  >
    <!-- 基本信息 -->
    <section id="form-section-basic" class="mb-6">
      <h4 class="field-group-title">
        基本信息
      </h4>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div class="col-span-2">
          <label class="field-label">项目名称 *</label>
          <input v-model="draft.name" class="field-input w-full" placeholder="如：合和新城·3号楼">
        </div>
        <div class="col-span-2">
          <label class="field-label">项目合同名称</label>
          <input v-model="draft.contractName" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">客户（甲方）</label>
          <LookupSelect
            v-model="draft.customerId"
            :fetch="fetchCustomers"
            recent-key="project-primary-customers"
            placeholder="检索客户"
          />
        </div>
        <div>
          <label class="field-label">客户2（选填）</label>
          <LookupSelect
            v-model="draft.secondaryCustomerId"
            :fetch="fetchCustomers"
            recent-key="project-secondary-customers"
            placeholder="检索次客户"
          />
        </div>
        <div>
          <label class="field-label">经营类型</label>
          <select v-model="draft.operationType" class="field-input w-full">
            <option v-for="t in OPERATION_TYPES" :key="t" :value="t">
              {{ t }}
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">业务流程阶段</label>
          <select v-model="draft.status" class="field-input w-full">
            <option v-for="s in PROJECT_STATUSES" :key="s" :value="s">
              {{ s }}
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">工程地域</label>
          <input v-model="draft.region" class="field-input w-full" placeholder="广州·白云">
        </div>
        <div class="col-span-2">
          <label class="field-label">工程详细地址</label>
          <input v-model="draft.address" class="field-input w-full">
        </div>
      </div>
    </section>

    <!-- 参建与团队 -->
    <section id="form-section-team" class="mb-6">
      <h4 class="field-group-title">
        参建与团队
      </h4>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div class="col-span-2">
          <label class="field-label">承包单位</label>
          <input v-model="draft.contractor" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">项目经理</label>
          <input v-model="draft.manager" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">执行经理</label>
          <input v-model="draft.execManager" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">施工员</label>
          <input v-model="draft.builder" class="field-input w-full">
        </div>
      </div>
    </section>

    <!-- 工期与风险 -->
    <section id="form-section-schedule" class="mb-6">
      <h4 class="field-group-title">
        工期与风险
      </h4>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="field-label">计划开工日期</label>
          <input v-model="draft.startDate" type="date" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">计划竣工日期</label>
          <input v-model="draft.plannedEnd" type="date" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">计划工期（天）</label>
          <input v-model.number="draft.plannedDuration" type="number" class="field-input w-full" placeholder="360">
        </div>
        <div>
          <label class="field-label">项目风险级别</label>
          <select v-model="draft.riskLevel" class="field-input w-full">
            <option v-for="r in RISK_LEVELS" :key="r" :value="r">
              {{ r }}
            </option>
          </select>
        </div>
      </div>
    </section>

    <!-- 概况备注 -->
    <section id="form-section-remark">
      <h4 class="field-group-title">
        概况备注
      </h4>
      <div class="grid grid-cols-1 gap-y-3">
        <div>
          <label class="field-label">工程概况</label>
          <textarea v-model="draft.overview" class="field-input w-full" rows="3" placeholder="楼栋数 / 层数 / 建筑面积 / 装修标准…" />
        </div>
        <div>
          <label class="field-label">备注</label>
          <textarea v-model="draft.note" class="field-input w-full" rows="2" />
        </div>
      </div>
    </section>
  </FormDialog>
</template>
