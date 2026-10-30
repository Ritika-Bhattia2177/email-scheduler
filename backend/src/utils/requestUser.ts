import type { Request } from 'express'
import { env } from '../config/env'
import { getSessionUserId } from '../services/auth.service'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function getRequestUserId(request: Request): string {
  const sessionUserId = getSessionUserId(request.headers.cookie)
  if (sessionUserId) return sessionUserId

  const userId = request.header('x-user-id')?.trim()
  if (env.AUTH_MODE !== 'development') {
    throw unauthorized()
  }
  if (!userId || !uuidPattern.test(userId)) {
    throw unauthorized()
  }
  return userId
}

function unauthorized(): Error {
    const error = new Error('A valid x-user-id header is required')
    Object.assign(error, { statusCode: 401 })
    return error
}
