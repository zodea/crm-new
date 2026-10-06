import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import CrewMemberSection from '~/components/crew-worker/CrewMemberSection.vue'
import { useProductionAccessStore } from '~/stores/production-access'
import { withOriginReadMeta } from '../../server/utils/read-meta'
import { publicReadMeta } from '../helpers/public-read-meta'

const setWorkerCrewMembership = vi.hoisted(() => vi.fn())
const inspectMembershipRecovery = vi.hoisted(() => vi.fn())
const recoverMembership = vi.hoisted(() => vi.fn())
const membershipSession = vi.hoisted(() => ({}))
const formModal = vi.fn()
const confirm = vi.fn()
const success = vi.fn()
const error = vi.fn()
const accessStatus = vi.fn()

vi.mock('~/stores/crew-worker-command', () => ({
  CrewWorkerMembershipConflictError: class CrewWorkerMembershipConflictError extends Error {},
  useCrewWorkerCommandStore: () => ({ setWorkerCrewMembership, inspectMembershipRecovery, recoverMembership, createMembershipSession: () => membershipSession }),
}))

const workerRef = (id: string, label: string) => ({ state: 'resolved' as const, entity: 'worker' as const, id, label, no: null })
const detail = {
  dataOrigin: 'real' as const,
  crew: { id: 'crew-1', name: '泥水一班' },
  members: [{
    worker: workerRef('worker-1', '张师傅'),
    navigation: { kind: 'entity-detail', subject: workerRef('worker-1', '张师傅'), variant: 'detail', view: null, filters: { dataOrigin: 'real' } },
    trade: '泥工',
    phone: '138 **** 0001',
    projectStatus: '在场',
    currentProject: { state: 'missing', entity: 'project', label: null, no: null },
    currentProjectNavigation: { kind: 'none', reason: 'missing-target' },
    entryDate: null,
    dailyWage: 360,
    linkedWorker: { state: 'missing', entity: 'worker', label: null, no: null },
    linkedWorkerNavigation: { kind: 'none', reason: 'missing-target' },
  }],
}

vi.stubGlobal('useRoute', () => ({ fullPath: '/base/crew/crew-1?origin=real' }))
vi.stubGlobal('useKitUI', () => ({ formModal, confirm, success, error, warning: vi.fn() }))
vi.stubGlobal('useNuxtApp', () => ({
  $repositories: {
    productionAccess: { status: accessStatus },
    crewWorkerRead: {
      listWorkers: vi.fn().mockResolvedValue(withOriginReadMeta({
        items: [{
          dataOrigin: 'real',
          worker: workerRef('worker-2', '李师傅'),
          navigation: { kind: 'entity-detail', subject: workerRef('worker-2', '李师傅'), variant: 'detail', view: null, filters: { dataOrigin: 'real' } },
          trade: '木工',
          crew: { state: 'missing', entity: 'crew', label: null, no: null },
          crewNavigation: { kind: 'none', reason: 'missing-target' },
          currentProject: { state: 'missing', entity: 'project', label: null, no: null },
          projectNavigation: { kind: 'none', reason: 'missing-target' },
          projectStatus: '在场',
          status: 'submitted',
          phone: '139 **** 0002',
          idCard: '4401 **** 0002',
          entryDate: null,
          exitDate: null,
          safetyEducation: true,
          updatedAt: '2026-08-24T00:00:00.000Z',
        }],
        pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 },
        summary: { trades: [], projectStatuses: [], origins: { real: { workerCount: 1, activeWorkerCount: 1 }, demo: { workerCount: 0, activeWorkerCount: 0 } } },
        empty: null,
        asOf: '2026-08-24T00:00:00.000Z',
        sourceVersion: 'v1',
        capabilities: ['worker:list:read', 'worker:write'],
      }, {
        real: publicReadMeta({ schemaVersion: 'crew-worker-read-v2', dataOrigin: 'real', asOf: '2026-08-24T00:00:00.000Z', sourceVersion: 'worker-owner-v1', capabilities: ['worker:list:read', 'worker:write'], scope: { operation: 'membership-candidates', origin: 'real' }, requested: true }),
        demo: publicReadMeta({ schemaVersion: 'crew-worker-read-v2', dataOrigin: 'demo', asOf: '2026-08-24T00:00:00.000Z', sourceVersion: null, capabilities: ['worker:list:read', 'worker:write'], scope: { operation: 'membership-candidates', origin: 'demo' }, requested: false }),
      })),
    },
    crewWorkerCommands: {
      context: vi.fn().mockResolvedValue({ workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['worker:write'] }),
      loadWorkerForm: vi.fn(async (id: string) => ({
        draft: { id, name: id === 'worker-1' ? '张师傅' : '李师傅', phone: '13800000000', trade: '泥工', bankName: '示例银行', bankAccount: '6222', crewId: id === 'worker-1' ? 'crew-1' : null, status: 'submitted' },
        attachments: [],
        version: '1',
        updatedAt: '2026-08-24T00:00:00.000Z',
      })),
      executeWorker: vi.fn(),
    },
  },
}))

const global = {
  plugins: [createPinia()],
  components: {
    EntityLink: defineComponent({ props: ['label'], template: '<a>{{ label }}</a>' }),
    SectionHeader: defineComponent({ props: ['title', 'subtitle'], template: '<header><h2>{{ title }}</h2><slot name="extra"/></header>' }),
    KitButton: defineComponent({ props: ['loading', 'disabled'], template: '<button :disabled="loading || disabled"><slot/></button>' }),
  },
}

describe('班组成员管理区', () => {
  beforeEach(() => {
    global.plugins = [createPinia()]
    setWorkerCrewMembership.mockReset().mockResolvedValue({ id: 'worker-1', commandId: 'command', version: '2', updatedAt: '2026-08-24T00:00:00.000Z', attachmentIds: [] })
    inspectMembershipRecovery.mockReset().mockResolvedValue([])
    recoverMembership.mockReset().mockResolvedValue({ outcome: 'applied', result: { id: 'worker-1' } })
    formModal.mockReset()
    confirm.mockReset()
    success.mockReset()
    error.mockReset()
  })

  async function clickReady(name: string) {
    await waitFor(() => expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name }))
  }

  it('从班组详情直接添加现有工人并通知刷新', async () => {
    formModal.mockResolvedValue({ worker: '李师傅 · 木工 · 未分组' })
    const { emitted } = render(CrewMemberSection, { props: { detail, canManage: true }, global })

    await clickReady('添加成员')

    await waitFor(() => expect(formModal).toHaveBeenCalledWith(expect.objectContaining({
      fields: [expect.objectContaining({ value: '', required: true })],
    })))
    await waitFor(() => expect(setWorkerCrewMembership).toHaveBeenCalledWith(membershipSession, {
      workerId: 'worker-2',
      expectedCrewId: null,
      crewId: 'crew-1',
    }, expect.any(Function)))
    expect(emitted().changed).toHaveLength(1)
    expect(success).toHaveBeenCalledWith('已将李师傅加入泥水一班')
  })

  it('移出成员只解除班组归属，并明确保留工人与工资记录', async () => {
    confirm.mockResolvedValue(true)
    const { emitted } = render(CrewMemberSection, { props: { detail, canManage: true }, global })

    await clickReady('移出班组')

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('不会删除工人、工资或历史记录'),
    }))
    await waitFor(() => expect(setWorkerCrewMembership).toHaveBeenCalledWith(membershipSession, {
      workerId: 'worker-1',
      expectedCrewId: 'crew-1',
      crewId: null,
    }, expect.any(Function)))
    expect(emitted().changed).toHaveLength(1)
  })

  it('候选弹窗等待中切换班组不提交原候选到新目标', async () => {
    let finish!: (value: { worker: string }) => void
    formModal.mockImplementation(() => new Promise((resolve) => {
      finish = resolve
    }))
    const view = render(CrewMemberSection, { props: { detail, canManage: true }, global })
    await clickReady('添加成员')
    await waitFor(() => expect(formModal).toHaveBeenCalledTimes(1))
    await view.rerender({ detail: { ...detail, crew: { id: 'crew-2', name: '木工二班' } }, canManage: true })
    finish({ worker: '李师傅 · 木工 · 未分组' })
    await waitFor(() => expect((screen.getByRole('button', { name: '添加成员' }) as HTMLButtonElement).disabled).toBe(false))
    expect(setWorkerCrewMembership).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(view.emitted().changed).toBeUndefined()
  })

  it('移出确认期间重复点击只开启一次确认，撤权后迟到确认不提交', async () => {
    let finish!: (value: boolean) => void
    confirm.mockImplementation(() => new Promise((resolve) => {
      finish = resolve
    }))
    const view = render(CrewMemberSection, { props: { detail, canManage: true }, global })
    await clickReady('移出班组')
    await fireEvent.click(screen.getByRole('button', { name: '移出班组' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    await view.rerender({ detail, canManage: false })
    finish(true)
    await Promise.resolve()
    expect(setWorkerCrewMembership).not.toHaveBeenCalled()
    expect(view.emitted().changed).toBeUndefined()
  })

  it('已发成员命令的结果迟到后不覆盖新班组或清理原恢复session', async () => {
    let finish!: (value: unknown) => void
    setWorkerCrewMembership.mockImplementation(() => new Promise((resolve) => {
      finish = resolve
    }))
    formModal.mockResolvedValue({ worker: '李师傅 · 木工 · 未分组' })
    const view = render(CrewMemberSection, { props: { detail, canManage: true }, global })
    await clickReady('添加成员')
    await waitFor(() => expect(setWorkerCrewMembership).toHaveBeenCalledTimes(1))
    await view.rerender({ detail: { ...detail, crew: { id: 'crew-2', name: '木工二班' } }, canManage: true })
    const current = setWorkerCrewMembership.mock.calls[0]![2] as () => boolean
    expect(current()).toBe(false)
    finish({ id: 'worker-2', version: '2' })
    await Promise.resolve()
    await Promise.resolve()
    expect(success).not.toHaveBeenCalled()
    expect(view.emitted().changed).toBeUndefined()
  })

  it('可信身份变化使待确认操作失效', async () => {
    let finish!: (value: boolean) => void
    confirm.mockImplementation(() => new Promise((resolve) => {
      finish = resolve
    }))
    const view = render(CrewMemberSection, { props: { detail, canManage: true }, global })
    const access = useProductionAccessStore(global.plugins[0])
    await clickReady('移出班组')
    accessStatus.mockResolvedValue({ mode: 'production', authenticated: false, purpose: 'verification' })
    await access.check()
    finish(true)
    await Promise.resolve()
    expect(setWorkerCrewMembership).not.toHaveBeenCalled()
    expect(view.emitted().changed).toBeUndefined()
  })

  it('测试数据或无工人写权限时不显示关系操作', () => {
    render(CrewMemberSection, { props: { detail, canManage: false }, global })
    expect(screen.queryByRole('button', { name: '添加成员' })).toBeNull()
    expect(screen.queryByRole('button', { name: '移出班组' })).toBeNull()
  })

  it.each([false, true])('已应用成员不需要重新出现于候选，独立恢复并阻止新意图；已知回执 %s', async (resultKnown) => {
    const descriptor = { workspaceId: 'workspace-default', actorId: 'actor-default', commandId: 'member-original-1', family: 'worker-membership', targetId: 'worker-1', action: 'membership', scopeId: 'crew-1' }
    inspectMembershipRecovery.mockResolvedValueOnce([{ key: 'original-key', descriptor, resultKnown }]).mockResolvedValue([])
    const view = render(CrewMemberSection, { props: { detail, canManage: true }, global })
    const label = resultKnown ? '重新读取已保存成员' : '核对原成员提交'
    await screen.findByRole('button', { name: label })
    expect((screen.getByRole('button', { name: '添加成员' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '移出班组' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(recoverMembership).toHaveBeenCalledWith(membershipSession, 'crew-1', descriptor, expect.any(Function)))
    await waitFor(() => expect(screen.queryByRole('status', { name: '原成员提交恢复' })).toBeNull())
    expect(view.emitted().changed).toHaveLength(1)
    expect(setWorkerCrewMembership).not.toHaveBeenCalled()
    expect(formModal).not.toHaveBeenCalled()
  })

  it('旧恢复描述只显示原工人核对，不伪造当前班组上下文；撤权立即隐藏旧身份', async () => {
    const descriptor = { workspaceId: 'workspace-default', actorId: 'actor-default', commandId: 'member-legacy-1', family: 'worker-membership', targetId: 'worker-historical', action: 'membership' }
    inspectMembershipRecovery.mockResolvedValue([{ key: 'legacy-key', descriptor, resultKnown: false }])
    const view = render(CrewMemberSection, { props: { detail, canManage: true }, global })
    await screen.findByText(/历史记录未保留班组上下文/)
    expect(screen.getByText(/worker-historical/)).toBeTruthy()
    await view.rerender({ detail, canManage: false })
    expect(screen.queryByText(/worker-historical/)).toBeNull()
    expect(screen.queryByRole('button', { name: '核对原成员提交' })).toBeNull()
    expect(recoverMembership).not.toHaveBeenCalled()
  })

  it('可信来源变化立即隐藏恢复定位，迟到检查不能重新泄露旧工人', async () => {
    let finish!: (value: unknown[]) => void
    inspectMembershipRecovery.mockImplementation(() => new Promise((resolve) => {
      finish = resolve
    }))
    render(CrewMemberSection, { props: { detail, canManage: true }, global })
    await waitFor(() => expect(inspectMembershipRecovery).toHaveBeenCalledTimes(1))
    accessStatus.mockResolvedValue({ mode: 'production', authenticated: false, purpose: 'verification' })
    await useProductionAccessStore(global.plugins[0]).check()
    finish([{ key: 'old-key', descriptor: { targetId: 'private-worker', commandId: 'old-command' }, resultKnown: false }])
    await Promise.resolve()
    expect(screen.queryByText(/private-worker/)).toBeNull()
    expect((screen.getByRole('button', { name: '添加成员' }) as HTMLButtonElement).disabled).toBe(true)
    expect(recoverMembership).not.toHaveBeenCalled()
  })
})
