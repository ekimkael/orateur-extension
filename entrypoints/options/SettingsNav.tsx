import { useEffect, useState, type ReactNode } from "react"
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
    id: "voix",
    labelKey: "optionsSectionVoice",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3" />
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

/**
 * De simples `<a href="#id">` — pas de routage, `scroll-behavior: smooth` de
 * style.css fait le défilement. Le seul JS ici : marquer la section visible
 * la plus haute comme active dans la nav pendant le défilement manuel.
 */
export function SettingsNav() {
  const t = useTranslation()
  const [active, setActive] = useState(ITEMS[0]!.id)

  useEffect(() => {
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        const next = ITEMS.find((item) => visible.has(item.id))
        if (next) setActive(next.id)
      },
      { rootMargin: "-15% 0px -65% 0px" },
    )
    for (const item of ITEMS) {
      const el = document.getElementById(item.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <aside className="sidebar">
      <nav aria-label={t("optionsNavLabel")}>
        {ITEMS.map((item) => (
          <a key={item.id} href={`#${item.id}`} aria-current={item.id === active ? "true" : undefined}>
            {item.icon}
            <span>{t(item.labelKey)}</span>
          </a>
        ))}
      </nav>
    </aside>
  )
}
