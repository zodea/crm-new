<script setup lang="ts">
// 穿透件·实体蓝链（specs §07 / CONTEXT.md「穿透」）：实体名一律蓝链跳详情，
// 查无路由/无 id/无文案自动退化，不做死链。唯一目标映射位于 lib/nav/target-registry.ts。
import type { EntityLinkType } from '~/lib/kit/entity-link'
import type { DataOriginDTO, NavigationIntentDTO } from '~/types/read-model'
import { computed } from 'vue'
import { resolveEntityLink } from '~/lib/kit/entity-link'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{
  type: EntityLinkType
  id?: string | null
  label?: string | null
  dataOrigin?: DataOriginDTO
  intent?: NavigationIntentDTO
  returnTo?: string
  returnContextId?: string
}>()

const emit = defineEmits<{
  navigate: []
}>()

const projectStore = useProjectStore()
const supplierStore = useSupplierStore()
const contractStore = useContractStore()

// label 缺省时按 type 从对应 store best-effort 解析（分供方取别名优先，照设计稿）
const resolvedLabel = computed(() => {
  if (props.label != null && props.label !== '')
    return props.label
  if (!props.id)
    return null
  switch (props.type) {
    case 'project':
      return projectStore.byId(props.id)?.name ?? null
    case 'supplier': {
      const supplier = supplierStore.byId(props.id)
      return supplier ? (supplier.aliases[0] || supplier.name) : null
    }
    case 'contract':
      return contractStore.byId(props.id)?.name ?? null
    default:
      return null
  }
})

const resolution = computed(() => props.intent
  ? resolveNavigationTarget(props.intent, {
      label: resolvedLabel.value,
      returnTo: props.returnTo,
      returnContextId: props.returnContextId,
    })
  : resolveEntityLink({
      type: props.type,
      id: props.id,
      label: resolvedLabel.value,
      dataOrigin: props.dataOrigin,
    }))
</script>

<template>
  <NuxtLink
    v-if="resolution.state === 'resolved'"
    :to="resolution.to"
    data-target-state="resolved"
    class="text-brand font-600 hover:underline"
    :title="`打开 ${resolution.label}`"
    @click.stop="emit('navigate')"
  >
    {{ resolution.label }}
  </NuxtLink>
  <span
    v-else-if="resolution.state !== 'empty'"
    :data-target-state="resolution.state"
    :title="resolution.message"
  >
    {{ resolution.label || resolution.message }}<template v-if="intent && resolution.label">（{{ resolution.message }}）</template>
  </span>
  <span v-else data-target-state="missing" class="text-ink-faint">—</span>
</template>
