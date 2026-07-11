<script setup lang="ts">
import type { Project } from '~/stores/project'
import { PROJECT_STATUSES } from '~/lib/project/status'

// 项目新增/编辑共享表单（#59 17 字段两列红圈式分组表单）。
// 列表页与详情页共用同一份：v-model:open 控开关，project=null 为新增、传行为编辑。
// 底座 FormDialog（reka-ui Dialog，#86 宽限窗口已就位）。保存走 store，store 内部 load() 刷新共享
// 状态，两页计算属性自动联动，故无需 emit 回调。
const props = defineProps<{
  project?: Project | null
}>()

const open = defineModel<boolean>('open', { required: true })

const store = useProjectStore()
const { success, warning, error } = useKitUI()

const isEditing = computed(() => !!props.project?.id)
const draft = ref<Partial<Project>>({})

// 打开时按来源初始化草稿：编辑回填现值、新增给默认状态。
// 同时监听 project：详情/列表切换编辑对象（open 保持 true）也按新行重填。
watch([open, () => props.project], ([isOpen]) => {
  if (!isOpen)
    return
  draft.value = props.project ? { ...props.project } : { status: '筹备中' }
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
      { key: 'schedule', label: '工期进度' },
      { key: 'parties', label: '参建单位' },
      { key: 'staff', label: '管理人员' },
    ]"
    @save="handleSave"
    @cancel="open = false"
  >
    <!-- 基本信息 -->
    <section id="form-section-basic" class="mb-6">
      <h4 class="text-13px font-800 text-brand-deep mb-3">
        基本信息
      </h4>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div class="col-span-2">
          <label class="field-label">项目名称 *</label>
          <input v-model="draft.name" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">项目编号</label>
          <input v-model="draft.code" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">经营类型</label>
          <input v-model="draft.operationType" class="field-input w-full" placeholder="自营/联营">
        </div>
        <div class="col-span-2">
          <label class="field-label">项目地址</label>
          <input v-model="draft.address" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">建筑面积 (m²)</label>
          <input v-model.number="draft.area" type="number" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">合同金额 (万元)</label>
          <input v-model.number="draft.contractAmount" type="number" class="field-input w-full">
        </div>
      </div>
    </section>

    <!-- 工期进度 -->
    <section id="form-section-schedule" class="mb-6">
      <h4 class="text-13px font-800 text-brand-deep mb-3">
        工期进度
      </h4>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="field-label">开工日期</label>
          <input v-model="draft.startDate" type="date" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">计划竣工日期</label>
          <input v-model="draft.plannedEnd" type="date" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">实际竣工日期</label>
          <input v-model="draft.actualEnd" type="date" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">当前状态</label>
          <select v-model="draft.status" class="field-input w-full">
            <option v-for="s in PROJECT_STATUSES" :key="s" :value="s">
              {{ s }}
            </option>
          </select>
        </div>
      </div>
    </section>

    <!-- 参建单位 -->
    <section id="form-section-parties" class="mb-6">
      <h4 class="text-13px font-800 text-brand-deep mb-3">
        参建单位
      </h4>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="field-label">建设单位 (甲方)</label>
          <input v-model="draft.developer" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">监理单位</label>
          <input v-model="draft.supervisor" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">设计单位</label>
          <input v-model="draft.designer" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">总包单位</label>
          <input v-model="draft.contractor" class="field-input w-full">
        </div>
      </div>
    </section>

    <!-- 管理人员 -->
    <section id="form-section-staff" class="mb-6">
      <h4 class="text-13px font-800 text-brand-deep mb-3">
        管理人员
      </h4>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="field-label">项目经理</label>
          <input v-model="draft.manager" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">项目经理电话</label>
          <input v-model="draft.managerPhone" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">现场负责人</label>
          <input v-model="draft.siteLeader" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">现场负责人电话</label>
          <input v-model="draft.siteLeaderPhone" class="field-input w-full">
        </div>
      </div>
    </section>

    <!-- 备注 -->
    <div>
      <label class="field-label">备注</label>
      <textarea v-model="draft.note" class="field-input w-full" rows="3" />
    </div>
  </FormDialog>
</template>
