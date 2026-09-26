import { beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { AuthorizationError, BusinessRuleError, ConflictError, InventoryError, StepUpRequiredError } from '@/server/core/errors';
import { withActorTransaction } from '@/server/db/transaction';
import { resolveUserActor } from '@/server/modules/access/access.service';
import { createCustomer } from '@/server/modules/customers/customers.service';
import { checkInventoryConsistency } from '@/server/modules/inventory/consistency.service';
import type { MovementInput } from '@/server/modules/inventory/inventory.domain';
import {
  createProduct,
  executeStockOperation,
  getCustomerBalances,
  getStockOverview,
  previewStockOperation,
  recordMovements,
  reverseMovement,
} from '@/server/modules/inventory/inventory.service';
import { customerCreateSchema } from '@/lib/validation/customers';
import { nextCnpj } from '../helpers/documents';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let admin: UserActor;
let manager: UserActor;
let driver: UserActor;

const now = () => Math.floor(Date.now() / 1000);

async function actor(roles: string[], mfa = false) {
  const { userId } = await createUserInOrg(org, roles);
  return (await resolveUserActor({ userId, aal: mfa ? 'aal2' : 'aal1', lastTotpAt: mfa ? now() : undefined }, org))!;
}

async function newProduct(sku: string, extra: Record<string, unknown> = {}) {
  const { id } = await createProduct(admin, {
    sku,
    name: `Toalha ${sku}`,
    size: '70x140',
    category: 'Banho',
    costCents: 2500,
    replacementPriceCents: 1500,
    minStock: 0,
    active: true,
    ...extra,
  } as never);
  return id;
}

async function newCustomer() {
  const { id } = await createCustomer(
    admin,
    customerCreateSchema.parse({ personType: 'PJ', legalName: 'Salão Teste', document: nextCnpj() }),
  );
  return id;
}

async function move(a: UserActor, inputs: MovementInput[]) {
  return withActorTransaction({ type: 'USER', userId: a.userId, organizationId: org }, (tx) => recordMovements(tx, a, inputs));
}

async function stock(productId: string) {
  const o = await getStockOverview(admin);
  return o.products.find((p) => p.id === productId)!.stock;
}

beforeAll(async () => {
  org = await createOrg('inv');
  admin = await actor(['ADMIN'], true);
  manager = await actor(['MANAGER']);
  driver = await actor(['DRIVER']);
});

describe('ledger de estoque — critérios de aceite da SPEC §14', () => {
  it('1000 → entrega 100 → coleta 80 → lavagem: nenhuma toalha some', async () => {
    const p = await newProduct('ACEITE-1');
    const c = await newCustomer();
    await executeStockOperation(admin, { kind: 'entry', productId: p, quantity: 1000, reason: 'Compra inicial' });

    // Entrega: reserva → saída para rota → entrega ao cliente.
    await move(admin, [
      { productId: p, type: 'RESERVATION', quantity: 100, from: 'AVAILABLE', to: 'RESERVED' },
      { productId: p, type: 'DELIVERY_DISPATCH', quantity: 100, from: 'RESERVED', to: 'IN_ROUTE' },
      { productId: p, type: 'DELIVERY', quantity: 100, from: 'IN_ROUTE', to: 'WITH_CUSTOMER', customerId: c },
    ]);
    let s = await stock(p);
    expect(s.byState.AVAILABLE).toBe(900);
    expect(s.byState.WITH_CUSTOMER).toBe(100);
    expect(s.total).toBe(1000);

    // Coleta 80: 20 continuam com o cliente, 80 aguardando lavagem.
    await move(admin, [{ productId: p, type: 'COLLECTION', quantity: 80, from: 'WITH_CUSTOMER', to: 'AWAITING_LAUNDRY', customerId: c }]);
    s = await stock(p);
    expect(s.byState.WITH_CUSTOMER).toBe(20);
    expect(s.byState.AWAITING_LAUNDRY).toBe(80);

    // Lavagem concluída: entrada → saída → inspeção aprovada → disponível.
    await move(admin, [
      { productId: p, type: 'LAUNDRY_ENTRY', quantity: 80, from: 'AWAITING_LAUNDRY', to: 'IN_LAUNDRY' },
      { productId: p, type: 'LAUNDRY_EXIT', quantity: 80, from: 'IN_LAUNDRY', to: 'IN_INSPECTION' },
      { productId: p, type: 'TRANSFER', quantity: 80, from: 'IN_INSPECTION', to: 'AVAILABLE' },
    ]);
    s = await stock(p);
    expect(s.byState.AVAILABLE).toBe(980);
    expect(s.byState.WITH_CUSTOMER).toBe(20);
    expect(s.total).toBe(1000);

    const balances = await getCustomerBalances(admin, c);
    expect(balances).toMatchObject([{ productId: p, quantity: 20 }]);
    expect(balances[0]!.lastDeliveryAt).not.toBeNull();
    expect(balances[0]!.lastCollectionAt).not.toBeNull();

    const check = await checkInventoryConsistency(org);
    expect(check.divergences).toBe(0);
  });

  it('concorrência: 100 em estoque e duas reservas simultâneas de 80 — só uma é confirmada', async () => {
    const p = await newProduct('ACEITE-2');
    await executeStockOperation(admin, { kind: 'entry', productId: p, quantity: 100, reason: 'Entrada teste' });
    const reserve = () =>
      withActorTransaction({ type: 'USER', userId: manager.userId, organizationId: org }, async (tx) => {
        const r = await recordMovements(tx, manager, [{ productId: p, type: 'RESERVATION', quantity: 80, from: 'AVAILABLE', to: 'RESERVED' }]);
        await tx`select pg_sleep(0.1)`;
        return r;
      });
    const results = await Promise.allSettled([reserve(), reserve()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(InventoryError);
    const s = await stock(p);
    expect(s.byState.AVAILABLE).toBe(20);
    expect(s.byState.RESERVED).toBe(80);
  });
});

describe('regras do ledger', () => {
  it('bloqueia saldo negativo, transição inválida e movimento de cliente sem cliente', async () => {
    const p = await newProduct('REGRA-1');
    await expect(move(admin, [{ productId: p, type: 'RESERVATION', quantity: 1, from: 'AVAILABLE', to: 'RESERVED' }])).rejects.toBeInstanceOf(InventoryError);
    await expect(move(admin, [{ productId: p, type: 'DELIVERY', quantity: 1, from: 'AVAILABLE', to: 'WITH_CUSTOMER', customerId: null }])).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(move(admin, [{ productId: p, type: 'STOCK_ENTRY', quantity: 0, from: 'EXTERNAL', to: 'AVAILABLE' }])).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(move(admin, [{ productId: p, type: 'DELIVERY', quantity: 1, from: 'IN_ROUTE', to: 'WITH_CUSTOMER' }])).rejects.toThrow(/cliente/);
  });

  it('operação composta é atômica: se um movimento falha, nenhum é gravado', async () => {
    const p = await newProduct('REGRA-2');
    await executeStockOperation(admin, { kind: 'entry', productId: p, quantity: 10, reason: 'Entrada teste' });
    await expect(
      move(admin, [
        { productId: p, type: 'RESERVATION', quantity: 5, from: 'AVAILABLE', to: 'RESERVED' },
        { productId: p, type: 'DELIVERY_DISPATCH', quantity: 50, from: 'RESERVED', to: 'IN_ROUTE' },
      ]),
    ).rejects.toBeInstanceOf(InventoryError);
    const s = await stock(p);
    expect(s.byState.AVAILABLE).toBe(10);
    expect(s.byState.RESERVED).toBe(0);
  });

  it('idempotência: mesmo movimento reenviado não duplica', async () => {
    const p = await newProduct('REGRA-3');
    const m: MovementInput = { productId: p, type: 'STOCK_ENTRY', quantity: 7, from: 'EXTERNAL', to: 'AVAILABLE', idempotencyKey: `entry-${p}` };
    const first = await move(admin, [m]);
    const second = await move(admin, [m]);
    expect(first.inserted).toHaveLength(1);
    expect(second).toEqual({ inserted: [], skipped: 1 });
    expect((await stock(p)).byState.AVAILABLE).toBe(7);
  });

  it('ledger e saldos não podem ser editados; o app não escreve em stock_balances', async () => {
    await expect(sql`update public.towel_movements set quantity = 1`).rejects.toThrow(/append-only/);
    await expect(sql`delete from public.towel_movements`).rejects.toThrow(/append-only/);
    await expect(
      withActorTransaction({ type: 'USER', userId: admin.userId, organizationId: org }, (tx) => tx`update public.stock_balances set quantity = 999`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('permissões', () => {
  it('motorista não faz entrada nem ajuste; gerente ajusta pouco, ajuste grande exige step-up', async () => {
    const p = await newProduct('PERM-1');
    await expect(executeStockOperation(driver, { kind: 'entry', productId: p, quantity: 5, reason: 'tentativa' })).rejects.toBeInstanceOf(AuthorizationError);
    await executeStockOperation(manager, { kind: 'adjust', productId: p, state: 'AVAILABLE', delta: 10, reason: 'Contagem física' });
    await expect(
      executeStockOperation(manager, { kind: 'adjust', productId: p, state: 'AVAILABLE', delta: 500, reason: 'Contagem física' }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const staleAdmin: UserActor = { ...admin, mfa: { ...admin.mfa, lastTotpAt: 1 } };
    await expect(
      executeStockOperation(staleAdmin, { kind: 'adjust', productId: p, state: 'AVAILABLE', delta: 500, reason: 'Contagem física' }),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
    await executeStockOperation(admin, { kind: 'adjust', productId: p, state: 'AVAILABLE', delta: 500, reason: 'Contagem física' });
    expect((await stock(p)).byState.AVAILABLE).toBe(510);
    const [audit] = await sql`select action from public.audit_logs where organization_id = ${org} and action = 'inventory.manual_adjustment' limit 1`;
    expect(audit).toBeTruthy();
  });

  it('ajuste de saldo do cliente e prévia de perda com valor de reposição', async () => {
    const p = await newProduct('PERM-2', { replacementPriceCents: 1500 });
    const c = await newCustomer();
    await executeStockOperation(admin, { kind: 'adjust', productId: p, state: 'WITH_CUSTOMER', delta: 40, customerId: c, reason: 'Saldo inicial migrado' });
    const preview = await previewStockOperation(admin, {
      kind: 'move', type: 'LOSS', productId: p, from: 'WITH_CUSTOMER', to: 'LOST', quantity: 30, customerId: c, reason: 'Cliente perdeu',
    });
    expect(preview).toMatchObject({
      from: { state: 'WITH_CUSTOMER', before: 40, after: 10 },
      to: { state: 'LOST', before: 0, after: 30 },
      replacementValueCents: 45000,
      blocked: null,
    });
    const blocked = await previewStockOperation(admin, {
      kind: 'move', type: 'LOSS', productId: p, from: 'WITH_CUSTOMER', to: 'LOST', quantity: 50, customerId: c, reason: 'Cliente perdeu',
    });
    expect(blocked.blocked).toMatch(/Saldo insuficiente/);
  });
});

describe('estorno e consistência', () => {
  it('estorno cria movimento inverso uma única vez', async () => {
    const p = await newProduct('EST-1');
    const { movementId } = await executeStockOperation(admin, { kind: 'entry', productId: p, quantity: 30, reason: 'Entrada errada' });
    await reverseMovement(admin, movementId!, 'Lançado em duplicidade');
    expect((await stock(p)).total).toBe(0);
    await expect(reverseMovement(admin, movementId!, 'de novo')).rejects.toBeInstanceOf(ConflictError);
  });

  it('cache adulterado gera alerta crítico; estoque baixo gera alerta sem duplicar', async () => {
    const p = await newProduct('CONS-1', { minStock: 50 });
    await executeStockOperation(admin, { kind: 'entry', productId: p, quantity: 10, reason: 'Entrada teste' });
    let r = await checkInventoryConsistency(org);
    expect(r.lowStock).toBeGreaterThan(0);
    const again = await checkInventoryConsistency(org);
    expect(again.opened).toBe(0); // alerta de estoque baixo não é duplicado

    // Simula corrupção do cache (ex.: alguém editou pelo SQL editor).
    await sql`update public.stock_balances set quantity = quantity + 3 where product_id = ${p} and state = 'AVAILABLE'`;
    r = await checkInventoryConsistency(org);
    expect(r.divergences).toBe(1);
    const alerts = await sql`select alert_type, severity from public.system_alerts where organization_id = ${org} and status = 'OPEN'`;
    expect(alerts.map((a) => a.alert_type)).toEqual(expect.arrayContaining(['INVENTORY_INCONSISTENT', 'LOW_STOCK']));

    await sql`update public.stock_balances set quantity = quantity - 3 where product_id = ${p} and state = 'AVAILABLE'`;
    await executeStockOperation(admin, { kind: 'entry', productId: p, quantity: 100, reason: 'Reposição' });
    r = await checkInventoryConsistency(org);
    expect(r.divergences).toBe(0);
    const open = await sql`select alert_type from public.system_alerts where organization_id = ${org} and status = 'OPEN'`;
    expect(open.map((a) => a.alert_type)).not.toContain('INVENTORY_INCONSISTENT');
  });
});

describe('cadastro de produto com estoque inicial', () => {
  it('cria o produto e a entrada no ledger juntos; SKU repetido não deixa entrada solta', async () => {
    const sku = `INI-${Date.now()}`;
    const base = { sku, name: 'Toalha inicial', size: null, category: null, costCents: 0, replacementPriceCents: 1000, minStock: 10, active: true };
    const { id } = await createProduct(manager, { ...base, initialQuantity: 250 });
    const p = (await getStockOverview(manager)).products.find((x) => x.id === id)!;
    expect(p.stock.byState.AVAILABLE).toBe(250);
    expect(p.stock.total).toBe(250);
    const [mv] = await sql`select movement_type, from_state, to_state, quantity from public.towel_movements where product_id = ${id}`;
    expect(mv).toMatchObject({ movement_type: 'STOCK_ENTRY', from_state: 'EXTERNAL', to_state: 'AVAILABLE', quantity: 250 });

    await expect(createProduct(manager, { ...base, initialQuantity: 5 })).rejects.toBeInstanceOf(ConflictError);
    const [n] = await sql`select count(*)::int as n from public.towel_movements where product_id = ${id}`;
    expect(n?.n).toBe(1);
  });
});
