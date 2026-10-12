import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/leads/templates';
import { validateAnswers, validateDefinition } from '@/lib/leads/formlogic';
import { computeScore, OPERATORS, VALUELESS, type ScoreRule } from '@/lib/leads/scoring';

describe('modelos de formulário prontos', () => {
  it('são cinco, com identificadores e links únicos', () => {
    expect(TEMPLATES).toHaveLength(5);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(5);
    expect(new Set(TEMPLATES.map((t) => t.slug)).size).toBe(5);
    for (const t of TEMPLATES) expect(t.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  for (const t of TEMPLATES) {
    describe(t.name, () => {
      it('passa na validação de publicação (a mesma do banco)', () => {
        expect(validateDefinition(JSON.parse(JSON.stringify(t.schema)), t.logic, t.consent)).toEqual([]);
      });
      it('a resposta de exemplo é válida e atinge 100 pontos com as regras sugeridas', () => {
        const r = validateAnswers(JSON.parse(JSON.stringify(t.schema)), t.logic, t.sample);
        expect(r.errors).toEqual({});
        const rules: ScoreRule[] = t.rules.map((x, i) => ({ id: `s${i}`, ...x }));
        const s = computeScore(rules, r.clean, { warm_min: 40, hot_min: 70, qualified_min: 70 }, r.hidden);
        expect(s.score).toBe(100);
        expect(s.classification).toBe('hot');
        expect(s.missing).toEqual([]);
      });
      it('as regras sugeridas usam operadores da lista, campos existentes e valor quando exigido', () => {
        const keys = t.schema.fields.map((f) => f.key);
        for (const r of t.rules) {
          expect(OPERATORS as readonly string[]).toContain(r.operator);
          expect(keys).toContain(r.field_key);
          if (!(VALUELESS as readonly string[]).includes(r.operator)) expect(r.condition).not.toBeNull();
          expect(Math.abs(r.points)).toBeLessThanOrEqual(100);
        }
      });
      it('não pede dados sensíveis (equidade): nenhuma pergunta de raça, religião, saúde, orientação etc.', () => {
        const text = JSON.stringify(t.schema.fields.map((f) => f.label)).toLowerCase();
        for (const word of ['raça', 'cor da pele', 'religião', 'orientação sexual', 'filiação', 'doença', 'deficiência', 'gestante', 'estado civil']) expect(text).not.toContain(word);
      });
    });
  }

  it('uma resposta ruim não pontua (cenário frio)', () => {
    const t = TEMPLATES[0]!;
    const rules: ScoreRule[] = t.rules.map((x, i) => ({ id: `s${i}`, ...x }));
    const s = computeScore(rules, { cargo: 'pesquisa', funcionarios: 'ate_10', orcamento: 'ate_5k', prazo: 'pesquisando' });
    expect(s.score).toBe(0);
    expect(s.classification).toBe('cold');
  });
});
