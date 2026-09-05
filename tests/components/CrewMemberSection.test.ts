import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import CrewMemberSection from '~/components/crew-worker/CrewMemberSection.vue'

const setWorkerCrewMembership = vi.hoisted(() => vi.fn())
const membershipSession = vi.hoisted(() => ({}))
const formModal = vi.fn()
const confirm = vi.fn()
const success = vi.fn()
const error = vi.fn()

vi.mock('~/stores/crew-worker-command', () => ({
  CrewWorkerMembershipConflictError: class CrewWorkerMembershipConflictError extends Error {},
  useCrewWorkerCommandStore: () => ({ setWorkerCrewMembership, createMembershipSession: () => membershipSession }),
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
    crewWorkerRead: {
      listWorkers: vi.fn().mockResolvedValue({
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
        pagination: { page: 1, pageSize: 100, total: 1 },
        summary: { trades: [], projectStatuses: [], origins: { real: { workerCount: 1, activeWorkerCount: 1 }, demo: { workerCount: 0, activeWorkerCount: 0 } } },
        empty: null,
        asOf: '2026-08-24T00:00:00.000Z',
        sourceVersion: 'v1',
        capabilities: ['worker:list:read', 'worker:write'],
      }),
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
  components: {
    EntityLink: defineComponent({ props: ['label'], template: '<a>{{ label }}</a>' }),
    SectionHeader: defineComponent({ props: ['title', 'subtitle'], template: '<header><h2>{{ title }}</h2><slot name="extra"/></header>' }),
    KitButton: defineComponent({ props: ['loading'], template: '<button :disabled="loading"><slot/></button>' }),
  },
}

describe('班组成员管理区', () => {
  beforeEach(() => {
    setWorkerCrewMembership.mockReset().mockResolvedValue({ id: 'worker-1', commandId: 'command', version: '2', updatedAt: '2026-08-24T00:00:00.000Z', attachmentIds: [] })
    formModal.mockReset()
    confirm.mockReset()
    success.mockReset()
    error.mockReset()
  })

  it('从班组详情直接添加现有工人并通知刷新', async () => {
    formModal.mockResolvedValue({ worker: '李师傅 · 木工 · 未分组' })
    const { emitted } = render(CrewMemberSection, { props: { detail, canManage: true }, global })

    await fireEvent.click(screen.getByRole('button', { name: '添加成员' }))

    expect(formModal).toHaveBeenCalledWith(expect.objectContaining({
      fields: [expect.objectContaining({ value: '', required: true })],
    }))
    await waitFor(() => expect(setWorkerCrewMembership).toHaveBeenCalledWith(membershipSession, {
      workerId: 'worker-2',
      expectedCrewId: null,
      crewId: 'crew-1',
    }))
    expect(emitted().changed).toHaveLength(1)
    expect(success).toHaveBeenCalledWith('已将李师傅加入泥水一班')
  })

  it('移出成员只解除班组归属，并明确保留工人与工资记录', async () => {
    confirm.mockResolvedValue(true)
    const { emitted } = render(CrewMemberSection, { props: { detail, canManage: true }, global })

    await fireEvent.click(screen.getByRole('button', { name: '移出班组' }))

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('不会删除工人、工资或历史记录'),
    }))
    await waitFor(() => expect(setWorkerCrewMembership).toHaveBeenCalledWith(membershipSession, {
      workerId: 'worker-1',
      expectedCrewId: 'crew-1',
      crewId: null,
    }))
    expect(emitted().changed).toHaveLength(1)
  })

  it('测试数据或无工人写权限时不显示关系操作', () => {
    render(CrewMemberSection, { props: { detail, canManage: false }, global })
    expect(screen.queryByRole('button', { name: '添加成员' })).toBeNull()
    expect(screen.queryByRole('button', { name: '移出班组' })).toBeNull()
  })
})
