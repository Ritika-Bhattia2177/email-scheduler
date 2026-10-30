import { api, getData, postData } from './services/api'

export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  try {
    return await getData<AuthenticatedUser>('/auth/me')
  } catch {
    return null
  }
}

export function getGoogleSignInUrl(): string {
  const baseUrl = api.defaults.baseURL ?? 'http://localhost:5000/api'
  return `${baseUrl.replace(/\/$/, '')}/auth/google`
}

export async function logout(): Promise<void> {
  await postData<void>('/auth/logout')
}
