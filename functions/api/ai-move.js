// Cloudflare Pages Function: /api/ai-move
// Set the secret in Cloudflare: Pages project -> Settings -> Variables and Secrets -> GROQ_API_KEY
// Optional: GROQ_MODEL (default llama-3.3-70b-versatile)
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function onRequestGet({ env }) {
  return json({ enabled: !!env.GROQ_API_KEY, model: env.GROQ_MODEL || DEFAULT_MODEL });
}

export async function onRequestPost({ request, env }) {
  if (!env.GROQ_API_KEY) return json({ error: 'GROQ_API_KEY not set' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const cands = Array.isArray(body.candidates) ? body.candidates.slice(0, 6) : [];
  if (cands.length < 1) return json({ error: 'no candidates' }, 400);
  const board = String(body.board || '').slice(0, 400);
  const list = cands.map((c, i) => `${i}: ${String(c.move).slice(0, 40)} (engine score ${Number(c.engineScore) | 0})`).join('\n');
  const prompt = `You are a grandmaster checkers player (${String(body.variant).slice(0, 40)}), playing ${body.color === 'Red' ? 'Red' : 'Black'} at difficulty level ${Number(body.level) | 0}.
Board (row 1 = top/Black side; r=red man, R=red king, b=black man, B=black king, .=empty dark square):
${board}
Recent moves: ${(body.history || []).slice(-12).map(String).join(', ') || 'none'}
A search engine has already verified these candidate moves (squares numbered 1.. from the top-left dark square). They are all close in value:
${list}
Pick the one with the best long-term strategy (king safety, tempo, back-rank, trapping kings, simplifying when ahead).
Reply ONLY with JSON: {"choice": <index>, "taunt": "<one short, playful, clean trash-talk line, max 15 words>"}`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6500);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.GROQ_MODEL || DEFAULT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4, max_tokens: 120,
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) return json({ error: `groq ${r.status}` }, 502);
    const data = await r.json();
    const out = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    let choice = Number(out.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= cands.length) choice = 0;
    return json({ choice, taunt: String(out.taunt || '').slice(0, 140) });
  } catch (e) {
    return json({ error: 'groq unavailable' }, 502);
  } finally { clearTimeout(timer); }
}
