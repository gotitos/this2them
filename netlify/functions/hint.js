// netlify/functions/hint.js
// Calls Gemini 1.5 Flash for AI-powered hints with a daily usage cap.

const fs = require('fs');

const USAGE_FILE  = '/tmp/t2t_hint_usage.json';
const DAILY_LIMIT = parseInt(process.env.HINT_DAILY_LIMIT || '40', 10);
const GEMINI_KEY  = process.env.GEMINI_API_KEY;
const GEMINI_URL  = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function loadUsage() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return { date: todayUTC(), count: 0 };
  }
}

function saveUsage(usage) {
  try { fs.writeFileSync(USAGE_FILE, JSON.stringify(usage)); } catch {}
}

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
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        hint: "GEMINI_API_KEY is not set in Netlify environment variables. Add it and redeploy.",
        remaining: 0,
        limitReached: false,
        debug: 'missing_key'
      })
    };
  }

  // ── Daily rate limit ──────────────────────────────────────────────────────
  const usage = loadUsage();
  const today = todayUTC();
  if (usage.date !== today) { usage.date = today; usage.count = 0; }

  if (usage.count >= DAILY_LIMIT) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        hint: "You've exhausted today's AI hints — trust your cinephile instincts! 🎬",
        remaining: 0,
        limitReached: true
      })
    };
  }

  // ── Parse request ─────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { currentActor, targetActor, hopsUsed = 0, difficulty = 'easy', chain = [] } = body;

  if (!currentActor || !targetActor) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'currentActor and targetActor are required' }) };
  }

  // ── Build prompt ──────────────────────────────────────────────────────────
  const chainStr = chain.length > 1
    ? `Chain so far: ${chain.map(n => n.movie ? `${n.actor} → (${n.movie})` : n.actor).join(' → ')}. `
    : '';

  const diffInstr = {
    easy:   'Give a fairly direct hint — you may mention a specific well-known film the player could use as a bridge.',
    medium: 'Give a moderate hint — mention the genre or general era of a good connecting film, but not the exact title.',
    hard:   'Give only a very subtle nudge — hint at a thematic, biographical, or directorial connection without naming any specific film or intermediate actor.',
  }[difficulty] || 'Give a helpful hint.';

  const prompt = `You are a witty, knowledgeable film critic helping a player of "This2Them", a movie actor connection game.

Current actor: ${currentActor}
Target actor: ${targetActor}
Hops used: ${hopsUsed}
${chainStr}Difficulty: ${difficulty}

Task: ${diffInstr}

Rules:
- Maximum 2 sentences.
- Never reveal the full path or more than one intermediate step.
- Cinephile-flavored, slightly witty tone.
- Do NOT begin with "Hint:" — just write the hint directly.`;

  // ── Call Gemini ───────────────────────────────────────────────────────────
  try {
    const gemRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 100, temperature: 0.85 }
      })
    });

    if (!gemRes.ok) {
      const errText = await gemRes.text();
      console.error('Gemini API error:', gemRes.status, errText);
      let friendlyMsg = "Couldn't reach the AI right now.";
      if (gemRes.status === 400) friendlyMsg = "Gemini rejected the request (400) — check GEMINI_API_KEY format.";
      if (gemRes.status === 403) friendlyMsg = "Gemini API key is invalid or lacks permissions (403). Check your key at aistudio.google.com.";
      if (gemRes.status === 429) friendlyMsg = "Gemini rate limit hit (429) — try again in a moment.";
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          hint: friendlyMsg,
          remaining: DAILY_LIMIT - usage.count,
          debug: `gemini_${gemRes.status}`
        })
      };
    }

    const gemData = await gemRes.json();
    const hint = gemData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;

    usage.count += 1;
    saveUsage(usage);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        hint: hint || "The AI is speechless — even it doesn't know this one!",
        remaining: Math.max(0, DAILY_LIMIT - usage.count),
        used: usage.count
      })
    };

  } catch (err) {
    console.error('hint handler error:', err);
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        hint: `Hint service error: ${err.message}`,
        remaining: DAILY_LIMIT - usage.count,
        debug: 'exception'
      })
    };
  }
};
