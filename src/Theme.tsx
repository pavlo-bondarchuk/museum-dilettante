import React, { createContext, useContext, useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'

type Theme = 'light' | 'dark'
type ThemeContextValue = { theme: Theme; toggleTheme: () => void }
const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'md-theme'
const LEGACY_KEY = 'md-host-theme'
export const MUSEUM_LOGO = 'https://cdn.prod.website-files.com/65a126447c08c162c916fa2c/65b24c24460c29664e2a1755_ONFAM-Logo.svg'

function getStoredTheme(): Theme {
  try {
    const setting = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY)
    return setting === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getStoredTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === LEGACY_KEY || event.key === null) setTheme(getStoredTheme())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const toggleTheme = () => {
    setTheme(current => {
      const next = current === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem(STORAGE_KEY, next) } catch { }
      return next
    })
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useMuseumTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('ThemeProvider is missing')
  return context
}

export function ThemeToggle() {
  const {theme,toggleTheme} = useMuseumTheme()
  return <button type="button" className="host-theme-toggle" aria-label={theme === 'dark' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'} aria-pressed={theme === 'light'} title={theme === 'dark' ? 'Світла тема' : 'Темна тема'} onClick={toggleTheme}>
    {theme === 'dark' ? <Sun size={19} aria-hidden="true"/> : <Moon size={19} aria-hidden="true"/>}
    <span>{theme === 'dark' ? 'Світла тема' : 'Темна тема'}</span>
  </button>
}

export function MuseumBrand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className={'brand brand-with-logo'+(compact?' brand-compact':'')} aria-label="Музейний дилетант — на головну">
    <img className="onfam-logo" src={MUSEUM_LOGO} alt="Логотип Одеського національного художнього музею" decoding="async"/>
    <span className="brand-divider" aria-hidden="true"/>
    <span className="brand-title">МУЗЕЙНИЙ<br/><b>ДИЛЕТАНТ</b></span>
  </Link>
}
