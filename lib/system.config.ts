// Configuração do Qualificador de Leads Inteligente. Para personalizar para um cliente:
//  1. troque `name`;  2. substitua public/brand/logo.svg;  3. ajuste a navegação em `primaryNav`.
// Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
import type { OrgRole } from '@/lib/validation/org';

export type NavItem = { href: string; label: string; roles?: readonly OrgRole[] };

const MANAGEMENT = ['owner', 'admin', 'manager'] as const;

export const systemConfig: { name: string; logo: string; primaryNav: NavItem[] } = {
  name: 'Qualificador de Leads',
  logo: '/brand/logo.svg',
  primaryNav: [
    { href: '/dashboard', label: 'Painel' },
    { href: '/leads', label: 'Leads' },
    { href: '/pipeline', label: 'Pipeline' },
    { href: '/atividades', label: 'Atividades' },
    { href: '/formularios', label: 'Formulários', roles: [...MANAGEMENT, 'viewer'] },
    { href: '/qualificacao', label: 'Qualificação (score)' },
    { href: '/distribuicao', label: 'Distribuição', roles: MANAGEMENT },
    { href: '/campanhas', label: 'Campanhas' },
    { href: '/relatorios', label: 'Relatórios' },
    { href: '/configuracoes', label: 'Configurações comerciais', roles: ['owner', 'admin'] },
  ],
};
