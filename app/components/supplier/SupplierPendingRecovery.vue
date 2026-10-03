<script setup lang="ts">
import { onActivated, onMounted, onScopeDispose, shallowRef } from 'vue'
import { toErrorMessage } from '~/lib/util/error'
import { useSupplierCommandStore } from '~/stores/supplier-command'

const store = useSupplierCommandStore()
const paths = shallowRef<string[]>([])
const problem = shallowRef('')
let generation = 0
async function load() {
  const token = ++generation
  try {
    const result = await store.pendingForms()
    if (token !== generation)
      return
    paths.value = result
    problem.value = ''
  }
  catch (cause) {
    if (token === generation)
      problem.value = toErrorMessage(cause)
  }
}
onMounted(() => void load())
onActivated(() => void load())
onScopeDispose(() => generation++)
</script>

<template>
  <section v-if="paths.length || problem" class="panel grid min-w-0 gap-2 border-warn/40 p-4" aria-label="核对上次分供方提交">
    <h2 class="text-13px font-700">
      上次分供方提交需要核对
    </h2>
    <p class="text-12px text-ink-muted">
      保存结果尚未确认。先核对主档、证照或税务核验的原提交，再登记新资料。
    </p>
    <p v-if="problem" role="alert" class="text-12px text-danger">
      {{ problem }}
    </p>
    <NuxtLink v-for="(path, index) in paths" :key="path" :to="path" class="justify-self-start text-12px text-brand underline">
      核对分供方提交 {{ index + 1 }}
    </NuxtLink>
  </section>
</template>
