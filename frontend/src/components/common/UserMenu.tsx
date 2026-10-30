import { ChevronDown, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { logout } from '../../auth'

export interface UserMenuProps {
  name: string
  email?: string
  avatarUrl?: string | null
}

export default function UserMenu({ name, email, avatarUrl }: UserMenuProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [error, setError] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => setAvatarFailed(false), [avatarUrl])

  const initial = name.trim().charAt(0).toLocaleUpperCase() || email?.trim().charAt(0).toLocaleUpperCase() || '?'

  async function handleLogout() {
    setIsLoggingOut(true)
    setError(false)
    try {
      await logout()
      window.location.assign('/login')
    } catch {
      setError(true)
      setIsLoggingOut(false)
    }
  }

  return (
    <div className="user-menu-container">
      <button className="user-menu" type="button" onClick={() => setMenuOpen(open => !open)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Account menu for ${name}`}>
        <span className="user-menu-avatar" aria-hidden="true">
          {avatarUrl && !avatarFailed
            ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} />
            : <span>{initial}</span>}
        </span>
        <span className="user-menu-copy"><strong>{name}</strong>{email && <small>{email}</small>}</span>
        <ChevronDown className="user-menu-chevron" size={14} />
      </button>
      {menuOpen && <div className="user-menu-popover" role="menu" aria-label="Account options">
        <button className="user-menu-logout" type="button" role="menuitem" onClick={() => void handleLogout()} disabled={isLoggingOut}>
          <LogOut size={15} aria-hidden="true" />
          <span>{isLoggingOut ? 'Signing out…' : 'Logout'}</span>
        </button>
      </div>}
      {error && <p className="login-description" role="alert">Could not sign out. Please try again.</p>}
    </div>
  )
}
