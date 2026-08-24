<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

// 材料采购合同列表（支出侧，乙供材管理组，#90）——底部三段汇总为红圈口径。
const desktop = isDesktopRuntime()
</script>

<template>
  <ContractListScreen v-if="desktop" kind="材采" />
  <MaterialContractListScreen v-else />
</template>
