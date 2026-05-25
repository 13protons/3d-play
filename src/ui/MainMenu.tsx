import { mainMenuLinks, scenarios } from '../appRoutes'

interface MainMenuProps {
  onLaunch: (scenarioId: string) => void
}

export function MainMenu({ onLaunch }: MainMenuProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0a0a12',
        color: 'white',
        fontFamily: 'monospace',
      }}
    >
      <h1 style={{ fontSize: 48, fontWeight: 300, marginBottom: 8 }}>
        Solar
      </h1>
      <p style={{ opacity: 0.5, marginBottom: 48 }}>
        n-body orbital mechanics
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            onClick={() => onLaunch(scenario.id)}
            style={{
              padding: '12px 32px',
              fontSize: 16,
              background: 'rgba(100,180,255,0.15)',
              color: 'white',
              border: '1px solid rgba(100,180,255,0.4)',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'monospace',
            }}
          >
            {scenario.label}
          </button>
        ))}
        {mainMenuLinks.map((link) => (
          <a
            key={link.path}
            href={link.path}
            style={{
              padding: '10px 32px',
              fontSize: 13,
              background: 'rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.78)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'monospace',
              textAlign: 'center',
              textDecoration: 'none',
            }}
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  )
}
