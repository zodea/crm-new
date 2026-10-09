import { createVisibilitySql, PARENT_REFS } from '../../app/lib/db/soft-delete'

/** Historical contract references are retained; unavailable upstream tables cannot hide owned plans. */
export const productionScheduleVisibility = createVisibilitySql({
  ...PARENT_REFS,
  schedule_groups: PARENT_REFS.schedule_groups!.filter(ref => ref.table !== 'contracts'),
})
