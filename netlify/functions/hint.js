// netlify/functions/hint.js
// Calls Gemini 1.5 Flash to generate a cinephile-flavored hint.
// Hard cap: HINT_DAILY_LIMIT (default 40) requests per calendar day (UTC).
// State is stored in a JSON file at /tmp/hint_usage.json (ephemeral per lambda instance,
// but good enough for rate-limiting casual abuse on a small game).
// For true persistence across lambda instances, swap _loadUsage/_saveUsage
// with a KV store (e.g. Netlify Blobs or Redis).

const fs   = require('fs');
const path = require('path');

const USAGE_FILE    = '/tmp/hint_usage.json';
const DAILY_LIMIT   = parseInt(process.env.HINT_DAILY_LIMIT || '40', 10);
const GEMINI_KEY    = process.env.GEMINI_API_KEY;
const GEMINI_URL    =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// ── Usage helpers ────────────────────────────────────────────────────────────
function todayUTC() {
  return new Date().toISOString().slice(0, 10); // "2025-07-14"
}

function loadUsage() {
  try {
    const raw = fs.readFileSync(USAGE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { date: todayUTC(), count: 0 };
  }
}

function saveUsage(usage) {
  try { fs.writeFileSync(USAGE_FILE, JSON.stringify(usage)); } catch {}
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!GEMINI_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' }) };
  }

  // ── Rate limit check ──────────────────────────────────────────────────────
  const usage = loadUsage();
  const today = todayUTC();
  if (usage.date !== today) { usage.date = today; usage.count = 0; }

  if (usage.count >= DAILY_LIMIT) {
    return {
      statusCode: 429,
      headers: cors,
      body: JSON.stringify({
        error: 'Daily hint limit reached',
        hint: "You've exhausted today's AI hints — trust your cinephile instincts! 🎬",
        limitReached: true,
        remaining: 0
      })
    };
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { currentActor, targetActor, hopsUsed = 0, difficulty = 'easy', chain = [] } = body;

  if (!currentActor || !targetActor) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'currentActor and targetActor required' }) };
  }

  // ── Build the Gemini prompt ───────────────────────────────────────────────
  const chainStr = chain.length > 1
    ? `The player's chain so far: ${chain.map(n => n.movie ? `${n.actor} → (${n.movie})` : n.actor).join(' → ')}. `
    : '';

  const diffInstr = {
    easy:   'Give a fairly direct hint — mention a specific well-known film the player could use.',
    medium: 'Give a moderate hint — mention the genre or era of a connecting film, but not the exact title.',
    hard:   'Give only a subtle nudge — hint at a thematic or biographical connection without naming any specific film.',
  }[difficulty] || 'Give a helpful hint.';

  const prompt = `You are a witty, knowledgeable film critic helping a player of "This2Them", a movie actor connection game.

The player is currently at: ${currentActor}
Their goal is to reach: ${targetActor}
They have used ${hopsUsed} hop(s) so far.
${chainStr}
Difficulty: ${difficulty}

Task: ${diffInstr}

Rules:
- Keep the hint to 1–2 sentences maximum.
- Never reveal the full solution or name more than one intermediate actor.
- Write in a cinephile-flavored, slightly witty voice.
- Do NOT start with "Hint:" or similar labels — just the hint itself.`;

  // ── Call Gemini ───────────────────────────────────────────────────────────
  try {
    const gemRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 120, temperature: 0.85 }
      })
    });

    if (!gemRes.ok) {
      const err = await gemRes.text();
      console.error('Gemini error:', err);
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Gemini API error', hint: null }) };
    }

    const gemData = await gemRes.json();
    const hint = gemData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;

    // ── Increment usage ───────────────────────────────────────────────────
    usage.count += 1;
    saveUsage(usage);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        hint,
        remaining: Math.max(0, DAILY_LIMIT - usage.count),
        used: usage.count
      })
    };

  } catch (err) {
    console.error('hint function error:', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Internal error', hint: null }) };
  }
};
