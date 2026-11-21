<script setup lang="ts">
import OtherSettlementDetailScreen from '~/components/other-settlement/OtherSettlementDetailScreen.vue'

const route = useRoute()
</script>

<template>
  <OtherSettlementDetailScreen :settlement-id="String(route.params.id)" />
</template>
