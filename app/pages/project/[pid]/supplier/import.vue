<script setup lang="ts">
const route = useRoute()
const pid = computed(() => route.params.pid as string)
const projStore = useProjectStore()
const supStore = useSupplierStore()
const psStore = useProjectSupplierStore()
const toast = useToast()

const project = computed(() => projStore.byId(pid.value))
const step = shallowRef(1)

const selectedSupplierIds = ref<Set<string>>(new Set())

const availableSuppliers = computed(() =>
  supStore.list.filter(s => !psStore.byProjectAndSupplier(pid.value, s.id)),
)

function toggleSupplier(id: string) {
  if (selectedSupplierIds.value.has(id))
    selectedSupplierIds.value.delete(id)
  else selectedSupplierIds.value.add(id)
}

async function doImport() {
  for (const sid of selectedSupplierIds.value) {
    await psStore.add(pid.value, sid)
  }
  toast.success(`已关联 ${selectedSupplierIds.value.size} 家分供方`)
  step.value = 3
}

onMounted(async () => {
  await Promise.all([projStore.load(), supStore.load(), psStore.load()])
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-4">
      <NuxtLink :to="`/project/${pid}`" class="icon-btn" title="返回项目">
        <span class="i-lucide-arrow-left text-14px" />
      </NuxtLink>
      <h2 class="text-14px font-800 text-ink">
        项目分供方导入 — {{ project?.name || '...' }}
      </h2>
    </div>

    <!-- 步骤指示 -->
    <div class="flex items-center gap-2 mb-4 text-12px">
      <span :class="step >= 1 ? 'text-brand font-700' : 'text-ink-faint'">① 选择分供方</span>
      <span class="text-line">→</span>
      <span :class="step >= 2 ? 'text-brand font-700' : 'text-ink-faint'">② 确认关联</span>
      <span class="text-line">→</span>
      <span :class="step >= 3 ? 'text-ok font-700' : 'text-ink-faint'">③ 完成</span>
    </div>

    <!-- Step 1: 选择 -->
    <div v-if="step === 1" class="border border-line bg-panel p-4">
      <p class="text-13px text-ink-soft mb-3">
        选择要关联到「{{ project?.name }}」的分供方（已关联的不会重复显示）
      </p>
      <div class="space-y-1.5 mb-4 max-h-[400px] overflow-y-auto">
        <label
          v-for="s in availableSuppliers"
          :key="s.id"
          class="flex items-center gap-2.5 px-3 py-2 border border-line cursor-pointer hover:bg-surface-3"
          :class="selectedSupplierIds.has(s.id) ? 'bg-brand-soft/30 border-brand' : ''"
        >
          <input
            type="checkbox"
            :checked="selectedSupplierIds.has(s.id)"
            class="accent-brand"
            @change="toggleSupplier(s.id)"
          >
          <div>
            <div class="text-13px font-600">{{ s.name }}</div>
            <div class="text-11px text-ink-soft">{{ s.supplierCategory }} · {{ s.contact || '—' }}</div>
          </div>
        </label>
      </div>
      <div v-if="!availableSuppliers.length" class="py-4 text-center text-ink-faint text-13px">
        所有分供方已关联到此项目
      </div>
      <div class="flex justify-end gap-2">
        <button
          class="btn-primary"
          :disabled="selectedSupplierIds.size === 0"
          @click="step = 2"
        >
          下一步 ({{ selectedSupplierIds.size }} 家)
        </button>
      </div>
    </div>

    <!-- Step 2: 确认 -->
    <div v-else-if="step === 2" class="border border-line bg-panel p-4">
      <p class="text-13px text-ink-soft mb-3">
        确认将以下 {{ selectedSupplierIds.size }} 家分供方关联到「{{ project?.name }}」？
      </p>
      <div class="space-y-1 mb-4">
        <div
          v-for="sid in selectedSupplierIds"
          :key="sid"
          class="px-3 py-2 border border-line text-13px"
        >
          {{ supStore.byId(sid)?.name || sid }}
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <button class="btn-secondary" @click="step = 1">
          上一步
        </button>
        <button class="btn-accent" @click="doImport">
          确认关联
        </button>
      </div>
    </div>

    <!-- Step 3: 完成 -->
    <div v-else class="border border-line bg-panel p-8 text-center">
      <span class="i-lucide-circle-check text-32px text-ok mb-2 block mx-auto" />
      <p class="text-14px font-700 text-ok mb-2">
        导入完成
      </p>
      <NuxtLink :to="`/project/${pid}`" class="btn-secondary">
        返回项目详情
      </NuxtLink>
    </div>
  </div>
</template>
