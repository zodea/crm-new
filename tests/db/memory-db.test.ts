import { expect, it, vi } from 'vitest'
import * as migrations from '~/lib/db/migrations'
import { createMigratedMemoryDb } from '../helpers/memory-db'

it('并发建库只迁移一次，各连接独立读写、关闭并执行外键约束', async ({ onTestFinished }) => {
  const migrate = vi.spyOn(migrations, 'runMigrations')
  onTestFinished(() => migrate.mockRestore())
  const [first, second] = await Promise.all([createMigratedMemoryDb(), createMigratedMemoryDb()])
  onTestFinished(second.close)
  try {
    await first.execute('INSERT INTO projects (id, name) VALUES (?, ?)', ['only-first', '项目'])
    expect(await second.select('SELECT id FROM projects')).toEqual([])
  }
  finally {
    first.close()
  }
  await expect(second.execute('INSERT INTO buildings (id, project_id, code, name) VALUES (?, ?, ?, ?)', ['b', 'only-first', 'B', 'B栋']))
    .rejects
    .toThrow('FOREIGN KEY constraint failed')
  const third = await createMigratedMemoryDb()
  onTestFinished(third.close)
  expect(await third.select('SELECT id FROM projects')).toEqual([])
  expect(migrate).toHaveBeenCalledOnce()
})
