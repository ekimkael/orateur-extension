import type { ReactNode } from "react"
import { useTranslation } from "../../hooks/useTranslation"

interface NavItem {
  id: string
  labelKey: string
  icon: ReactNode
}

const ITEMS: NavItem[] = [
  {
    id: "general",
    labelKey: "optionsSectionGeneral",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
      </svg>
    ),
  },
  {
    id: "sites",
    labelKey: "optionsSectionSites",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
      </svg>
    ),
  },
  {
    id: "voix",
    labelKey: "optionsSectionVoice",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3" />
      </svg>
    ),
  },
  {
    id: "prononciation",
    labelKey: "optionsSectionPronunciation",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4zM14 7a3 3 0 0 1 3-3h3v14h-2a4 4 0 0 0-4 3" />
      </svg>
    ),
  },
  {
    id: "modele",
    labelKey: "optionsSectionModel",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" x2="12" y1="15" y2="3" />
      </svg>
    ),
  },
  {
    id: "confidentialite",
    labelKey: "optionsSectionPrivacy",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      </svg>
    ),
  },
]

export function getSettingsSection() {
  const id = window.location.hash.slice(1)
  return ITEMS.find((item) => item.id === id)?.id ?? ITEMS[0]!.id
}

export function SettingsNav({ activeSection }: { activeSection: string }) {
  const t = useTranslation()

  return (
    <aside className="sidebar">
      <nav aria-label={t("optionsNavLabel")}>
        {ITEMS.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={item.id === activeSection ? "true" : undefined}
            onClick={(event) => {
              if (item.id === activeSection && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                event.preventDefault()
              }
            }}
          >
            {item.icon}
            <span>{t(item.labelKey)}</span>
          </a>
        ))}
      </nav>
    </aside>
  )
}
