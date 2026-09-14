<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const native = isDesktopRuntime()
</script>

<template>
  <p v-if="native" class="panel p-4 text-13px">
    请在桌面原签工台账登记本机记录。
  </p><CentralDayworkFormPage v-else />
</template>
