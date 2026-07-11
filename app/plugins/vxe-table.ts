import VxeUI from 'vxe-pc-ui'
import VxeTable from 'vxe-table'
import 'vxe-pc-ui/lib/style.css'
import 'vxe-table/lib/style.css'
import '~/assets/css/vxe-theme.css'

// vxe-table v4 的 loading 遮罩 / cell tooltip 等 UI 子组件由配套库 vxe-pc-ui(VxeUI)提供，
// 必须先 use(VxeUI) 再 use(VxeTable)，否则 :loading / show-overflow 触发时报「缺少 vxe-loading /
// vxe-tooltip 组件」并在渲染 null 节点时抛 __vnode 错。
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(VxeUI).use(VxeTable)
})
