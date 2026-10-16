const OAUTH_BASE = 'https://id.kick.com';
const API_BASE = 'https://api.kick.com/public/v1';

function sendJson(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(status).json(data);
}

function methodOnly(req, res, methods) {
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    sendJson(res, 405, { message: 'Method not allowed.' });
    return false;
  }
  return true;
}

function getConfig() {
  return {
    clientId: String(process.env.KICK_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.KICK_CLIENT_SECRET || ''),
    redirectUri: String(process.env.KICK_REDIRECT_URI || '').trim()
  };
}

function missingConfig(c, needsSecret = true) {
  const missing = [];
  if (!c.clientId) missing.push('KICK_CLIENT_ID');
  if (needsSecret && !c.clientSecret) missing.push('KICK_CLIENT_SECRET');
  if (!c.redirectUri) missing.push('KICK_REDIRECT_URI');
  return missing;
}

function originAllowed(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let expected;
  try { expected = new URL(getConfig().redirectUri).origin; }
  catch { sendJson(res, 503, { message: 'KICK_REDIRECT_URI is missing or invalid in Vercel Environment Variables.' }); return false; }
  if (origin !== expected) {
    sendJson(res, 403, { message: 'Request origin does not match the configured Kick redirect domain.' });
    return false;
  }
  return true;
}

function bodyObject(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch {} }
  return {};
}

async function readResponse(response) {
  const raw = await response.text();
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { return { message: raw.slice(0, 1200) }; }
}

async function kickRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(18000),
    headers: { Accept: 'application/json', ...(options.headers || {}) }
  });
  return { status: response.status, data: await readResponse(response) };
}

async function handleHealth(req, res) {
  if (!methodOnly(req, res, ['GET'])) return;
  const missing = missingConfig(getConfig(), true);
  return sendJson(res, missing.length ? 503 : 200, {
    ok: missing.length === 0,
    service: 'BadBoy Kick Vercel API',
    environment: 'Vercel serverless functions',
    missingEnvironmentVariables: missing
  });
}

async function handleConfig(req, res) {
  if (!methodOnly(req, res, ['GET'])) return;
  const c = getConfig();
  const missing = missingConfig(c, true);
  if (missing.length) return sendJson(res, 503, {
    message: 'Kick OAuth is not configured yet. Add the required Environment Variables in Vercel.',
    missingEnvironmentVariables: missing
  });
  let redirect;
  try { redirect = new URL(c.redirectUri); }
  catch { return sendJson(res, 503, { message: 'KICK_REDIRECT_URI must be an absolute URL.' }); }
  if (redirect.protocol !== 'https:' && redirect.hostname !== 'localhost') {
    return sendJson(res, 503, { message: 'KICK_REDIRECT_URI must use HTTPS.' });
  }
  return sendJson(res, 200, { client_id: c.clientId, redirect_uri: c.redirectUri });
}

async function handleToken(req, res) {
  if (!methodOnly(req, res, ['POST'])) return;
  if (!originAllowed(req, res)) return;
  const c = getConfig();
  const missing = missingConfig(c, true);
  if (missing.length) return sendJson(res, 503, { message: 'OAuth server is not configured.', missingEnvironmentVariables: missing });
  const b = bodyObject(req);
  if (b.grant_type !== 'authorization_code' || !b.code || !b.code_verifier) {
    return sendJson(res, 400, { message: 'Missing authorization code, code verifier, or grant_type.' });
  }
  if (String(b.redirect_uri || '') !== c.redirectUri) {
    return sendJson(res, 400, { message: 'redirect_uri does not exactly match KICK_REDIRECT_URI in Vercel.' });
  }
  const form = new URLSearchParams({
    grant_type: 'authorization_code', client_id: c.clientId,
    client_secret: c.clientSecret, redirect_uri: c.redirectUri,
    code: String(b.code), code_verifier: String(b.code_verifier)
  });
  try {
    const upstream = await kickRequest(`${OAUTH_BASE}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    return sendJson(res, upstream.status, upstream.data);
  } catch (error) {
    return sendJson(res, 502, { message: 'Could not reach Kick OAuth token endpoint.', details: String(error?.message || 'upstream request failed') });
  }
}

async function handleRefresh(req, res) {
  if (!methodOnly(req, res, ['POST'])) return;
  if (!originAllowed(req, res)) return;
  const c = getConfig();
  const missing = missingConfig(c, true);
  if (missing.length) return sendJson(res, 503, { message: 'OAuth server is not configured.', missingEnvironmentVariables: missing });
  const b = bodyObject(req);
  if (!b.refresh_token || typeof b.refresh_token !== 'string' || b.refresh_token.length > 8192) {
    return sendJson(res, 400, { message: 'A valid refresh_token is required.' });
  }
  const form = new URLSearchParams({
    grant_type: 'refresh_token', client_id: c.clientId,
    client_secret: c.clientSecret, refresh_token: b.refresh_token
  });
  try {
    const upstream = await kickRequest(`${OAUTH_BASE}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    return sendJson(res, upstream.status, upstream.data);
  } catch (error) {
    return sendJson(res, 502, { message: 'Could not reach Kick OAuth refresh endpoint.', details: String(error?.message || 'upstream request failed') });
  }
}

async function handleMe(req, res) {
  if (!methodOnly(req, res, ['GET'])) return;
  if (!originAllowed(req, res)) return;
  const auth = req.headers.authorization;
  if (!auth || !/^Bearer\s+\S+$/i.test(auth)) return sendJson(res, 401, { message: 'A valid Kick user access token is required.' });
  try {
    const upstream = await kickRequest(`${API_BASE}/users`, { method: 'GET', headers: { Authorization: auth } });
    return sendJson(res, upstream.status, upstream.data);
  } catch (error) {
    return sendJson(res, 502, { message: 'Could not reach Kick user API.', details: String(error?.message || 'upstream request failed') });
  }
}

function graphemeCount(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length;
  return Array.from(text).length;
}

async function handleChat(req, res) {
  if (!methodOnly(req, res, ['POST'])) return;
  if (!originAllowed(req, res)) return;
  const auth = req.headers.authorization;
  if (!auth || !/^Bearer\s+\S+$/i.test(auth)) return sendJson(res, 401, { message: 'A valid Kick user access token is required.' });
  const b = bodyObject(req);
  const content = typeof b.content === 'string' ? b.content.trim() : '';
  const type = b.type === 'bot' ? 'bot' : b.type === 'user' ? 'user' : '';
  if (!content || !type) return sendJson(res, 400, { message: 'type (user or bot) and non-empty content are required.' });
  if (graphemeCount(content) > 500 || Buffer.byteLength(content, 'utf8') > 2048) {
    return sendJson(res, 400, { message: 'Kick chat messages must be at most 500 characters and 2048 UTF-8 bytes.' });
  }
  const payload = { type, content };
  if (type === 'user') {
    const id = Number(b.broadcaster_user_id);
    if (!Number.isSafeInteger(id) || id <= 0) return sendJson(res, 400, { message: 'broadcaster_user_id is required when sending as user.' });
    payload.broadcaster_user_id = id;
  }
  if (b.reply_to_message_id !== undefined && b.reply_to_message_id !== null && String(b.reply_to_message_id).trim()) {
    payload.reply_to_message_id = String(b.reply_to_message_id).trim();
  }
  try {
    const upstream = await kickRequest(`${API_BASE}/chat`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return sendJson(res, upstream.status, upstream.data);
  } catch (error) {
    return sendJson(res, 502, { message: 'Could not reach Kick chat API.', details: String(error?.message || 'upstream request failed') });
  }
}

export default async function handler(req, res) {
  const route = String(req.query?.route || '').replace(/^\/+|\/+$/g, '');
  try {
    switch (route) {
      case 'health': return await handleHealth(req, res);
      case 'kick/config': return await handleConfig(req, res);
      case 'kick/oauth/token': return await handleToken(req, res);
      case 'kick/oauth/refresh': return await handleRefresh(req, res);
      case 'kick/me': return await handleMe(req, res);
      case 'kick/chat': return await handleChat(req, res);
      default: return sendJson(res, 404, { message: 'Unknown API route.' });
    }
  } catch (error) {
    return sendJson(res, 500, { message: 'Unexpected API error.', details: String(error?.message || 'unknown error') });
  }
}
