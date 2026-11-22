<script setup lang="ts">
import OtherSettlementDetailScreen from '~/pages/contract/other-settlement/_components/OtherSettlementDetailScreen.vue'

const route = useRoute()
</script>

<template>
  <OtherSettlementDetailScreen :settlement-id="String(route.params.id)" />
</template>
