import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { useEffect } from 'react'
import { useNow } from '../hooks/useNow'
import type { LabTargetId } from '../lab/config'
import {
  configureFaultControl,
  DEFAULT_SPEC,
  type FaultChoice,
  type FaultSpec,
  faultLabAvailability,
  resetFaults,
  setFaultSpec,
} from '../lab/faultControl'
import { useFaultControl, useLab } from '../lab/hooks'
import { type SystemStatus, setStatusClientActive, type TargetView } from '../lab/statusClient'
import type { FaultRule } from '../sw/protocol'
import { useServiceWorker } from '../telemetry/serviceWorker'
import { PanelHeader } from './PanelHeader'
import './FaultLab.css'

const STATUS_LABELS: Record<SystemStatus, string> = {
  starting: 'STARTING',
  idle: 'IDLE',
  healthy: 'HEALTHY',
  failover: 'FAILOVER',
  stale: 'STALE DATA',
  down: 'DOWN',
}

const CHOICES: { value: FaultChoice; label: string }[] = [
  { value: 'none', label: 'NONE' },
  { value: 'offline', label: 'OFFLINE' },
  { value: 'latency', label: 'LATENCY' },
  { value: 'http-503', label: 'HTTP 503' },
  { value: 'http-429', label: 'HTTP 429' },
]
const LATENCIES = [250, 800, 2500, 5000]
const RETRY_AFTERS = [1, 2, 10]
const PROBABILITIES = [1, 0.5, 0.2]

const host = (origin: string) => new URL(origin).host

function describeApplied(rule: FaultRule | undefined): string {
  if (!rule) return '—'
  const share = rule.probability < 1 ? ` ${Math.round(rule.probability * 100)}%` : ''
  switch (rule.mode) {
    case 'offline':
      return `ACTIVE · OFFLINE${share}`
    case 'latency':
      return `ACTIVE · +${rule.latencyMs} MS${share}`
    case 'status':
      return `ACTIVE · HTTP ${rule.status}${share}`
  }
}

interface TargetRowProps {
  target: TargetView
  spec: FaultSpec
  applied: FaultRule | undefined
  rejected: string | undefined
  disabled: boolean
}

function TargetRow({ target, spec, applied, rejected, disabled }: TargetRowProps) {
  const update = (patch: Partial<FaultSpec>) => setFaultSpec(target.id, { ...spec, ...patch })
  return (
    <tr data-testid={`lab-target-${target.id}`}>
      <th scope="row">
        <span className="lab-target-label">{target.label}</span>
        <span className="lab-target-host">{host(target.origin)}</span>
      </th>
      <td
        className={target.lastOk === null ? '' : target.lastOk ? 'lab-ok' : 'lab-fail'}
        data-testid={`lab-view-${target.id}`}
      >
        {target.lastOutcome ?? 'waiting…'}
      </td>
      <td>
        <span className={`lab-circuit circuit-${target.circuit}`} data-testid={`lab-circuit-${target.id}`}>
          {target.circuit.toUpperCase()}
        </span>
      </td>
      <td>
        <div className="lab-controls">
          <select
            aria-label={`Fault for ${target.label}`}
            value={spec.choice}
            disabled={disabled}
            onChange={(event) => update({ choice: event.target.value as FaultChoice })}
          >
            {CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          {spec.choice === 'latency' && (
            <select
              aria-label={`Latency for ${target.label}`}
              value={spec.latencyMs}
              disabled={disabled}
              onChange={(event) => update({ latencyMs: Number(event.target.value) })}
            >
              {LATENCIES.map((ms) => (
                <option key={ms} value={ms}>
                  +{ms} MS
                </option>
              ))}
            </select>
          )}
          {(spec.choice === 'http-503' || spec.choice === 'http-429') && (
            <select
              aria-label={`Retry-After for ${target.label}`}
              value={spec.retryAfterSeconds}
              disabled={disabled}
              onChange={(event) => update({ retryAfterSeconds: Number(event.target.value) })}
            >
              {RETRY_AFTERS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  RETRY-AFTER {seconds} S
                </option>
              ))}
            </select>
          )}
          {spec.choice !== 'none' && (
            <select
              aria-label={`Probability for ${target.label}`}
              value={spec.probability}
              disabled={disabled}
              onChange={(event) => update({ probability: Number(event.target.value) })}
            >
              {PROBABILITIES.map((probability) => (
                <option key={probability} value={probability}>
                  {Math.round(probability * 100)}%
                </option>
              ))}
            </select>
          )}
        </div>
      </td>
      <td className={applied ? 'lab-applied' : ''} data-testid={`lab-applied-${target.id}`} title={rejected}>
        {rejected ? `REJECTED · ${rejected}` : describeApplied(applied)}
      </td>
    </tr>
  )
}

interface FaultLabProps {
  open: boolean
  onToggle: () => void
}

export function FaultLab({ open, onToggle }: FaultLabProps) {
  const lab = useLab()
  const faults = useFaultControl()
  const worker = useServiceWorker()
  const now = useNow()
  const availability = faultLabAvailability(worker)

  useEffect(() => setStatusClientActive(open), [open])
  useEffect(() => {
    if (lab.config) configureFaultControl(lab.config)
  }, [lab.config])

  const anyFault = faults.applied.length > 0 || Object.values(faults.specs).some((spec) => spec?.choice !== 'none')
  const activeCount = faults.applied.length

  return (
    <section
      className={open ? 'panel fault-lab' : 'panel fault-lab collapsed'}
      id="fault-lab"
      aria-labelledby="fault-lab-title"
    >
      <PanelHeader id="fault-lab-title" title="FAULT_LAB" meta={<span className="lab-badge">LOCAL SIMULATION</span>}>
        <div className="lab-header-actions">
          {!open && activeCount > 0 && (
            <span className="lab-active-count" data-testid="lab-active-count">
              {activeCount} {activeCount === 1 ? 'FAULT' : 'FAULTS'} ACTIVE
            </span>
          )}
          {open && (
            <button
              type="button"
              className="lab-reset"
              onClick={resetFaults}
              disabled={!availability.ok || !anyFault || faults.pending}
            >
              <RotateCcw size={12} /> RESET LAB
            </button>
          )}
          <button
            type="button"
            className="lab-expand"
            aria-expanded={open}
            aria-controls="fault-lab-body"
            onClick={onToggle}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {open ? 'COLLAPSE' : 'EXPAND'}
          </button>
        </div>
      </PanelHeader>
      {!open && (
        <p className="lab-note">
          Break this page's own API calls from inside your browser, and watch the client retry, trip its circuit
          breaker, and fail over.
        </p>
      )}
      {open && <FaultLabBody lab={lab} faults={faults} availability={availability} now={now} />}
    </section>
  )
}

interface FaultLabBodyProps {
  lab: ReturnType<typeof useLab>
  faults: ReturnType<typeof useFaultControl>
  availability: ReturnType<typeof faultLabAvailability>
  now: number
}

function FaultLabBody({ lab, faults, availability, now }: FaultLabBodyProps) {
  const targets = (['api-primary', 'api-secondary', 'media'] as LabTargetId[])
    .map((id) => lab.targets[id])
    .filter((target): target is TargetView => target !== undefined)
  const servedBy = lab.servedBy ? lab.targets[lab.servedBy] : undefined

  return (
    <div id="fault-lab-body">
      <p className="lab-note">
        Faults are injected by this tab's service worker, into this tab's requests only. The origins stay healthy for
        everyone else; the status client below recovers on its own, as it would from a real outage.
      </p>
      {!availability.ok && (
        <p className="lab-unavailable" data-testid="lab-unavailable">
          {availability.reason}
        </p>
      )}
      {lab.configError && <p className="lab-unavailable">Lab configuration failed to load: {lab.configError}</p>}
      {faults.error && <p className="lab-unavailable">Could not apply faults: {faults.error}</p>}
      <div className="lab-body">
        <div className="lab-system">
          <span className="lab-caption">SYSTEM STATE</span>
          <strong className={`lab-state state-${lab.status}`} data-testid="lab-state">
            {STATUS_LABELS[lab.status]}
          </strong>
          <dl>
            <div>
              <dt>SERVED BY</dt>
              <dd data-testid="lab-served-by">{servedBy ? `${servedBy.label} · ${host(servedBy.origin)}` : '—'}</dd>
            </div>
            <div>
              <dt>DATA AGE</dt>
              <dd>{lab.lastGoodAt === null ? '—' : `${Math.max(0, Math.round((now - lab.lastGoodAt) / 1000))} S`}</dd>
            </div>
            <div>
              <dt>MEDIA</dt>
              <dd data-testid="lab-media">{lab.media.toUpperCase()}</dd>
            </div>
          </dl>
        </div>
        <div className="lab-targets-wrap">
          <table className="lab-targets">
            <thead>
              <tr>
                <th scope="col">SYSTEM</th>
                <th scope="col">CLIENT VIEW</th>
                <th scope="col">CIRCUIT</th>
                <th scope="col">INJECT</th>
                <th scope="col">WORKER</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => (
                <TargetRow
                  key={target.id}
                  target={target}
                  spec={faults.specs[target.id] ?? DEFAULT_SPEC}
                  applied={faults.applied.find((rule) => rule.origin === target.origin)}
                  rejected={faults.rejected.find((entry) => entry.origin === target.origin)?.reason}
                  disabled={!availability.ok || faults.pending}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
