import { describe, expect, it } from 'vitest';
import { analyzeWithAi, maskPersonalData, minimizeLead, readAiEnv, type AiEnv } from '@/lib/leads/ai';
import type { LeadDetail } from '@/lib/leads/data';

const env: AiEnv = { apiKey: 'chave-secreta-de-teste', baseUrl: 'https://api.exemplo.test/v1', model: 'm', provider: 'exemplo' };
const lead = { segment: 'Indústria', source: 'google', campaign: 'Verão', score: 80, classification: 'hot', qualified: true, applied_rules: [], missing_fields: [], answers: [] };
const ok = (content: unknown, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status });
const good = { summary: 'Bom encaixe.', strengths: ['Prazo curto'], risks: [], next_steps: ['Ligar'] };

describe('configuração da IA', () => {
  it('exige as três variáveis; sem elas fica desabilitada', () => {
    expect(readAiEnv({})).toBeNull();
    expect(readAiEnv({ AI_API_KEY: 'k', AI_BASE_URL: 'https://a.test/v1' })).toBeNull();
    expect(readAiEnv({ AI_API_KEY: 'k', AI_BASE_URL: 'https://a.test/v1/', AI_MODEL: 'm' })?.baseUrl).toBe('https://a.test/v1');
  });
  it('a chave nunca viaja em texto puro: só https (ou localhost), sem credenciais na URL', () => {
    expect(readAiEnv({ AI_API_KEY: 'k', AI_BASE_URL: 'http://a.test/v1', AI_MODEL: 'm' })).toBeNull();
    expect(readAiEnv({ AI_API_KEY: 'k', AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'm' })).not.toBeNull();
    expect(readAiEnv({ AI_API_KEY: 'k', AI_BASE_URL: 'https://u:p@a.test/v1', AI_MODEL: 'm' })).toBeNull();
    expect(readAiEnv({ AI_API_KEY: 'k', AI_BASE_URL: 'não é url', AI_MODEL: 'm' })).toBeNull();
  });
});

describe('minimização de dados', () => {
  it('mascara e-mails e telefones em texto livre', () => {
    const t = maskPersonalData('Fale com ana@empresa.com ou (11) 91234-5678 hoje');
    expect(t).not.toMatch(/ana@|91234/);
    expect(t).toContain('[e-mail]');
    expect(t).toContain('[telefone]');
  });
  it('não leva nome, e-mail, telefone nem empresa do lead à IA', () => {
    const detail = {
      lead: { name: 'Maria Souza', email: 'maria@x.com', phone: '5511912345678', company_name: 'Acme', segment: 'Indústria', source: 'google', current_score: 80, qualification: 'hot', qualified: true },
      campaign: { name: 'Verão' },
      schema: { steps: [], fields: [
        { key: 'nome', type: 'text', label: 'Nome', lead_field: 'name' }, { key: 'email', type: 'email', label: 'E-mail', lead_field: 'email' },
        { key: 'empresa', type: 'text', label: 'Empresa', lead_field: 'company_name' }, { key: 'prazo', type: 'select', label: 'Prazo', options: [{ value: 'ate_30', label: 'Até 30 dias' }] },
        { key: 'obs', type: 'textarea', label: 'Obs' },
      ] },
      submission: { answers_json: { nome: 'Maria Souza', email: 'maria@x.com', empresa: 'Acme', prazo: 'ate_30', obs: 'me ligue em 11 91234-5678 ou maria@x.com' } },
      scores: [{ explanation_json: { applied: [{ label: 'Prazo curto', points: 30 }], missing: ['x'] } }],
    } as unknown as LeadDetail;
    const m = minimizeLead(detail);
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/Maria|maria@|91234|Acme/);
    expect(m.answers.map((a) => a.question)).toEqual(['Prazo', 'Obs']);
    expect(m.answers[0]!.answer).toBe('Até 30 dias');
    expect(m.applied_rules).toEqual([{ rule: 'Prazo curto', points: 30 }]);
  });
});

describe('chamada ao provedor (fetch simulado)', () => {
  it('sucesso: valida o JSON, devolve tokens e só envia a chave ao endereço configurado, sem seguir redirecionamentos', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const r = await analyzeWithAi(lead, env, (async (url: string, init: RequestInit) => { seen = { url, init }; return ok(good); }) as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.analysis.summary).toBe('Bom encaixe.'); expect(r.tokensIn).toBe(10); }
    expect(seen!.url).toBe('https://api.exemplo.test/v1/chat/completions');
    expect(seen!.init.redirect).toBe('error');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer chave-secreta-de-teste');
    expect(String(seen!.init.body)).not.toContain('chave-secreta-de-teste');
  });
  it('erro do provedor, JSON inválido e formato fora do esperado viram falha clara (sem vazar a chave)', async () => {
    for (const f of [
      async () => ok('x', 500),
      async () => ok('isto não é json'),
      async () => ok({ summary: '', strengths: 'não é lista' }),
      async () => ok({ ...good, summary: 'x'.repeat(5000) }),
      async () => new Response(JSON.stringify({ choices: [] })),
    ]) {
      const r = await analyzeWithAi(lead, env, f as unknown as typeof fetch);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toContain('chave-secreta');
    }
  });
  it('tempo limite aborta a chamada', async () => {
    const slow = ((_u: string, init: RequestInit) => new Promise((_res, rej) => { init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))); })) as unknown as typeof fetch;
    const r = await analyzeWithAi(lead, env, slow, 30);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('demorou');
  });
  it('falha de rede não derruba', async () => {
    const r = await analyzeWithAi(lead, env, (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
  });
});
