import { SiteShell } from '../../components/SiteShell'
import type { DemoDefinition } from '../definition.ts'
import { SimulatedDemo } from '../ui/SimulatedDemo'

export function SimulatedDemoPage({ def }: { def: DemoDefinition }) {
  return (
    <SiteShell page="demos">
      <SimulatedDemo def={def} />
    </SiteShell>
  )
}
