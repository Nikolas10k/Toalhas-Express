import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@/server/core/errors';
import {
  ROUTE_STATUSES,
  STOP_STATUSES,
  assertCanFinish,
  assertCapacity,
  assertPermutation,
  haversineMeters,
  navigationUrl,
  routeStateMachine,
  stopStateMachine,
  straightLineTotal,
} from '@/server/modules/routes/routes.domain';
import { formatPlate, normalizePlate } from '@/lib/br/plate';

describe('máquina de estados da rota (SPEC §7)', () => {
  const table: Record<string, string[]> = { PLANNED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [] };
  it('aceita exatamente as transições da tabela', () => {
    for (const from of ROUTE_STATUSES) for (const to of ROUTE_STATUSES) expect(routeStateMachine.canTransition(from, to), `${from}→${to}`).toBe(table[from]!.includes(to));
  });
});

describe('máquina de estados da parada', () => {
  it('estados finais não saem e não se pula a chegada', () => {
    for (const s of ['COMPLETED', 'FAILED', 'SKIPPED', 'RESCHEDULED'] as const) expect(stopStateMachine.isTerminal(s)).toBe(true);
    expect(stopStateMachine.canTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(stopStateMachine.canTransition('ON_THE_WAY', 'COMPLETED')).toBe(false);
    expect(stopStateMachine.canTransition('ARRIVED', 'ON_THE_WAY')).toBe(false);
    expect(stopStateMachine.canTransition('ON_THE_WAY', 'PENDING')).toBe(true);
    expect(STOP_STATUSES).toHaveLength(8);
  });
  it('rota só termina sem paradas abertas', () => {
    expect(() => assertCanFinish([{ status: 'COMPLETED' }, { status: 'ARRIVED' }])).toThrow(/1 parada/);
    expect(() => assertCanFinish([{ status: 'COMPLETED' }, { status: 'FAILED' }, { status: 'SKIPPED' }])).not.toThrow();
  });
});

describe('regras de planejamento', () => {
  it('capacidade do veículo', () => {
    expect(() => assertCapacity(100, 101)).toThrow(BusinessRuleError);
    expect(() => assertCapacity(100, 100)).not.toThrow();
  });
  it('reordenação precisa ser permutação exata', () => {
    expect(() => assertPermutation(['a', 'b'], ['b', 'a'])).not.toThrow();
    expect(() => assertPermutation(['a', 'b'], ['a', 'a'])).toThrow();
    expect(() => assertPermutation(['a', 'b'], ['a', 'b', 'c'])).toThrow();
  });
  it('distância em linha reta (SP → Campinas ≈ 84 km) e total só com todos os pontos', () => {
    const sp = { lat: -23.5505, lng: -46.6333 };
    const cps = { lat: -22.9056, lng: -47.0608 };
    expect(haversineMeters(sp, cps)).toBeGreaterThan(80_000);
    expect(haversineMeters(sp, cps)).toBeLessThan(90_000);
    expect(straightLineTotal([sp, cps, sp])).toBe(2 * haversineMeters(sp, cps));
    expect(straightLineTotal([sp, null])).toBeNull();
  });
  it('link de navegação usa coordenadas quando há, senão o endereço', () => {
    expect(navigationUrl({ lat: -23.5, lng: -46.6 }, 'x')).toContain('destination=-23.5%2C-46.6');
    expect(navigationUrl(null, 'Rua A, 10')).toContain('destination=Rua%20A%2C%2010');
  });
});

describe('placa', () => {
  it('aceita antiga e Mercosul, com ou sem hífen', () => {
    expect(normalizePlate('abc-1234')).toBe('ABC1234');
    expect(normalizePlate('BRA2E19')).toBe('BRA2E19');
    expect(normalizePlate('AB12345')).toBeNull();
    expect(formatPlate('ABC1234')).toBe('ABC-1234');
    expect(formatPlate('BRA2E19')).toBe('BRA2E19');
  });
});
