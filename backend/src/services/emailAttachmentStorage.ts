import { chmod, mkdir, open, rm, stat } from 'node:fs/promises'
import { chmodSync, createReadStream, mkdirSync } from 'node:fs'
import { basename, extname, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import multer, { MulterError } from 'multer'
import type { NextFunction, Request, Response } from 'express'

const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENT_COUNT = 10
const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024
const STORAGE_DIRECTORY = resolve(__dirname, '../../uploads/email-attachments')

const allowedTypes = new Map<string, { mimeTypes: readonly string[] }>([
  ['.pdf', { mimeTypes: ['application/pdf'] }],
  ['.doc', { mimeTypes: ['application/msword'] }],
  ['.docx', { mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] }],
  ['.txt', { mimeTypes: ['text/plain'] }],
  ['.csv', { mimeTypes: ['text/csv', 'application/vnd.ms-excel'] }],
  ['.png', { mimeTypes: ['image/png'] }],
  ['.jpg', { mimeTypes: ['image/jpeg'] }],
  ['.jpeg', { mimeTypes: ['image/jpeg'] }],
  ['.gif', { mimeTypes: ['image/gif'] }],
  ['.webp', { mimeTypes: ['image/webp'] }],
])

export const emailAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => {
      try {
        mkdirSync(STORAGE_DIRECTORY, { recursive: true, mode: 0o700 })
        chmodSync(STORAGE_DIRECTORY, 0o700)
        callback(null, STORAGE_DIRECTORY)
      } catch {
        callback(new Error('Attachment storage is unavailable'), '')
      }
    },
    filename: (_request, file, callback) => {
      const extension = extname(safeOriginalFilename(file.originalname)).toLowerCase()
      callback(null, `${randomUUID()}${extension}`)
    },
  }),
  limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES, files: MAX_ATTACHMENT_COUNT, fields: 10, fieldSize: 1024 * 1024, parts: 20 },
  fileFilter: (_request, file, callback) => {
    try {
      const fileName = safeOriginalFilename(file.originalname)
      const extension = extname(fileName).toLowerCase()
      const allowed = allowedTypes.get(extension)
      if (!allowed || !allowed.mimeTypes.includes(file.mimetype.toLowerCase())) {
        callback(uploadError('Attachment type is not allowed'))
        return
      }
      callback(null, true)
    } catch (error) {
      callback(error instanceof Error ? error : uploadError('Attachment filename is invalid'))
    }
  },
})

export function getUploadedAttachments(request: Request): Express.Multer.File[] {
  const files = request.files
  if (!Array.isArray(files)) return []
  return files
}

export function uploadedAttachmentErrorStatus(error: unknown): number | undefined {
  if (error instanceof MulterError) {
    return error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
  }
  if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number') return error.statusCode
  return undefined
}

export function uploadAttachments(request: Request, response: Response, next: NextFunction): void {
  emailAttachmentUpload.array('attachments', MAX_ATTACHMENT_COUNT)(request, response, error => {
    if (error) {
      const statusCode = uploadedAttachmentErrorStatus(error)
      if (statusCode && error instanceof Error) Object.assign(error, { statusCode })
      void removeUploadedAttachments(getUploadedAttachments(request)).finally(() => next(error))
      return
    }

    const files = getUploadedAttachments(request)
    const totalSize = files.reduce((total, file) => total + file.size, 0)
    if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      void removeUploadedAttachments(files).finally(() => {
        next(uploadError('Combined attachment size cannot exceed 25 MB', 413))
      })
      return
    }

    next()
  })
}

export function safeAttachmentFilename(originalName: string): string {
  return safeOriginalFilename(originalName)
}

export async function prepareUploadedAttachments(files: Express.Multer.File[]): Promise<void> {
  await mkdir(STORAGE_DIRECTORY, { recursive: true, mode: 0o700 })
  await chmod(STORAGE_DIRECTORY, 0o700)
  for (const file of files) {
    const extension = extname(file.filename).toLowerCase()
    const type = allowedTypes.get(extension)
    if (!type || !type.mimeTypes.includes(file.mimetype.toLowerCase()) || !isWithinStorage(file.path)) {
      throw uploadError('Attachment validation failed')
    }
    if (file.size === 0) throw uploadError('Empty attachments are not allowed')

    const handle = await open(file.path, 'r')
    const header = Buffer.alloc(16)
    let headerLength = 0
    try {
      const readResult = await handle.read(header, 0, header.length, 0)
      headerLength = readResult.bytesRead
    } finally {
      await handle.close()
    }
    if (!hasValidFileSignature(extension, header.subarray(0, headerLength))
      || ((extension === '.txt' || extension === '.csv') && !(await isUtf8TextFile(file.path)))) {
      throw uploadError('Attachment content does not match its file type')
    }
    await chmod(file.path, 0o600)
  }
}

export async function removeUploadedAttachments(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map(file => rm(file.path, { force: true }).catch(() => undefined)))
}

export function resolveStoredAttachmentPath(storageReference: string): string {
  if (!/^[0-9a-f-]{36}\.(pdf|doc|docx|txt|csv|png|jpg|jpeg|gif|webp)$/i.test(storageReference)) {
    throw new Error('Email attachment reference is invalid')
  }
  const fullPath = resolve(STORAGE_DIRECTORY, storageReference)
  if (!isWithinStorage(fullPath)) throw new Error('Email attachment reference is invalid')
  return fullPath
}

export async function assertStoredAttachmentExists(storageReference: string): Promise<string> {
  const filePath = resolveStoredAttachmentPath(storageReference)
  try {
    const details = await stat(filePath)
    if (!details.isFile()) throw new Error('not a file')
    return filePath
  } catch {
    throw new Error('A scheduled email attachment is unavailable')
  }
}

function safeOriginalFilename(originalName: string): string {
  if (!originalName || Buffer.byteLength(originalName, 'utf8') > 255) throw uploadError('Attachment filename is invalid')
  const fileName = basename(originalName.replaceAll('\\', '/')).normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (!fileName || fileName === '.' || fileName === '..' || Buffer.byteLength(fileName, 'utf8') > 180) {
    throw uploadError('Attachment filename is invalid')
  }
  return fileName
}

function hasValidFileSignature(extension: string, header: Buffer): boolean {
  switch (extension) {
    case '.pdf': return header.subarray(0, 5).toString('ascii') === '%PDF-'
    case '.doc': return header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    case '.docx': return header.length >= 4 && header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04
    case '.png': return header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    case '.jpg':
    case '.jpeg': return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
    case '.gif': return ['GIF87a', 'GIF89a'].includes(header.subarray(0, 6).toString('ascii'))
    case '.webp': return header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP'
    case '.txt':
    case '.csv': return !header.includes(0)
    default: return false
  }
}

async function isUtf8TextFile(filePath: string): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    for await (const chunk of createReadStream(filePath)) {
      const contents = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (contents.includes(0)) return false
      decoder.decode(contents, { stream: true })
    }
    decoder.decode()
    return true
  } catch {
    return false
  }
}

function isWithinStorage(filePath: string): boolean {
  return filePath.startsWith(`${STORAGE_DIRECTORY}${sep}`)
}

function uploadError(message: string, statusCode = 400): Error {
  const error = new Error(message)
  Object.assign(error, { statusCode })
  return error
}
