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


function firstRecord(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const d = payload.data !== undefined ? payload.data : payload;
  if (Array.isArray(d)) return d[0] || null;
  if (d && Array.isArray(d.data)) return d.data[0] || null;
  if (d && Array.isArray(d.users)) return d.users[0] || null;
  if (d && Array.isArray(d.channels)) return d.channels[0] || null;
  if (d && Array.isArray(d.livestreams)) return d.livestreams[0] || null;
  return d && typeof d === 'object' ? d : null;
}

function records(payload) {
  if (!payload || typeof payload !== 'object') return [];
  let value = payload.data !== undefined ? payload.data : payload;
  if (value && !Array.isArray(value) && Array.isArray(value.data)) value = value.data;
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.livestreams)) return value.livestreams;
  if (value && Array.isArray(value.channels)) return value.channels;
  if (value && Array.isArray(value.users)) return value.users;
  return value && typeof value === 'object' ? [value] : [];
}

let appAccessToken = '';
let appAccessTokenExpiresAt = 0;
let appAccessTokenPromise = null;

async function getAppAccessToken() {
  if (appAccessToken && Date.now() < appAccessTokenExpiresAt - 60000) return appAccessToken;
  if (appAccessTokenPromise) return appAccessTokenPromise;
  const c = getConfig();
  if (!c.clientId || !c.clientSecret) throw new Error('إعدادات التطبيق غير مكتملة.');
  appAccessTokenPromise = (async () => {
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: c.clientId,
      client_secret: c.clientSecret
    });
    const result = await kickRequest(`${OAUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    if (result.status < 200 || result.status >= 300 || !result.data?.access_token) {
      throw new Error('تعذر تحميل بيانات القناة الآن.');
    }
    appAccessToken = String(result.data.access_token);
    const lifetime = Math.max(120, Number(result.data.expires_in) || 3600);
    appAccessTokenExpiresAt = Date.now() + lifetime * 1000;
    return appAccessToken;
  })();
  try { return await appAccessTokenPromise; }
  finally { appAccessTokenPromise = null; }
}

async function tryGetInternalChannel(slug) {
  // Supplement the official channel data with the chat-room identifier used by Kick's web client.
  // This is optional: public profile rendering still works if this secondary source changes.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);
  try {
    const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Referer: `https://kick.com/${encodeURIComponent(slug)}`,
        Origin: 'https://kick.com'
      },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = await readResponse(response);
    const root = payload?.data || payload;
    return root && typeof root === 'object' ? root : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractChatRoomId(value) {
  const seen = new Set();
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (item.chatroom_id != null && String(item.chatroom_id).trim()) return String(item.chatroom_id);
    if (item.chatroomId != null && String(item.chatroomId).trim()) return String(item.chatroomId);
    if (item.chatroom && typeof item.chatroom === 'object') {
      const id = item.chatroom.id || item.chatroom.chatroom_id;
      if (id != null && String(id).trim()) return String(id);
    }
    for (const key of ['data', 'channel', 'user', 'broadcaster_user', 'creator', 'livestream', 'live_stream']) {
      if (item[key] && typeof item[key] === 'object') stack.push(item[key]);
    }
  }
  return null;
}

async function buildProfileBySlug(slug, auth) {
  const headers = { Authorization: auth };
  const [channelResult, internal] = await Promise.all([
    kickRequest(`${API_BASE}/channels?slug=${encodeURIComponent(slug)}`, { method: 'GET', headers }),
    tryGetInternalChannel(slug)
  ]);
  if (channelResult.status < 200 || channelResult.status >= 300) {
    return { status: channelResult.status, data: channelResult.data };
  }
  const channel = firstRecord(channelResult.data);
  if (!channel) return { status: 404, data: { message: 'لم يتم العثور على هذا الحساب.' } };

  const userId = channel.broadcaster_user_id || channel.user_id || channel.user?.id || channel.broadcaster_user?.id || channel.creator?.id;
  let user = channel.user || channel.broadcaster_user || channel.creator || null;
  let livestreams = [];
  const tasks = [];
  if (userId != null) {
    tasks.push(kickRequest(`${API_BASE}/users?id=${encodeURIComponent(String(userId))}`, { method: 'GET', headers }).then(r => ({ kind: 'user', result: r })));
    tasks.push(kickRequest(`${API_BASE}/users/livestreams?user_id=${encodeURIComponent(String(userId))}`, { method: 'GET', headers }).then(r => ({ kind: 'livestreams', result: r })));
  }
  const results = await Promise.allSettled(tasks);
  for (const item of results) {
    if (item.status !== 'fulfilled') continue;
    const { kind, result } = item.value;
    if (result.status < 200 || result.status >= 300) continue;
    if (kind === 'user') {
      const candidate = firstRecord(result.data);
      const candidateId = candidate && (candidate.user_id || candidate.id || candidate.streamer_id);
      if (candidate && (userId == null || candidateId == null || String(candidateId) === String(userId))) user = candidate;
    } else if (kind === 'livestreams') {
      livestreams = records(result.data);
    }
  }
  if (!user) user = {};
  const slugName = String(channel.slug || slug);
  user = {
    ...user,
    user_id: user.user_id || user.id || userId || null,
    id: user.id || user.user_id || userId || null,
    username: user.username || user.name || slugName,
    slug: user.slug || slugName,
    profile_picture: user.profile_picture || channel.profile_picture || channel.user?.profile_picture || '',
    bio: user.bio || channel.channel_description || ''
  };
  const mappedStreams = livestreams.map(stream => ({
    ...stream,
    slug: stream?.channel?.slug || stream?.slug || slugName,
    stream_title: stream?.title || stream?.stream_title || channel.stream_title || '',
    category: stream?.category || channel.category || null,
    language: stream?.language_code || stream?.language || channel.language || '',
    thumbnail: stream?.thumbnail || stream?.thumbnail_url || '',
    started_at: stream?.started_at || stream?.start_time || null,
    viewer_count: stream?.viewer_count ?? 0
  }));
  const liveStream = mappedStreams[0] || null;
  const internalRoomId = extractChatRoomId(internal);
  const channelForProfile = {
    ...channel,
    slug: channel.slug || slugName,
    profile_picture: user.profile_picture || channel.profile_picture || '',
    user,
    stream: liveStream ? {
      ...(channel.stream && typeof channel.stream === 'object' ? channel.stream : {}),
      is_live: true,
      viewer_count: liveStream.viewer_count,
      started_at: liveStream.started_at,
      thumbnail: liveStream.thumbnail
    } : (channel.stream || null)
  };
  if (internalRoomId) {
    channelForProfile.chatroom_id = internalRoomId;
    channelForProfile.chatroom = { id: internalRoomId };
  }
  const chatMeta = {
    ...channelForProfile,
    id: channelForProfile.id || channelForProfile.broadcaster_user_id || user.user_id,
    broadcaster_user_id: channelForProfile.broadcaster_user_id || user.user_id,
    profile_pic: user.profile_picture,
    profile_picture: user.profile_picture,
    is_live: !!liveStream || !!(channel.stream && channel.stream.is_live === true),
    livestream: liveStream ? {
      ...liveStream,
      is_live: true,
      title: liveStream.stream_title || liveStream.title || channel.stream_title || '',
      category: liveStream.category || channel.category || null
    } : (channel.stream && channel.stream.is_live === true ? { ...channel.stream, is_live: true } : null),
    chatroom_id: internalRoomId || null,
    playback_url: String(internal?.playback_url || internal?.livestream?.playback_url || internal?.live_stream?.playback_url || liveStream?.playback_url || '')
  };
  return {
    status: 200,
    data: {
      data: chatMeta,
      user,
      channel: channelForProfile,
      livestreams: mappedStreams,
      target_user_id: user.user_id || channelForProfile.broadcaster_user_id || null,
      errors: []
    }
  };
}

async function handleProfile(req, res) {
  if (!methodOnly(req, res, ['GET'])) return;
  if (!originAllowed(req, res)) return;
  const slug = String(req.query?.slug || '').trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?kick\.com\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  if (slug && !/^[a-z0-9_-]{1,50}$/.test(slug)) return sendJson(res, 400, { message: 'اسم المستخدم غير صالح.' });
  const authHeader = req.headers.authorization;
  let auth = authHeader && /^Bearer\s+\S+$/i.test(authHeader) ? authHeader : '';
  try {
    if (slug) {
      // Public profiles do not require the visitor to connect their own account.
      if (!auth) auth = `Bearer ${await getAppAccessToken()}`;
      const result = await buildProfileBySlug(slug, auth);
      return sendJson(res, result.status, result.data);
    }
    if (!auth) return sendJson(res, 401, { message: 'سجّل الدخول لعرض حسابك.' });
    const ownUserResult = await kickRequest(`${API_BASE}/users`, { method: 'GET', headers: { Authorization: auth } });
    if (ownUserResult.status < 200 || ownUserResult.status >= 300) return sendJson(res, ownUserResult.status, ownUserResult.data);
    const ownUser = firstRecord(ownUserResult.data);
    const userId = ownUser && (ownUser.user_id || ownUser.id || ownUser.streamer_id);
    const ownSlug = ownUser && (ownUser.username || ownUser.slug);
    if (!userId && !ownSlug) return sendJson(res, 502, { message: 'تعذر تحديد الحساب الحالي.' });
    const result = ownSlug ? await buildProfileBySlug(String(ownSlug), auth) : null;
    if (result && result.status >= 200 && result.status < 300) {
      result.data.user = { ...result.data.user, ...ownUser };
      result.data.data.user = result.data.user;
      return sendJson(res, 200, result.data);
    }
    const channelResult = await kickRequest(`${API_BASE}/channels?broadcaster_user_id=${encodeURIComponent(String(userId))}`, { method: 'GET', headers: { Authorization: auth } });
    const channel = firstRecord(channelResult.data);
    if (channelResult.status < 200 || channelResult.status >= 300 || !channel) return sendJson(res, channelResult.status || 502, channelResult.data || { message: 'تعذر تحميل ملف الحساب.' });
    return sendJson(res, 200, { user: ownUser, channel, livestreams: [], target_user_id: userId, data: { ...channel, user: ownUser, is_live: false, livestream: null } });
  } catch (error) {
    return sendJson(res, 502, { message: String(error?.message || 'تعذر تحميل الملف الشخصي الآن.') });
  }
}


async function handleChatRoom(req, res) {
  if (!methodOnly(req, res, ['GET'])) return;
  if (!originAllowed(req, res)) return;
  const slug = String(req.query?.slug || '').trim().replace(/^@+/, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  if (!/^[a-z0-9_-]{1,50}$/.test(slug)) return sendJson(res, 400, { message: 'اسم القناة غير صالح.' });
  try {
    const channel = await tryGetInternalChannel(slug);
    const roomId = extractChatRoomId(channel);
    if (!channel || !roomId) return sendJson(res, 404, { message: 'المحادثة غير متاحة الآن.' });
    const live = channel.livestream || channel.live_stream || null;
    return sendJson(res, 200, {
      chatroom_id: String(roomId),
      slug: String(channel.slug || slug),
      is_live: channel.is_live === true || !!(live && live.is_live === true),
      title: String(channel.stream_title || channel.session_title || (live && (live.title || live.session_title)) || ''),
      profile_picture: String(channel.profile_pic || channel.profile_picture || ''),
      started_at: channel.started_at || (live && (live.started_at || live.start_time)) || null
    });
  } catch {
    return sendJson(res, 502, { message: 'تعذر فتح المحادثة الآن.' });
  }
}

function historyMessageCount(payload) {
  const candidates = [payload, payload?.data, payload?.result, payload?.history, payload?.data?.data];
  for (const root of candidates) {
    if (Array.isArray(root)) return root.length;
    if (!root || typeof root !== 'object') continue;
    for (const key of ['messages', 'history', 'items', 'data']) {
      const rows = root[key];
      if (Array.isArray(rows)) return rows.length;
      if (rows && Array.isArray(rows.data)) return rows.data.length;
    }
  }
  return -1;
}

function historyWithSource(payload, source) {
  if (Array.isArray(payload)) return { messages: payload, __bbkHistorySource: source };
  if (payload && typeof payload === 'object') return { ...payload, __bbkHistorySource: source };
  return { messages: [], __bbkHistorySource: source };
}

async function fetchLegacyChannelHistory(channelId, cursor) {
  const url = new URL(`https://kick.com/api/v2/channels/${encodeURIComponent(String(channelId))}/messages`);
  if (cursor) url.searchParams.set('cursor', cursor);
  return kickRequest(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Referer: `https://kick.com/`,
      Origin: 'https://kick.com'
    },
    signal: AbortSignal.timeout(8500)
  });
}

async function handleHistory(req, res) {
  if (!methodOnly(req, res, ['GET'])) return;
  if (!originAllowed(req, res)) return;
  const roomId = String(req.query?.chatroom_id || req.query?.room_id || '').trim();
  if (!/^\d{1,24}$/.test(roomId)) return sendJson(res, 400, { message: 'تعذر تحديد المحادثة المطلوبة.' });
  const cursor = String(req.query?.cursor || '').trim();
  if (cursor.length > 500) return sendJson(res, 400, { message: 'تعذر تحميل المزيد من الرسائل.' });
  const channelIdInput = String(req.query?.channel_id || '').trim();
  const slug = String(req.query?.slug || '').trim().toLowerCase();
  const requestedSource = String(req.query?.source || 'auto').trim().toLowerCase();
  if (!['auto', 'current', 'legacy'].includes(requestedSource)) return sendJson(res, 400, { message: 'مصدر سجل الرسائل غير صالح.' });

  let currentResult = null;
  if (requestedSource !== 'legacy') {
    const url = new URL(`https://web.kick.com/api/v1/chat/${encodeURIComponent(roomId)}/history`);
    if (cursor) url.searchParams.set('cursor', cursor);
    try {
      currentResult = await kickRequest(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json', Referer: 'https://kick.com/', Origin: 'https://kick.com' },
        signal: AbortSignal.timeout(8500)
      });
      if (currentResult.status >= 200 && currentResult.status < 300) {
        const count = historyMessageCount(currentResult.data);
        if (requestedSource === 'current' || count > 0 || (currentResult.data?.cursor || currentResult.data?.next_cursor)) {
          return sendJson(res, 200, historyWithSource(currentResult.data, 'current'));
        }
      }
    } catch { /* proceed to the legacy history fallback */ }
  }

  if (requestedSource !== 'current') {
    let channelId = /^\d{1,24}$/.test(channelIdInput) ? channelIdInput : '';
    if (!channelId && slug && /^[a-z0-9_-]{1,60}$/.test(slug)) {
      const internal = await tryGetInternalChannel(slug);
      const candidate = internal && (internal.id || internal.channel_id || internal.channel?.id);
      if (candidate != null && /^\d{1,24}$/.test(String(candidate))) channelId = String(candidate);
    }
    if (channelId) {
      try {
        const legacy = await fetchLegacyChannelHistory(channelId, requestedSource === 'legacy' ? cursor : cursor);
        if (legacy.status >= 200 && legacy.status < 300) {
          const count = historyMessageCount(legacy.data);
          if (requestedSource === 'legacy' || count > 0 || legacy.data?.cursor || legacy.data?.next_cursor) {
            return sendJson(res, 200, historyWithSource(legacy.data, 'legacy'));
          }
        }
      } catch { /* retain the result from the current history endpoint below */ }
    }
  }

  if (currentResult && currentResult.status >= 200 && currentResult.status < 300) {
    return sendJson(res, 200, historyWithSource(currentResult.data, 'current'));
  }
  return sendJson(res, 502, { message: 'تعذر تحميل الرسائل السابقة الآن.' });
}

async function handleModeration(req, res) {
  if (!methodOnly(req, res, ['POST'])) return;
  if (!originAllowed(req, res)) return;
  const auth = req.headers.authorization;
  if (!auth || !/^Bearer\s+\S+$/i.test(auth)) return sendJson(res, 401, { message: 'سجّل الدخول بحساب لديه صلاحية الإشراف أولًا.' });
  const b = bodyObject(req);
  const action = String(b.action || '');
  const broadcasterId = Number(b.broadcaster_user_id);
  const userId = Number(b.user_id);
  if (!['ban','timeout','unban'].includes(action)) return sendJson(res, 400, { message: 'إجراء الإشراف غير معروف.' });
  if (!Number.isSafeInteger(broadcasterId) || broadcasterId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) {
    return sendJson(res, 400, { message: 'معرّف القناة ومعرّف المستخدم مطلوبان.' });
  }
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
  if (action === 'timeout') {
    const duration = Number(b.duration);
    if (!Number.isInteger(duration) || duration < 1 || duration > 10080) return sendJson(res, 400, { message: 'مدة الـTimeout يجب أن تكون من 1 إلى 10080 دقيقة.' });
  }
  const payload = { broadcaster_user_id: broadcasterId, user_id: userId };
  if (reason) payload.reason = reason;
  if (action === 'timeout') payload.duration = Number(b.duration);
  try {
    let upstream;
    if (action === 'unban') {
      const q = new URLSearchParams({ broadcaster_user_id: String(broadcasterId), user_id: String(userId) });
      upstream = await kickRequest(`${API_BASE}/moderation/bans?${q.toString()}`, { method: 'DELETE', headers: { Authorization: auth } });
    } else {
      upstream = await kickRequest(`${API_BASE}/moderation/bans`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    return sendJson(res, upstream.status, upstream.data);
  } catch (error) {
    return sendJson(res, 502, { message: 'تعذر الاتصال بواجهة الإشراف في Kick.', details: String(error?.message || 'upstream request failed') });
  }
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
      case 'kick/profile': return await handleProfile(req, res);
      case 'kick/room': return await handleChatRoom(req, res);
      case 'kick/history': return await handleHistory(req, res);
      case 'kick/moderation': return await handleModeration(req, res);
      case 'kick/chat': return await handleChat(req, res);
      default: return sendJson(res, 404, { message: 'Unknown API route.' });
    }
  } catch (error) {
    return sendJson(res, 500, { message: 'Unexpected API error.', details: String(error?.message || 'unknown error') });
  }
}
