import { OTHER_SETTLEMENT_SCHEMA } from '../../app/lib/other-settlement/schema'

export { OTHER_SETTLEMENT_TABLES as PRODUCTION_OTHER_SETTLEMENT_TABLES } from '../../app/lib/other-settlement/schema'
export const PRODUCTION_OTHER_SETTLEMENT_SCHEMA = `${OTHER_SETTLEMENT_SCHEMA}\nINSERT INTO production_participants VALUES('other-settlements',1);`
