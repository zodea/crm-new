<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const native = isDesktopRuntime()
</script>

<template>
  <main v-if="native" data-payroll-native-sources class="panel grid gap-3 p-5">
    <h1 class="text-20px font-800">
      工资来源
    </h1>
    <p class="text-13px leading-6 text-ink-soft">
      此整页来源查询当前面向浏览器已接管资料。桌面本地资料请从原考勤或签工工作台查看。
    </p>
    <div class="flex flex-wrap gap-2">
      <NuxtLink to="/subcontract/attendance" class="btn-secondary">
        打开本地考勤
      </NuxtLink><NuxtLink to="/subcontract/daywork" class="btn-secondary">
        打开本地签工
      </NuxtLink>
    </div>
  </main>
  <CentralPayrollSourcesScreen v-else />
</template>
