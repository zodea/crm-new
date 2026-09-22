import { defineEventHandler } from 'h3'
import { productionAuthStatus } from '../../utils/production-auth'

export default defineEventHandler(event => productionAuthStatus(event))
