import { useSyncExternalStore } from 'react'
import { getFaultControlState, subscribeFaultControl } from './faultControl'
import { getLabState, subscribeLab } from './statusClient'

export const useLab = () => useSyncExternalStore(subscribeLab, getLabState)
export const useFaultControl = () => useSyncExternalStore(subscribeFaultControl, getFaultControlState)
