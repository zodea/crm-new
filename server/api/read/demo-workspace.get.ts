import { demoWorkspaceTestInstance } from '../../utils/demo-workspace-test-instance'

export default defineEventHandler((event) => {
  return demoWorkspaceTestInstance.workspace(
    getHeader(event, 'x-ruihang-test-session'),
  )
})
