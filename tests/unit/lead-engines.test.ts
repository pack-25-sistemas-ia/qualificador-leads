import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeScore, evalCondition, validateThresholds, type ScoreRule } from '@/lib/leads/scoring';
import { validateAnswers, validateDefinition, visibleFields, normPhone, normEmail, type FormSchema, type LogicRule, type ConsentConfig } from '@/lib/leads/formlogic';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const scoring = load('scoring-cases.json') as {
  valid: Array<{ name: string; rules: ScoreRule[]; answers: Record<string, unknown>; thresholds?: Record<string, number>; hidden?: string[]; expected: unknown }>;
  invalid: Array<{ name: string; rules: unknown; answers: Record<string, unknown>; thresholds?: Record<string, number> }>;
};
const forms = load('form-cases.json') as {
  answers: Array<{ name: string; schema: FormSchema; logic: LogicRule[]; answers: unknown; expected: unknown }>;
  definitions: Array<{ name: string; schema: FormSchema; logic: LogicRule[]; consent: ConsentConfig; expected: string[] }>;
};

// As MESMAS fixtures (calculadas à mão) passam no banco (supabase/tests/60_*) e aqui: o espelho não diverge da fonte da verdade.
describe('motor de score (espelho do banco) — fixtures compartilhadas', () => {
  for (const c of scoring.valid) {
    it(c.name, () => {
      const defaults = { warm_min: 40, hot_min: 70, qualified_min: 70 };
      expect(computeScore(c.rules, c.answers, c.thresholds ?? defaults, c.hidden ?? [])).toEqual(c.expected);
    });
  }
  for (const c of scoring.invalid) {
    it(`recusa: ${c.name}`, () => {
      expect(() => computeScore(c.rules as ScoreRule[], c.answers, c.thresholds ?? { warm_min: 40, hot_min: 70 })).toThrow();
    });
  }
});

describe('operadores e faixas', () => {
  it('só existem operadores da lista fechada; desconhecido não aplica a regra', () => {
    expect(evalCondition('eval', 'x', 'x')).toBeNull();
    expect(evalCondition('constructor', 'x', 'x')).toBeNull();
  });
  it('valida faixas', () => {
    expect(validateThresholds({ warm_min: 40, hot_min: 70, qualified_min: 70 })).toBeNull();
    expect(validateThresholds({ warm_min: 70, hot_min: 40 })).not.toBeNull();
    expect(validateThresholds({ warm_min: 0, hot_min: 70 })).not.toBeNull();
    expect(validateThresholds({ warm_min: 40, hot_min: 101 })).not.toBeNull();
    expect(validateThresholds({ warm_min: 40.5, hot_min: 70 })).not.toBeNull();
  });
  it('é determinístico: mesma entrada, mesmo resultado', () => {
    const rules: ScoreRule[] = [{ id: 'a', label: 'A', field_key: 'x', operator: 'gt', condition: 1, points: 10 }];
    expect(computeScore(rules, { x: 5 })).toEqual(computeScore(rules, { x: 5 }));
  });
  it('não altera as regras nem as respostas recebidas', () => {
    const rules: ScoreRule[] = [{ id: 'a', label: 'A', field_key: 'x', operator: 'gt', condition: 1, points: 10 }];
    const answers = { x: 5 };
    const before = JSON.stringify([rules, answers]);
    computeScore(rules, answers);
    expect(JSON.stringify([rules, answers])).toBe(before);
  });
});

describe('contrato do formulário (espelho do banco) — fixtures compartilhadas', () => {
  for (const c of forms.answers) {
    it(`respostas: ${c.name}`, () => {
      expect(validateAnswers(c.schema, c.logic, c.answers)).toEqual(c.expected);
    });
  }
  for (const c of forms.definitions) {
    it(`definição: ${c.name}`, () => {
      expect(validateDefinition(c.schema, c.logic, c.consent)).toEqual(c.expected);
    });
  }
});

describe('visibilidade em tempo real e normalização', () => {
  const { schema, logic } = forms.answers[0]!;
  it('campo condicional só aparece depois da condição', () => {
    expect(visibleFields(schema, logic, {}).map((f) => f.key)).not.toContain('cnpj');
    expect(visibleFields(schema, logic, { tem_cnpj: true }).map((f) => f.key)).toContain('cnpj');
    expect(visibleFields(schema, logic, { tem_cnpj: false }).map((f) => f.key)).not.toContain('cnpj');
  });
  it('normaliza e-mail e telefone como o banco', () => {
    expect(normEmail('  Ana@X.com ')).toBe('ana@x.com');
    expect(normEmail('   ')).toBeNull();
    expect(normPhone('(11) 91234-5678')).toBe('5511912345678');
    expect(normPhone('11 3456-7890')).toBe('551134567890');
    expect(normPhone('0055 11 91234-5678')).toBe('5511912345678');
    expect(normPhone('123')).toBeNull();
    expect(normPhone('abc')).toBeNull();
  });
});
