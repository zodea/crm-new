<script setup lang="ts">
import type { Project } from '~/stores/project'

const store = useProjectStore()
const toast = useToast()

const searchText = ref('')
const showForm = ref(false)
const editingProject = ref<Partial<Project>>({})
const isEditing = ref(false)

const STATUS_OPTIONS = ['筹备中', '施工中', '停工', '已竣工', '已结算']
const STATUS_COLOR: Record<string, string> = {
  '筹备中': 'cell--status-warn',
  '施工中': 'text-brand font-600',
  '停工': 'text-ink-faint font-600',
  '已竣工': 'cell--status-ok',
  '已结算': 'cell--status-ok',
}

const filtered = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return store.list
  return store.list.filter(p =>
    p.name.toLowerCase().includes(q)
    || p.address.toLowerCase().includes(q)
    || p.manager.toLowerCase().includes(q),
  )
})

function openCreate() {
  editingProject.value = { status: '筹备中' }
  isEditing.value = false
  showForm.value = true
}

function openEdit(row: Project) {
  editingProject.value = { ...row }
  isEditing.value = true
  showForm.value = true
}

async function handleSave() {
  const data = editingProject.value
  if (!data.name?.trim()) {
    toast.warning('请填写项目名称')
    return
  }
  if (isEditing.value && data.id) {
    await store.update(data.id, data)
    toast.success('项目已更新')
  }
  else {
    await store.add(data)
    toast.success('项目已创建')
  }
  showForm.value = false
}

async function handleDelete(row: Project) {
  await store.remove(row.id)
  toast.success('已删除')
}

onMounted(() => store.load())
</script>

<template>
  <div>
    <DataListToolbar
      title="施工项目"
      :count="filtered.length"
      @search="v => searchText = v"
      @create="openCreate"
    />

    <div class="border border-line">
      <vxe-table
        :data="filtered"
        :loading="store.loading"
        border
        show-overflow
        height="auto"
        :row-config="{ isHover: true }"
        :column-config="{ resizable: true }"
      >
        <vxe-column type="seq" title="#" width="52" fixed="left" />
        <vxe-column field="name" title="项目名称" min-width="160" fixed="left">
          <template #default="{ row }">
            <NuxtLink :to="`/project/${row.id}`" class="cell--link">
              {{ row.name }}
            </NuxtLink>
          </template>
        </vxe-column>
        <vxe-column field="status" title="状态" width="90">
          <template #default="{ row }">
            <span :class="STATUS_COLOR[row.status] || ''">{{ row.status }}</span>
          </template>
        </vxe-column>
        <vxe-column field="address" title="项目地址" min-width="130" />
        <vxe-column field="startDate" title="开工日期" width="110" />
        <vxe-column field="developer" title="建设单位" min-width="120" />
        <vxe-column field="manager" title="项目经理" width="90" />
        <vxe-column title="操作" width="130" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center gap-1">
              <NuxtLink :to="`/project/${row.id}`" class="icon-btn" title="详情">
                <span class="i-lucide-file-text text-14px" />
              </NuxtLink>
              <button class="icon-btn" title="编辑" @click="openEdit(row)">
                <span class="i-lucide-square-pen text-14px" />
              </button>
              <button class="icon-btn-danger" title="删除" @click="handleDelete(row)">
                <span class="i-lucide-trash-2 text-14px" />
              </button>
            </div>
          </template>
        </vxe-column>
      </vxe-table>
    </div>

    <!-- 新增/编辑弹窗 -->
    <FormDialog
      :open="showForm"
      :title="isEditing ? '编辑项目' : '新增项目'"
      :sections="[
        { key: 'basic', label: '基本信息' },
        { key: 'schedule', label: '工期进度' },
        { key: 'parties', label: '参建单位' },
        { key: 'staff', label: '管理人员' },
      ]"
      @save="handleSave"
      @cancel="showForm = false"
    >
      <!-- 基本信息 -->
      <section id="form-section-basic" class="mb-6">
        <h4 class="text-13px font-800 text-brand-deep mb-3">基本信息</h4>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div class="col-span-2">
            <label class="field-label">项目名称 *</label>
            <input v-model="editingProject.name" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">项目编号</label>
            <input v-model="editingProject.code" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">经营类型</label>
            <input v-model="editingProject.operationType" class="field-input w-full" placeholder="自营/联营">
          </div>
          <div class="col-span-2">
            <label class="field-label">项目地址</label>
            <input v-model="editingProject.address" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">建筑面积 (m²)</label>
            <input v-model.number="editingProject.area" type="number" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">合同金额 (万元)</label>
            <input v-model.number="editingProject.contractAmount" type="number" class="field-input w-full">
          </div>
        </div>
      </section>

      <!-- 工期进度 -->
      <section id="form-section-schedule" class="mb-6">
        <h4 class="text-13px font-800 text-brand-deep mb-3">工期进度</h4>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="field-label">开工日期</label>
            <input v-model="editingProject.startDate" type="date" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">计划竣工日期</label>
            <input v-model="editingProject.plannedEnd" type="date" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">实际竣工日期</label>
            <input v-model="editingProject.actualEnd" type="date" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">当前状态</label>
            <select v-model="editingProject.status" class="field-input w-full">
              <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
        </div>
      </section>

      <!-- 参建单位 -->
      <section id="form-section-parties" class="mb-6">
        <h4 class="text-13px font-800 text-brand-deep mb-3">参建单位</h4>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="field-label">建设单位 (甲方)</label>
            <input v-model="editingProject.developer" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">监理单位</label>
            <input v-model="editingProject.supervisor" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">设计单位</label>
            <input v-model="editingProject.designer" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">总包单位</label>
            <input v-model="editingProject.contractor" class="field-input w-full">
          </div>
        </div>
      </section>

      <!-- 管理人员 -->
      <section id="form-section-staff" class="mb-6">
        <h4 class="text-13px font-800 text-brand-deep mb-3">管理人员</h4>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="field-label">项目经理</label>
            <input v-model="editingProject.manager" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">项目经理电话</label>
            <input v-model="editingProject.managerPhone" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">现场负责人</label>
            <input v-model="editingProject.siteLeader" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">现场负责人电话</label>
            <input v-model="editingProject.siteLeaderPhone" class="field-input w-full">
          </div>
        </div>
      </section>

      <!-- 备注 -->
      <div>
        <label class="field-label">备注</label>
        <textarea v-model="editingProject.note" class="field-input w-full" rows="3" />
      </div>
    </FormDialog>
  </div>
</template>
