import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@/server/core/errors';
import { defineStateMachine } from '@/server/core/state-machine';
import { jobStateMachine, JOB_STATUSES } from '@/server/modules/jobs/jobs.domain';

type S = 'A' | 'B' | 'C';
const sm = defineStateMachine<S>('test', { A: ['B'], B: ['C', 'A'], C: [] });

describe('defineStateMachine', () => {
  it('aceita apenas transições da tabela', () => {
    expect(sm.canTransition('A', 'B')).toBe(true);
    expect(sm.canTransition('A', 'C')).toBe(false);
    expect(() => sm.assertTransition('A', 'C')).toThrow(BusinessRuleError);
    expect(() => sm.assertTransition('B', 'C')).not.toThrow();
  });

  it('identifica estados terminais', () => {
    expect(sm.isTerminal('C')).toBe(true);
    expect(sm.isTerminal('A')).toBe(false);
  });

  it('rejeita tabela com destino desconhecido', () => {
    expect(() => defineStateMachine('bad', { A: ['Z' as 'A'] })).toThrow(/desconhecido/);
  });

  it('rejeita toda transição fora da tabela (varredura exaustiva)', () => {
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        const allowed = jobStateMachine.allowedFrom(from).includes(to);
        expect(jobStateMachine.canTransition(from, to)).toBe(allowed);
      }
    }
    expect(jobStateMachine.canTransition('SUCCEEDED', 'PENDING')).toBe(false);
  });
});
