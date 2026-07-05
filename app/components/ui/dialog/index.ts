// shadcn-vue Dialog（reka-ui 底座）。模板里由 Nuxt 自动导入，
// 此 index 供需要显式 import 的场景（如 formModal 组合）。
// DialogHeader/DialogFooter/DialogTrigger 目前无使用方：按 shadcn「完整组件集」惯例预留，勿因未用而删。
export { DialogClose, DialogTrigger } from 'reka-ui'

export { default as Dialog } from './Dialog.vue'
export { default as DialogContent } from './DialogContent.vue'
export { default as DialogDescription } from './DialogDescription.vue'
export { default as DialogFooter } from './DialogFooter.vue'
export { default as DialogHeader } from './DialogHeader.vue'
export { default as DialogTitle } from './DialogTitle.vue'
