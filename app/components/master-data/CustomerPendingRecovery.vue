<script setup lang="ts">
import { onActivated, onMounted, shallowRef } from 'vue'
import { toErrorMessage } from '~/lib/util/error'
import { useCustomerCommandStore } from '~/stores/customer-command'

const store = useCustomerCommandStore()
const paths = shallowRef<string[]>([])
const problem = shallowRef('')
async function load() {
  try {
    paths.value = await store.pendingForms()
    problem.value = ''
  }
  catch (cause) { problem.value = toErrorMessage(cause) }
}
onMounted(() => void load())
onActivated(() => void load())
</script>

<template>
  <section v-if="paths.length || problem" class="panel grid gap-2 border-warn/40 p-4" aria-label="核对上次客户提交">
    <h2 class="text-13px font-700">
      上次客户提交需要核对
    </h2>
    <p class="text-12px text-ink-muted">
      刷新前的保存结果还未确认。先核对原提交，再填写新的客户资料。
    </p>
    <p v-if="problem" role="alert" class="text-12px text-danger">
      {{ problem }}
    </p>
    <NuxtLink v-for="(path, index) in paths" :key="path" :to="path" class="justify-self-start text-12px text-brand underline">
      核对客户提交 {{ index + 1 }}
    </NuxtLink>
  </section>
</template>
