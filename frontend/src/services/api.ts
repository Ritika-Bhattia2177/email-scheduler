import axios, { isAxiosError } from 'axios'

const configuredBaseUrl = import.meta.env.PROD
  ? import.meta.env.VITE_API_URL?.trim() || 'https://email-scheduler-backend-7x2p.onrender.com/api'
  : import.meta.env.VITE_API_URL?.trim() || 'http://localhost:5000/api'

export const api = axios.create({
  baseURL: configuredBaseUrl.replace(/\/$/, ''),
  withCredentials: true,
  headers: { Accept: 'application/json' },
})

api.interceptors.request.use(config => {
  const developmentUserId = import.meta.env.DEV ? import.meta.env.VITE_DEV_USER_ID?.trim() : undefined
  if (developmentUserId) config.headers.set('x-user-id', developmentUserId)
  return config
})

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiSuccessEnvelope<T> {
  success: true
  data: T
  message?: string
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface ApiFailureEnvelope {
  success: false
  message: string
  data?: never
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiFailureEnvelope

export async function getData<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  return (await getEnvelope<T>(path, params)).data
}

export async function getBlob(path: string): Promise<Blob> {
  try {
    return (await api.get<Blob>(path, { responseType: 'blob' })).data
  } catch (error) {
    throw toApiError(error)
  }
}

export async function getEnvelope<T>(path: string, params?: Record<string, string | number>): Promise<ApiSuccessEnvelope<T>> {
  try {
    const response = await api.get<ApiEnvelope<T>>(path, { params })
    if (!response.data.success) throw new ApiError(response.data.message)
    return response.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw toApiError(error)
  }
}

export async function postData<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  try {
    const response = await api.post<ApiEnvelope<T>>(path, body, { headers })
    if (!response.data.success) throw new ApiError(response.data.message)
    return response.data.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw toApiError(error)
  }
}

export function getApiErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'
}

function toApiError(error: unknown): ApiError {
  if (isAxiosError<unknown>(error)) {
    const status = error.response?.status
    if (status === 401) {
      const message = import.meta.env.DEV
        ? 'Authentication failed. Check VITE_DEV_USER_ID or sign in again.'
        : 'Authentication is required. Please sign in again.'
      return new ApiError(message, status)
    }
    if (status === 403) return new ApiError('You do not have permission to perform this action.', status)
    if (status === 429) return new ApiError('Too many requests. Please wait and try again.', status)
    if (status === 503) return new ApiError('A required service is temporarily unavailable. Please try again.', status)
    if (status && status >= 500) return new ApiError('The backend could not complete the request. Please try again.', status)
    const message = readServerMessage(error.response?.data)
    if (message) return new ApiError(message, status)
    if (status === 404) return new ApiError('The requested record was not found.', status)
    if (!error.response) return new ApiError('Cannot reach the backend. Check that it is running and VITE_API_URL is correct.')
    return new ApiError('The request could not be completed.', status)
  }
  return new ApiError('Something went wrong. Please try again.')
}

function readServerMessage(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('message' in value)) return undefined
  const message = value.message
  return typeof message === 'string' && message.trim() ? message : undefined
}
