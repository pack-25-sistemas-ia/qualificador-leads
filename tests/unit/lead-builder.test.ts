import { describe, expect, it } from 'vitest';
import { availableLeadFields, canonical, formatOptions, moveItem, newField, parseOptions, removeField, removeStep, renameKey, setRule, slugifyValue, uniqueKey, type Draft } from '@/components/leads/builder-state';
import { validateDefinition } from '@/lib/leads/formlogic';
import { TEMPLATES } from '@/lib/leads/templates';
import { formatRuleValue, parseRuleValue } from '@/lib/leads/rule-value';

const base = (): Draft => {
  const t = TEMPLATES.find((x) => x.id === 'imobiliaria')!;
  return { meta: { name: 'X', description: '', thank_you_message: 'Obrigado', success_redirect_url: '' }, schema: JSON.parse(JSON.stringify(t.schema)), logic: JSON.parse(JSON.stringify(t.logic)), consent: { required: true, text: t.consent.text } };
};

describe('editor de formulário — funções puras', () => {
  it('gera valores e chaves seguros e únicos', () => {
    expect(slugifyValue('Até 30 dias!')).toBe('ate_30_dias');
    expect(slugifyValue('***')).toBe('opcao');
    expect(uniqueKey('campo', ['campo', 'campo_2'])).toBe('campo_3');
    expect(uniqueKey('1abc', [])).toMatch(/^campo_/);
  });

  it('analisa opções: rótulo puro, valor | rótulo e repetidos', () => {
    expect(parseOptions('Sim\nNão\n\nsim')).toEqual([{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }]);
    expect(parseOptions('a | Opção A\nb | Opção B')).toEqual([{ value: 'a', label: 'Opção A' }, { value: 'b', label: 'Opção B' }]);
    expect(parseOptions(formatOptions([{ value: 'x', label: 'Xis' }]))).toEqual([{ value: 'x', label: 'Xis' }]);
  });

  it('nova pergunta de lista já nasce com duas opções; consentimento nasce obrigatório', () => {
    expect(newField('select', []).options).toHaveLength(2);
    expect(newField('consent', []).required).toBe(true);
    expect(newField('text', ['campo']).key).toBe('campo_2');
  });

  it('renomear chave atualiza a lógica condicional', () => {
    const d = renameKey(base(), 'financia', 'precisa_financiar');
    expect(d.logic[0]!.show_if.all![0]!.field).toBe('precisa_financiar');
    expect(d.schema.fields.some((f) => f.key === 'precisa_financiar')).toBe(true);
    expect(validateDefinition(d.schema, d.logic, d.consent)).toEqual([]);
  });

  it('remover a pergunta da condição remove a regra vazia; remover a alvo remove a regra', () => {
    expect(removeField(base(), 'financia').logic).toEqual([]);
    expect(removeField(base(), 'entrada').logic).toEqual([]);
    expect(removeField(base(), 'visita').logic).toHaveLength(1);
  });

  it('mover pergunta antes da dependência acusa o problema', () => {
    const d = base();
    const from = d.schema.fields.findIndex((f) => f.key === 'financia');
    const to = d.schema.fields.findIndex((f) => f.key === 'entrada');
    const moved = { ...d, schema: { ...d.schema, fields: moveItem(d.schema.fields, to, from) } };
    expect(validateDefinition(moved.schema, moved.logic, moved.consent).join(' ')).toContain('ANTERIORES');
  });

  it('moveItem ignora índices inválidos', () => {
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
  });

  it('remover etapa solta as perguntas dela', () => {
    const d = removeStep(base(), 'imovel');
    expect(d.schema.steps.map((s) => s.id)).toEqual(['contato']);
    expect(d.schema.fields.every((f) => f.step !== 'imovel')).toBe(true);
  });

  it('setRule substitui ou remove a regra do alvo', () => {
    const d = setRule(base(), 'visita', { target: 'visita', show_if: { all: [{ field: 'prazo', op: 'eq', value: 'ate_30' }] } });
    expect(d.logic).toHaveLength(2);
    expect(setRule(d, 'visita', null).logic).toHaveLength(1);
  });

  it('forma canônica ignora espaços e campos vazios (sem «mudanças» fantasmas)', () => {
    const a = base();
    const b = JSON.parse(JSON.stringify(a)) as Draft;
    b.meta.name = '  X  ';
    b.schema.fields[0] = { ...b.schema.fields[0]!, help: '' };
    expect(canonical(b)).toBe(canonical(a));
    b.meta.name = 'Y';
    expect(canonical(b)).not.toBe(canonical(a));
  });

  it('vínculos com o lead: cada um uma vez, e-mail/telefone só no tipo certo', () => {
    const d = base();
    const email = d.schema.fields.find((f) => f.key === 'email')!;
    expect(availableLeadFields(d.schema.fields, email)).toContain('email');
    const phone = d.schema.fields.find((f) => f.key === 'telefone')!;
    expect(availableLeadFields(d.schema.fields, phone)).not.toContain('email');
    const free = newField('text', d.schema.fields.map((f) => f.key));
    expect(availableLeadFields(d.schema.fields, free)).not.toContain('name'); // já usado
    expect(availableLeadFields(d.schema.fields, free)).toContain('company_name');
  });
});

describe('valores das regras', () => {
  it('converte o que a pessoa digita', () => {
    expect(parseRuleValue('gt', '5000')).toEqual({ ok: true, value: 5000 });
    expect(parseRuleValue('gt', '5000,5')).toEqual({ ok: true, value: 5000.5 });
    expect(parseRuleValue('gt', 'muito').ok).toBe(false);
    expect(parseRuleValue('between', '10 a 50')).toEqual({ ok: true, value: { min: 10, max: 50 } });
    expect(parseRuleValue('between', '10-50')).toEqual({ ok: true, value: { min: 10, max: 50 } });
    expect(parseRuleValue('between', '50 a 10').ok).toBe(false);
    expect(parseRuleValue('in', 'SP, RJ; MG, SP')).toEqual({ ok: true, value: ['SP', 'RJ', 'MG'] });
    expect(parseRuleValue('eq', 'ate_30')).toEqual({ ok: true, value: 'ate_30' });
    expect(parseRuleValue('eq', '').ok).toBe(false);
    expect(parseRuleValue('is_true', '')).toEqual({ ok: true, value: null });
    expect(parseRuleValue('answered', 'qualquer coisa')).toEqual({ ok: true, value: null });
    expect(parseRuleValue('eval', 'x').ok).toBe(false);
  });
  it('mostra de volta o valor guardado', () => {
    expect(formatRuleValue('between', { min: 10, max: 50 })).toBe('10 a 50');
    expect(formatRuleValue('in', ['a', 'b'])).toBe('a, b');
    expect(formatRuleValue('gt', 5000)).toBe('5000');
    expect(formatRuleValue('is_true', null)).toBe('');
    expect(parseRuleValue('between', formatRuleValue('between', { min: 1, max: 2 }))).toEqual({ ok: true, value: { min: 1, max: 2 } });
  });
});
