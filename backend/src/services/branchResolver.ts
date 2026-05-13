import { db } from './storage';

export type BranchType = 'if_connected' | 'if_not_connected' | 'if_replied' | 'if_not_replied';

export interface BranchStep {
  branch_type: BranchType | null;
  branch_condition_days: number;
  next_step_true_id: string | null;
  next_step_false_id: string | null;
}

export interface BranchLead {
  id: string;
  connected_at: number | null;
  connection_sent_at: number | null;
  last_message_at: number | null;
}

export type BranchResult =
  | { action: 'linear' }
  | { action: 'jump'; next_step_id: string }
  | { action: 'wait' };

/**
 * Determine the next routing decision for a branch step.
 * Pure function: reads DB only, no Playwright, no external calls.
 */
export function resolveBranch(step: BranchStep, lead: BranchLead): BranchResult {
  if (!step.branch_type) {
    return { action: 'linear' };
  }

  const now = Math.floor(Date.now() / 1000);
  const conditionDays = step.branch_condition_days || 0;
  const conditionSeconds = conditionDays * 86400;

  let conditionTrue = false;
  let canResolve = true;

  switch (step.branch_type) {
    case 'if_connected': {
      conditionTrue = lead.connected_at != null;
      if (!conditionTrue && lead.connection_sent_at) {
        const elapsed = now - lead.connection_sent_at;
        if (conditionDays > 0 && elapsed < conditionSeconds) {
          canResolve = false;
        }
      }
      break;
    }
    case 'if_not_connected': {
      conditionTrue = lead.connected_at == null;
      if (lead.connection_sent_at && conditionDays > 0) {
        const elapsed = now - lead.connection_sent_at;
        if (elapsed < conditionSeconds) {
          canResolve = false;
        }
      }
      break;
    }
    case 'if_replied': {
      const inbound = db.prepare(
        "SELECT id FROM inbox_messages WHERE lead_id = ? AND direction = 'in' LIMIT 1"
      ).get(lead.id) as { id: string } | undefined;
      conditionTrue = inbound != null;
      break;
    }
    case 'if_not_replied': {
      const inbound = db.prepare(
        "SELECT id FROM inbox_messages WHERE lead_id = ? AND direction = 'in' LIMIT 1"
      ).get(lead.id) as { id: string } | undefined;
      conditionTrue = inbound == null;
      if (conditionTrue && lead.last_message_at && conditionDays > 0) {
        const elapsed = now - lead.last_message_at;
        if (elapsed < conditionSeconds) {
          canResolve = false;
        }
      }
      break;
    }
  }

  if (!canResolve) {
    return { action: 'wait' };
  }

  const nextId = conditionTrue ? step.next_step_true_id : step.next_step_false_id;

  if (!nextId) {
    return { action: 'linear' };
  }

  return { action: 'jump', next_step_id: nextId };
}
