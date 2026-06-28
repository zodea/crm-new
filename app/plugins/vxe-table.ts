import VxeTable from 'vxe-table'
import 'vxe-table/lib/style.css'
import '~/assets/css/vxe-theme.css'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(VxeTable)
})
