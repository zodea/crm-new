<script setup lang="ts">
import { onActivated, onMounted, onScopeDispose, shallowRef } from 'vue'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  entityLabel: string
  description: string
  loadPendingForms: () => Promise<readonly string[]>
}>()

const paths = shallowRef<readonly string[]>([])
const problem = shallowRef('')
let generation = 0

async function load() {
  const token = ++generation
  try {
    const result = await props.loadPendingForms()
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
  <section v-if="paths.length || problem" class="panel grid gap-2 border-warn/40 p-4" :aria-label="`核对上次${entityLabel}提交`">
    <h2 class="text-13px font-700">
      上次{{ entityLabel }}提交需要核对
    </h2>
    <p class="text-12px text-ink-muted">
      {{ description }}
    </p>
    <p v-if="problem" role="alert" class="text-12px text-danger">
      {{ problem }}
    </p>
    <NuxtLink v-for="(path, index) in paths" :key="path" :to="path" class="justify-self-start text-12px text-brand underline">
      核对{{ entityLabel }}提交 {{ index + 1 }}
    </NuxtLink>
  </section>
</template>
