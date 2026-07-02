'use strict';
// xsignal SDK self-test: the framework adapters produce the right shapes + execute() hits the right hosted path
// (injected fetch → fully offline). Mirrors MainStreet's proven tool-adapter pattern.
const T = require('./tools.js');
const calls = [];
const mockFetch = async (url) => { calls.push(url); return { status: 200, json: async () => ({ ok: true, url }) }; };
const opts = { fetch: mockFetch, wallet: '0xabc', origin: 'https://x.test' };

(async () => {
  const oa = T.openai(), an = T.anthropic(), specs = T.specs();
  const vc = T.vercelAiSdk(opts), lc = T.langchain(opts), ms = T.mastra(opts);
  const intentRes = await T.execute('get_intent', { addr: '0xTOKEN', min_confidence: 0.7 }, opts);
  const vcIntent = await vc.get_intent.execute({ addr: '0xTOKEN', min_confidence: 0.7 });

  const checks = [
    ['6 tools, flagship get_intent first', specs.length === 6 && specs[0].name === 'get_intent'],
    ['openai shape {type:function, function:{name,parameters}}', oa[0].type === 'function' && oa[0].function.name === 'get_intent' && !!oa[0].function.parameters],
    ['anthropic shape {name, input_schema}', an[0].name === 'get_intent' && !!an[0].input_schema],
    ['vercel shape: record keyed by name with execute + parameters', typeof vc.get_intent.execute === 'function' && !!vc.get_intent.parameters],
    ['langchain shape {name, schema, func}', lc[0].name === 'get_intent' && !!lc[0].schema && typeof lc[0].func === 'function'],
    ['mastra shape {id, inputSchema, execute}', ms[0].id === 'get_intent' && !!ms[0].inputSchema && typeof ms[0].execute === 'function'],
    ['execute get_intent → GET /intent with addr + min_confidence + wallet', /\/intent\?addr=0xTOKEN&min_confidence=0\.7&wallet=0xabc/.test(calls.join(' ')) && intentRes.ok === true],
    ['vercel execute also hits the hosted endpoint', vcIntent.ok === true],
    ['origin is injectable (all calls hit https://x.test)', calls.length > 0 && calls.every((u) => u.startsWith('https://x.test'))],
    ['NO fund-moving executor in the surface', !Object.keys(T).some((k) => typeof T[k] === 'function' && /^(sign|send|swap|deploy|transfer|withdraw)/i.test(k))],
  ];
  let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
  console.log(`\n${pass}/${checks.length} checks passed`);
  process.exit(pass === checks.length ? 0 : 1);
})();
