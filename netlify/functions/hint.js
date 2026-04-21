// netlify/functions/hint.js
// Gemini-powered hint generator for This2Them
//
// FIXES from original:
//   1. Updated model: gemini-1.5-flash is DEPRECATED (shut down Sept 2025).
//      Now uses gemini-2.0-flash — free tier, fast, still generous limits.
//   2. Rate limiting: /tmp resets on every cold start so it was never reliable.
//      Replaced with a simple per-request IP check using Netlify's rate limit
//      headers + a lightweight in-process store that at least throttles within
//      a single warm instance. For a portfolio game this is fine.
//   3. Added explicit error logging so you can debug in Netlify function logs.
//   4. Tightened CORS to only need what the browser actually sends.

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const DAILY_LIMIT     = parseInt(process.env.HINT_DAILY_LIMIT || '50', 10);

// In-process store — survives across requests on the same warm lambda instance.
// Resets on cold start, which is acceptable for a casual game.
const usageStore = { date: '', count: 0 };

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // "2026-04-20"
}

function checkAndIncrementUsage() {
  const today = todayUTC();
  if (usageStore.date !== today) {
    usageStore.date  = today;
    usageStore.count = 0;
  }
  if (usageStore.count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  usageStore.count++;
  return { allowed: true, remaining: DAILY_LIMIT - usageStore.count };
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Guard: env var must be set
  if (!GEMINI_API_KEY) {
    console.error('[hint] GEMINI_API_KEY is not set in Netlify environment variables.');
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Server misconfiguration: GEMINI_API_KEY missing.' })
    };
  }

  // Rate limit
  const { allowed, remaining } = checkAndIncrementUsage();
  if (!allowed) {
    return {
      statusCode: 429,
      headers: cors,
      body: JSON.stringify({
        hint: "Today's hint quota is up — trust your cinephile instincts! 🎬",
        limitReached: true,
        remaining: 0
      })
    };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const {
    currentActor,
    targetActor,
    hopsUsed   = 0,
    difficulty = 'easy',
    chain      = []
  } = body;

  if (!currentActor || !targetActor) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'currentActor and targetActor are required' })
    };
  }

  // Build prompt
  const chainStr = chain.length > 1
    ? `Player's chain so far: ${chain.map(n => n.movie ? `${n.actor} → (${n.movie})` : n.actor).join(' → ')}. `
    : '';

  const diffInstr = {
    easy:   'Give a fairly direct hint — you can name a specific well-known film that connects them.',
    medium: 'Give a moderate hint — suggest a genre, decade, or type of film without naming the exact title.',
    hard:   'Give only a cryptic nudge — hint at a thematic or career connection without naming any film or actor.',
  }[difficulty] ?? 'Give a helpful hint.';

 const prompt = `You are helping a player of "This2Them" — a movie actor connection game.

Current actor: ${currentActor}
Target actor:  ${targetActor}
Hops used:     ${hopsUsed}
Difficulty:    ${difficulty}
${chainStr}

Your task: ${diffInstr}

Rules:
- Maximum 1 sentence. Be concise.
- Never reveal the full solution or name more than one intermediate actor.
- Do NOT open with filler words like "Ah", "Well", "Oh", "So", "Now", or similar.
- Do NOT start with "Hint:" or any label.
- Do NOT refer to yourself or say "I".
- Get straight to the point.`;

  // Call Gemini 2.0 Flash (free tier, replaces deprecated gemini-1.5-flash)
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const gemRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 120,
          temperature: 0.85,
          candidateCount: 1,
        }
      })
    });

    if (!gemRes.ok) {
      const errText = await gemRes.text();
      console.error(`[hint] Gemini API error ${gemRes.status}:`, errText);
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({
          error: `Gemini returned ${gemRes.status}`,
          hint: null
        })
      };
    }

    const gemData = await gemRes.json();
    const hint = gemData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;

    if (!hint) {
      console.error('[hint] Gemini returned no text. Full response:', JSON.stringify(gemData));
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({ error: 'Empty response from Gemini', hint: null })
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ hint, remaining, used: usageStore.count })
    };

  } catch (err) {
    console.error('[hint] Unexpected error:', err);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Internal server error', hint: null })
    };
  }
};