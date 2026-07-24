<script setup lang="ts">
// 穿透件·实体蓝链（specs §07 / CONTEXT.md「穿透」）：实体名一律蓝链跳详情，
// 查无路由/无 id/无文案自动退化，不做死链。type→route 映射唯一处在 lib/kit/entity-link.ts。
import type { EntityLinkType } from '~/lib/kit/entity-link'
import { computed } from 'vue'
import { resolveEntityLink } from '~/lib/kit/entity-link'

const props = defineProps<{
  type: EntityLinkType
  id?: string | null
  label?: string | null
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

const resolution = computed(() => resolveEntityLink({
  type: props.type,
  id: props.id,
  label: resolvedLabel.value,
}))
</script>

<template>
  <NuxtLink
    v-if="resolution.kind === 'link'"
    :to="resolution.to"
    class="text-brand font-600 hover:underline"
    :title="`打开 ${resolution.text}`"
    @click.stop
  >
    {{ resolution.text }}
  </NuxtLink>
  <span v-else-if="resolution.kind === 'text'">{{ resolution.text }}</span>
  <span v-else class="text-ink-faint">—</span>
</template>
