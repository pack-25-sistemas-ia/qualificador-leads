#!/usr/bin/env node
// Gera os testes SQL a partir das fixtures JSON compartilhadas com o TypeScript:
//   tests/fixtures/scoring-cases.json -> supabase/tests/60_lead_scoring_fixtures.sql   (lead_score_compute)
//   tests/fixtures/form-cases.json    -> supabase/tests/60_lead_form_fixtures.sql      (lead_validate_answers / lead_validate_form_def)
// As MESMAS fixtures alimentam o motor TypeScript (tests/unit). Um teste unitário garante que o SQL gerado está em dia.
// Uso: node scripts/gen-fixtures-sql.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(readFileSync(join(root, 'tests', 'fixtures', name), 'utf8'));
const j = (v) => `$j$${JSON.stringify(v)}$j$::jsonb`;
const q = (s) => `$m$${s}$m$`;
const hidden = (c) => `array[${(c.hidden ?? []).map((h) => `$h$${h}$h$`).join(', ')}]::text[]`;
const thresholds = (c) => c.thresholds ?? { warm_min: 40, hot_min: 70, qualified_min: 70 };

export function renderScoring() {
  const cases = read('scoring-cases.json');
  const lines = [
    '-- GERADO por scripts/gen-fixtures-sql.mjs a partir de tests/fixtures/scoring-cases.json. NÃO edite à mão.',
    '-- Motor de score (lead_score_compute): resultados esperados calculados à mão; o TypeScript usa as mesmas fixtures.',
    '',
    'do $$',
    'begin',
  ];
  for (const c of cases.valid) {
    lines.push(`  assert public.lead_score_compute(${j(c.rules)}, ${j(c.answers)}, ${j(thresholds(c))}, ${hidden(c)}) = ${j(c.expected)}, ${q('score: ' + c.name)};`);
  }
  for (const c of cases.invalid) {
    const call = `select public.lead_score_compute(${j(c.rules)}, ${j(c.answers)}, ${j(c.thresholds ?? { warm_min: 40, hot_min: 70 })})`;
    lines.push(`  assert test.throws($q$${call}$q$), ${q('deve recusar: ' + c.name)};`);
  }
  lines.push(`  raise notice 'PASS: motor de score — ${cases.valid.length} fixtures válidas e ${cases.invalid.length} inválidas';`, 'end $$;', '');
  return lines.join('\n');
}

export function renderForms() {
  const cases = read('form-cases.json');
  const lines = [
    '-- GERADO por scripts/gen-fixtures-sql.mjs a partir de tests/fixtures/form-cases.json. NÃO edite à mão.',
    '-- Contrato do formulário no banco (lead_validate_answers / lead_validate_form_def): esperado calculado à mão; o TypeScript usa as mesmas fixtures.',
    '',
    'do $$',
    'begin',
  ];
  for (const c of cases.answers) {
    lines.push(`  assert public.lead_validate_answers(${j(c.schema)}, ${j(c.logic)}, ${j(c.answers)}) = ${j(c.expected)}, ${q('respostas: ' + c.name)};`);
  }
  for (const c of cases.definitions) {
    lines.push(`  assert public.lead_validate_form_def(${j(c.schema)}, ${j(c.logic)}, ${j(c.consent)}) = ${j(c.expected)}, ${q('definição: ' + c.name)};`);
  }
  lines.push(`  raise notice 'PASS: contrato do formulário — ${cases.answers.length} respostas e ${cases.definitions.length} definições';`, 'end $$;', '');
  return lines.join('\n');
}

const outputs = [
  ['60_lead_scoring_fixtures.sql', renderScoring],
  ['60_lead_form_fixtures.sql', renderForms],
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let stale = false;
  for (const [file, render] of outputs) {
    const path = join(root, 'supabase', 'tests', file);
    const text = render();
    if (process.argv.includes('--check')) {
      const cur = (() => { try { return readFileSync(path, 'utf8'); } catch { return ''; } })();
      if (cur !== text) { console.error(`${file} desatualizado: rode node scripts/gen-fixtures-sql.mjs`); stale = true; }
    } else {
      writeFileSync(path, text);
      console.log('gerado', path);
    }
  }
  if (process.argv.includes('--check')) {
    if (stale) process.exit(1);
    console.log('fixtures SQL em dia');
  }
}
