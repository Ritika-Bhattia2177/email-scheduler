import type { ErrorRequestHandler } from 'express'
import { redactSecrets } from '../utils/redactSecrets'

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error)
    return
  }

  const prismaCode = isRecord(error)
    ? typeof error.code === 'string' ? error.code : typeof error.errorCode === 'string' ? error.errorCode : undefined
    : undefined
  const prismaResponse = prismaFailure(prismaCode)
  const errorStatus = typeof error === 'object' && error !== null
    ? ('statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 'status' in error && typeof error.status === 'number' ? error.status : undefined)
    : undefined
  const statusCode = prismaResponse?.statusCode
    ?? (errorStatus && errorStatus >= 400 && errorStatus < 600 ? errorStatus : 500)
  const message = prismaResponse?.message
    ?? (statusCode === 500
      ? 'Something went wrong'
      : error instanceof Error
        ? redactSecrets(error.message)
        : 'Something went wrong')

  response.status(statusCode).json({
    success: false,
    message,
  })
}

function prismaFailure(code: string | undefined): { statusCode: number; message: string } | undefined {
  switch (code) {
    case 'P2002': return { statusCode: 409, message: 'A record with these values already exists' }
    case 'P2003': return { statusCode: 409, message: 'The record is referenced by other data and cannot be changed' }
    case 'P2025': return { statusCode: 404, message: 'The requested record was not found' }
    case 'P1001':
    case 'P1002':
    case 'P1008':
    case 'P1017': return { statusCode: 503, message: 'The database is temporarily unavailable' }
    default: return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
