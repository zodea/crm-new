<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const desktop = isDesktopRuntime()
</script>

<template>
  <MasterDataRegistryList v-if="desktop" kind="crew" />
  <CrewWorkerCentralListScreen v-else kind="crew" />
</template>
