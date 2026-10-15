import type { DemoDefinition } from '../definition.ts'
import { queueingKnee } from './queueingKnee.ts'
import { retryStorms } from './retryStorms.ts'

/** Simulated demos, in index order. Each gets a page at /demos/<slug>/ (see demos/<slug>/index.html). */
export const CONCEPTS: readonly DemoDefinition[] = [queueingKnee, retryStorms]
