import { BusinessRuleError } from './errors';

/**
 * Máquina de estados declarativa. Cada domínio define UMA tabela de transições
 * e toda mudança de status passa por `assertTransition` — nada de
 * `if (status === ...)` espalhado pelo código.
 */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  canTransition(from: S, to: S): boolean;
  assertTransition(from: S, to: S): void;
  allowedFrom(from: S): readonly S[];
  isTerminal(state: S): boolean;
}

export function defineStateMachine<S extends string>(name: string, table: TransitionTable<S>): StateMachine<S> {
  const states = Object.keys(table) as S[];
  for (const [from, targets] of Object.entries(table) as [S, readonly S[]][]) {
    for (const to of targets) {
      if (!(to in table)) throw new Error(`[${name}] estado de destino desconhecido: ${from} -> ${to}`);
    }
  }
  const canTransition = (from: S, to: S) => (table[from] ?? []).includes(to);
  return {
    name,
    states,
    canTransition,
    allowedFrom: (from) => table[from] ?? [],
    isTerminal: (state) => (table[state] ?? []).length === 0,
    assertTransition(from, to) {
      if (!canTransition(from, to)) {
        throw new BusinessRuleError(`Transição inválida de ${from} para ${to}.`, { machine: name, from, to });
      }
    },
  };
}
