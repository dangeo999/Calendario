// src/app/lib/notify/types.ts
import type { ApprovalDecision } from '@/app/lib/approvals'

export type ApprovalRequest = {
  eventId: string
  requesterName: string
  typeLabel: string
  periodLabel: string
  detailLabel: string
  note?: string | null
  approveUrl: string
  rejectUrl: string
}

export type DecisionNotice = {
  eventId: string
  requesterName: string
  typeLabel: string
  periodLabel: string
  decision: ApprovalDecision
}

export interface NotificationChannel {
  /** Identificativo salvato in events.decision_channel / usato nei log. */
  readonly name: string
  /** true se tutte le env var necessarie sono presenti. */
  isConfigured(): boolean
  /** Invia la richiesta di approvazione al responsabile. */
  sendApprovalRequest(req: ApprovalRequest): Promise<void>
  /** Conferma al responsabile dopo la sua decisione. Opzionale. */
  sendDecisionAck?(notice: DecisionNotice): Promise<void>
}
