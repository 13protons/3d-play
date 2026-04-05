import { useModeStore } from './state/mode'
import { startSim } from './state/bridge'
import { MainMenu } from './ui/MainMenu'
import { Flight } from './modes/Flight'

export default function App() {
  const view = useModeStore((s) => s.view)
  const enterFlight = useModeStore((s) => s.enterFlight)

  async function handleLaunch(scenarioId: string) {
    await startSim(scenarioId)
    enterFlight(scenarioId)
  }

  if (view === 'menu') {
    return <MainMenu onLaunch={handleLaunch} />
  }

  return <Flight />
}
