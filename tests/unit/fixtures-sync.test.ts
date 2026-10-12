import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { renderForms, renderScoring } from '@/scripts/gen-fixtures-sql.mjs';

const sql = (name: string) => readFileSync(join(process.cwd(), 'supabase', 'tests', name), 'utf8');

describe('SQL de teste gerado das fixtures', () => {
  it('está em dia (rode node scripts/gen-fixtures-sql.mjs se falhar)', () => {
    expect(sql('60_lead_scoring_fixtures.sql')).toBe(renderScoring());
    expect(sql('60_lead_form_fixtures.sql')).toBe(renderForms());
  });
});
