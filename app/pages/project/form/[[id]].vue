<script setup lang="ts">
import MasterDataFormPage from '~/components/master-data/MasterDataFormPage.vue'

definePageMeta({ name: 'projectForm' })

const route = useRoute()
const isDemo = computed(() => route.query.origin === 'demo')
</script>

<template>
  <MasterDataFormPage
    v-if="!isDemo"
    kind="project"
    hide-sections
    return-to-detail
  />
  <StatePanel
    v-else
    kind="forbidden"
    title="测试数据不能从正式入口修改"
    description="请返回项目列表继续只读查看；测试数据修改只允许在独立演示工作区进行。"
  >
    <template #action>
      <NuxtLink to="/project" class="btn-secondary">
        返回项目列表
      </NuxtLink>
    </template>
  </StatePanel>
</template>
