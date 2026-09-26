import type { Permission } from '@/server/authz/permissions';

export interface NavItem {
  label: string;
  href: string;
  /** Item só aparece para quem tem a permissão (o servidor valida de novo). */
  permission: Permission;
  /** Fase do IMPLEMENTATION_PLAN em que o módulo é entregue. */
  phase: number;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** Menu admin conforme docs/SPEC.md §13. */
export const ADMIN_NAV: NavSection[] = [
  { label: '', items: [{ label: 'Dashboard', href: '/admin', permission: 'admin.access', phase: 12 }] },
  {
    label: 'Cadastros',
    items: [
      { label: 'Pedidos', href: '/admin/pedidos', permission: 'order.read', phase: 4 },
      { label: 'Clientes', href: '/admin/clientes', permission: 'customer.read', phase: 2 },
      { label: 'Contratos', href: '/admin/contratos', permission: 'contract.read', phase: 8 },
    ],
  },
  {
    label: 'Operação',
    items: [
      { label: 'Entregas', href: '/admin/operacao/entregas', permission: 'route.read', phase: 6 },
      { label: 'Coletas', href: '/admin/operacao/coletas', permission: 'route.read', phase: 6 },
      { label: 'Ocorrências', href: '/admin/operacao/ocorrencias', permission: 'incident.read', phase: 6 },
    ],
  },
  {
    label: 'Estoque',
    items: [
      { label: 'Visão geral', href: '/admin/estoque', permission: 'inventory.read', phase: 3 },
      { label: 'Movimentações', href: '/admin/estoque/movimentacoes', permission: 'inventory.read', phase: 3 },
      { label: 'Lavanderia', href: '/admin/estoque/lavanderia', permission: 'laundry.read', phase: 7 },
      { label: 'Perdas/Danos', href: '/admin/estoque/perdas-danos', permission: 'incident.read', phase: 6 },
    ],
  },
  {
    label: 'Rotas',
    items: [
      { label: 'Rotas', href: '/admin/rotas', permission: 'route.read', phase: 5 },
      { label: 'Motoristas', href: '/admin/rotas/motoristas', permission: 'route.read', phase: 5 },
      { label: 'Veículos', href: '/admin/rotas/veiculos', permission: 'route.read', phase: 5 },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { label: 'Visão geral', href: '/admin/financeiro', permission: 'finance.read', phase: 9 },
      { label: 'Contas a receber', href: '/admin/financeiro/contas-a-receber', permission: 'finance.read', phase: 9 },
      { label: 'Cobranças', href: '/admin/financeiro/cobrancas', permission: 'finance.read', phase: 9 },
      { label: 'Pagamentos', href: '/admin/financeiro/pagamentos', permission: 'finance.read', phase: 9 },
      { label: 'Inadimplência', href: '/admin/financeiro/inadimplencia', permission: 'finance.read', phase: 9 },
      { label: 'Conciliação', href: '/admin/financeiro/conciliacao', permission: 'finance.reconcile', phase: 10 },
    ],
  },
  { label: '', items: [{ label: 'Relatórios', href: '/admin/relatorios', permission: 'reports.read', phase: 12 }] },
  {
    label: 'Administração',
    items: [
      { label: 'Usuários', href: '/admin/administracao/usuarios', permission: 'users.read', phase: 1 },
      { label: 'Permissões', href: '/admin/administracao/permissoes', permission: 'users.read', phase: 1 },
      { label: 'Integrações', href: '/admin/administracao/integracoes', permission: 'integrations.manage', phase: 11 },
      { label: 'Automações', href: '/admin/administracao/automacoes', permission: 'automations.manage', phase: 11 },
      { label: 'Auditoria', href: '/admin/administracao/auditoria', permission: 'audit.read', phase: 1 },
      { label: 'Configurações', href: '/admin/administracao/configuracoes', permission: 'organization.read', phase: 13 },
    ],
  },
];

export function findNavItem(href: string): NavItem | undefined {
  return ADMIN_NAV.flatMap((s) => s.items).find((i) => i.href === href);
}
