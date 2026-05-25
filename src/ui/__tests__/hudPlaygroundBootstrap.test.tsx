import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HudPlaygroundBootstrap } from '../HudPlaygroundBootstrap'

describe('HudPlaygroundBootstrap', () => {
  it('renders the component name in the visible preview UI', () => {
    const markup = renderToStaticMarkup(
      <HudPlaygroundBootstrap
        title="Angular Rates"
        initialParams={{ value: 1 }}
        configure={() => {}}
      >
        {() => <div>Preview</div>}
      </HudPlaygroundBootstrap>
    )

    expect(markup).toContain('Angular Rates')
  })
})
