<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
</script>

<template>
  <MasterDataRegistryList v-if="desktop" kind="worker" />
  <CrewWorkerCentralListScreen v-else kind="worker" />
</template>
