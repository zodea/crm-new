<script setup lang="ts">
import type { QuantityHollowAction, QuantityHollowRead } from '~/lib/quantity/central-hollow-contract'
import { computed } from 'vue'

const props = defineProps<{ action: QuantityHollowAction, read: QuantityHollowRead }>()
const location = computed(() => {
  const action = props.action
  return action.kind === 'create-hollow-inspection'
    ? props.read.data.targets.find(option => JSON.stringify(option.target) === JSON.stringify(action.target))?.location.locationLabel
    : props.read.data.records.find(record => record.recordId === action.recordId)?.location.locationLabel
})
</script>

<template>
  <section class="panel grid min-w-0 gap-2 p-3 text-12px leading-5" aria-label="原空鼓提交内容">
    <p class="font-semibold">
      原提交：{{ action.kind === 'create-hollow-inspection' ? '记录空鼓检查' : action.kind === 'revise-hollow-inspection' ? '修订空鼓检查' : '登记整改销记' }}
    </p>
    <p class="break-words">
      {{ location || '原位置暂未读取，原提交引用仍保留' }}
    </p>
    <template v-if="action.kind === 'rectify-hollow-inspection'">
      <p>{{ action.rectifiedOn }} · 本次整改 {{ action.count }} 处</p><p class="whitespace-pre-wrap break-words">
        {{ action.note }}
      </p>
    </template>
    <template v-else>
      <p>{{ action.input.inspectedOn }} · 检查总数 {{ action.input.count }} 处</p><p class="whitespace-pre-wrap break-words">
        {{ action.input.note }}
      </p><p v-if="action.kind === 'revise-hollow-inspection'" class="whitespace-pre-wrap break-words">
        修订原因：{{ action.reason }}
      </p>
    </template>
    <p>请先核对这份原提交；当前页面的其他草稿仍保留。</p>
  </section>
</template>
