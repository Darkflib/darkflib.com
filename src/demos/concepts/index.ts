import type { DemoDefinition } from '../definition.ts'
import { autoscaler } from './autoscaler.ts'
import { breakingTheLoop } from './breakingTheLoop.ts'
import { overload } from './overload.ts'
import { queueingKnee } from './queueingKnee.ts'
import { retryStorms } from './retryStorms.ts'
import { sandbox } from './sandbox.ts'

/** Simulated demos, in index order. Each gets a page at /demos/<slug>/ (see demos/<slug>/index.html). */
export const CONCEPTS: readonly DemoDefinition[] = [
  queueingKnee,
  overload,
  autoscaler,
  retryStorms,
  breakingTheLoop,
  sandbox,
]
