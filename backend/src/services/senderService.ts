import { Prisma } from '../generated/prisma/client'
import { prisma } from '../config/database'

export interface SenderInput {
  email: string
  displayName: string
}

export interface SenderUpdateInput {
  email?: string
  displayName?: string
}

const senderSelect = {
  id: true,
  email: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SenderAccountSelect

export class SenderServiceError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
    this.name = 'SenderServiceError'
  }
}

export async function listSenders(userId: string) {
  return prisma.senderAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: senderSelect })
}

export async function getSenderById(userId: string, id: string) {
  const sender = await prisma.senderAccount.findFirst({ where: { id, userId }, select: senderSelect })
  if (!sender) throw new SenderServiceError(404, 'Sender account not found')
  return sender
}

export async function createSender(userId: string, input: SenderInput) {
  const email = input.email.trim().toLowerCase()
  try {
    return await prisma.senderAccount.create({
      data: { userId, email, displayName: input.displayName.trim() },
      select: senderSelect,
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new SenderServiceError(409, 'A sender account with this email already exists')
    throw error
  }
}

export async function updateSender(userId: string, id: string, input: SenderUpdateInput) {
  await getSenderById(userId, id)
  const data: SenderUpdateInput = {}
  if (input.email !== undefined) data.email = input.email.trim().toLowerCase()
  if (input.displayName !== undefined) data.displayName = input.displayName.trim()

  try {
    return await prisma.senderAccount.update({ where: { id }, data, select: senderSelect })
  } catch (error) {
    if (isUniqueViolation(error)) throw new SenderServiceError(409, 'A sender account with this email already exists')
    throw error
  }
}

export async function deleteSender(userId: string, id: string): Promise<void> {
  await getSenderById(userId, id)
  try {
    await prisma.senderAccount.delete({ where: { id } })
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new SenderServiceError(409, 'Sender account cannot be deleted because it is used by email history')
    }
    throw error
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
}
