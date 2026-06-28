import { execute, select } from '~/lib/db/connection'

export function useDb() {
  return { execute, select }
}
