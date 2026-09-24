import { defineEventHandler } from 'h3'
import { logoutProductionOwner } from '../../utils/production-auth'

export default defineEventHandler(event => logoutProductionOwner(event))
