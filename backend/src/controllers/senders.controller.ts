import type { RequestHandler } from 'express'
import { SenderServiceError, createSender, deleteSender, getSenderById, listSenders, updateSender } from '../services/senderService'
import type { SenderInput, SenderUpdateInput } from '../services/senderService'
import { getRequestUserId } from '../utils/requestUser'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const listSendersController: RequestHandler = async (request, response, next) => {
  try {
    response.json({ success: true, data: await listSenders(getRequestUserId(request)) })
  } catch (error) {
    next(error)
  }
}

export const getSenderController: RequestHandler = async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const id = validateSenderId(request.params.id)
    response.json({ success: true, data: await getSenderById(userId, id) })
  } catch (error) {
    next(error)
  }
}

export const createSenderController: RequestHandler = async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const input = validateCreateBody(request.body)
    response.status(201).json({
      success: true,
      message: 'Sender account created successfully',
      data: await createSender(userId, input),
    })
  } catch (error) {
    next(error)
  }
}

export const updateSenderController: RequestHandler = async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const id = validateSenderId(request.params.id)
    const input = validateUpdateBody(request.body)
    response.json({ success: true, message: 'Sender account updated successfully', data: await updateSender(userId, id, input) })
  } catch (error) {
    next(error)
  }
}

export const deleteSenderController: RequestHandler = async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const id = validateSenderId(request.params.id)
    await deleteSender(userId, id)
    response.json({ success: true, message: 'Sender account deleted successfully' })
  } catch (error) {
    next(error)
  }
}

function validateSenderId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new SenderServiceError(400, 'A valid sender ID is required')
  return value
}

function validateCreateBody(body: unknown): SenderInput {
  if (!isRecord(body)) throw new SenderServiceError(400, 'Request body must be an object')
  const email = body.email
  const displayName = body.displayName
  if (typeof email !== 'string' || !email.trim()) throw new SenderServiceError(400, 'email is required')
  if (email.trim().length > 320 || !emailPattern.test(email.trim())) throw new SenderServiceError(400, 'A valid email is required')
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new SenderServiceError(400, 'displayName is required and cannot exceed 200 characters')
  }
  return { email, displayName }
}

function validateUpdateBody(body: unknown): SenderUpdateInput {
  if (!isRecord(body)) throw new SenderServiceError(400, 'Request body must be an object')
  const input: SenderUpdateInput = {}
  if ('email' in body) {
    if (typeof body.email !== 'string' || !body.email.trim()) throw new SenderServiceError(400, 'email cannot be empty')
    if (body.email.trim().length > 320 || !emailPattern.test(body.email.trim())) throw new SenderServiceError(400, 'A valid email is required')
    input.email = body.email
  }
  if ('displayName' in body) {
    if (typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.trim().length > 200
      || /[\u0000-\u001f\u007f]/.test(body.displayName)) {
      throw new SenderServiceError(400, 'displayName cannot be empty or exceed 200 characters')
    }
    input.displayName = body.displayName
  }
  if (input.email === undefined && input.displayName === undefined) {
    throw new SenderServiceError(400, 'At least one of email or displayName is required')
  }
  return input
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
