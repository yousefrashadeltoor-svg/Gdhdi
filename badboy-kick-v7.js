(function () {
  'use strict';

  const D = document;
  const $ = (id) => D.getElementById(id);
  const DS_KEY = 'badboykick_data_saver_options_v1';
  const SNIPPETS_KEY = 'badboykick_chat_snippets_v1';
  const SCHEDULES_KEY = 'badboykick_chat_schedules_v1';
  const QUEUE_KEY = 'badboykick_chat_send_queue_v1';
  const EVENTS_KEY = 'badboykick_chat_event_log_v1';
  const BACKUP_FORMAT = 'BBK-V7-ENCRYPTED-BACKUP';
  const defaults = {
    disableStream: false,
    pauseChat: false,
    pauseHistory: false,
    hideUserImages: false,
    hideChannelImages: false,
    hideEmotes: false,
    manualVideo: false,
    lowQuality: false,
    smartQuality: true,
    disableReconnect: false,
    disableAutoRefresh: false,
    reduceRequests: false,
    reduceMotion: false
  };
  let dataSaver = loadDataSaver();
  let priorPhase = 'chat';
  let snippets = readJson(SNIPPETS_KEY, []);
  let schedules = readJson(SCHEDULES_KEY, []);
  let queue = readJson(QUEUE_KEY, []);
  let events = readJson(EVENTS_KEY, []);
  let hlsInstance = null;
  let hlsScriptPromise = null;
  let scheduleBusy = new Set();
  let qualityTimer = null;
  let virtualTrimBusy = false;
  let browsingOlder = false;
  let lastToast = null;

  function readJson(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value == null ? fallback : value; }
    catch (_) { return fallback; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage may be full */ }
  }
  function loadDataSaver() {
    const saved = readJson(DS_KEY, {});
    return Object.assign({}, defaults, saved && typeof saved === 'object' ? saved : {});
  }
  function on(key) { return !!dataSaver[key]; }
  function saveDataSaver() { saveJson(DS_KEY, dataSaver); }
  window.BBKDataSaver = {
    settings: dataSaver,
    on,
    getAll: () => Object.assign({}, dataSaver),
    set(key, value) {
      if (!(key in defaults)) return;
      const before = !!dataSaver[key];
      dataSaver[key] = !!value;
      saveDataSaver();
      applyDataSaver(key, before);
      renderDataSaverPage();
    }
  };

  function addStyle() {
    if ($('bbk-v7-style')) return;
    const style = D.createElement('style');
    style.id = 'bbk-v7-style';
    style.textContent = `
      .bbk-v7-button-row{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}
      .bbk-v7-button-row .btn{font-size:11px;min-height:34px}
      .bbk-v7-data-page{width:100%;}
      .bbk-v7-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:14px}
      .bbk-v7-setting{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid rgba(255,255,255,.11);border-radius:12px;background:rgba(255,255,255,.025);min-width:0}
      .bbk-v7-setting input{width:20px;height:20px;flex:0 0 20px;accent-color:#53fc18}
      .bbk-v7-setting-copy{min-width:0;flex:1}.bbk-v7-setting-copy b{display:block;font-size:12px;color:var(--fg)}
      .bbk-v7-setting-copy small{display:block;margin-top:4px;font-size:10px;line-height:1.6;color:var(--muted)}
      .bbk-v7-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 10px;border-top:1px solid rgba(255,255,255,.07);border-bottom:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.018)}
      .bbk-v7-toolbar .btn{font-size:10px;padding:7px 10px}
      .bbk-v7-emotes{display:flex;gap:4px;overflow:auto;max-width:100%;padding:5px 0;scrollbar-width:thin}
      .bbk-v7-emote{display:flex;flex:0 0 34px;width:34px;height:34px;align-items:center;justify-content:center;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.12);border-radius:8px;cursor:pointer;padding:3px;color:var(--fg)}
      .bbk-v7-emote img{max-width:27px;max-height:27px;object-fit:contain}
      .bbk-v7-search{display:flex;gap:6px;align-items:center;flex:1;min-width:120px}.bbk-v7-search input{padding:7px 9px;border-radius:8px;min-width:0;font-size:11px}
      .bbk-v7-stats{display:flex;gap:6px;flex-wrap:wrap;padding:7px 10px;color:var(--muted);font-size:10px}
      .bbk-v7-stat{padding:4px 7px;border-radius:7px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.075)}
      .bbk-v7-log-row,.bbk-v7-saved-row,.bbk-v7-schedule-row,.bbk-v7-queue-row{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:9px 10px;border:1px solid rgba(255,255,255,.1);border-radius:9px;background:rgba(255,255,255,.025);margin:6px 0;min-width:0}
      .bbk-v7-row-main{min-width:0;flex:1}.bbk-v7-row-main b{display:block;font-size:11px;overflow-wrap:anywhere}.bbk-v7-row-main small{display:block;font-size:9px;line-height:1.6;color:var(--muted);overflow-wrap:anywhere;margin-top:3px}
      .bbk-v7-quality-control{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted)}.bbk-v7-quality-control select{padding:6px 7px;font-size:10px;width:auto;min-width:85px}
      .chat-message{content-visibility:auto;contain-intrinsic-size:auto 82px}
      html.bbk-v7-reduced-motion *,html.bbk-v7-reduced-motion *:before,html.bbk-v7-reduced-motion *:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
      .bbk-v7-muted{color:var(--muted);font-size:10px;line-height:1.7}
      .bbk-v7-divider{height:1px;background:rgba(255,255,255,.1);margin:12px 0}
      @media(max-width:650px){.bbk-v7-settings-grid{grid-template-columns:1fr}.bbk-v7-toolbar{padding:6px;gap:4px}.bbk-v7-toolbar .btn{font-size:9px;padding:6px 7px}.bbk-v7-row-actions{display:flex;gap:4px;flex-wrap:wrap}}
    `;
    D.head.appendChild(style);
  }

  const settingsInfo = [
    ['disableStream','إيقاف تحميل البث','يوقف مشغّل الفيديو ويمنع إعادة تحميله حتى إيقاف هذا الخيار.'],
    ['pauseChat','إيقاف الشات المباشر','يفصل اتصال الشات ويوقف التحديثات الدورية الجديدة؛ تقدر تستمر في استعراض الرسائل الموجودة.'],
    ['pauseHistory','إيقاف جلب الرسائل السابقة','يوقف طلبات سجل Kick من الشبكة، مع الاحتفاظ بإمكانية عرض الأرشيف المحلي.'],
    ['hideUserImages','إيقاف صور المستخدمين','يمنع تحميل صور الحسابات وصور أصحاب الرسائل ووجوههم المصغرة.'],
    ['hideChannelImages','إيقاف صور القنوات والبثوث','يمنع تحميل صور البطاقات والصور المصغرة للبث.'],
    ['hideEmotes','إيقاف صور الستيكرات','يعرض اسم الاستيكر بدل تحميل صورته.'],
    ['manualVideo','تحميل البث عند الطلب فقط','لن يبدأ الفيديو تلقائيًا عند فتح القناة؛ اضغط زر تحديث/تشغيل البث عند الحاجة.'],
    ['lowQuality','أقل جودة فيديو متاحة','عند استخدام مصدر HLS فعلي، يختار أقل مستوى جودة متاح.'],
    ['smartQuality','ضبط الجودة حسب الاتصال','يخفض ويرفع مستوى HLS الفعلي حسب الـBuffer وسرعة الشبكة.'],
    ['disableReconnect','إيقاف إعادة الاتصال التلقائية','لو انقطع الشات، ينتظر تدخلًا يدويًا بدل إعادة الاتصال تلقائيًا.'],
    ['disableAutoRefresh','إيقاف تحديث القنوات عند فتح الصفحة','يمنع طلب التحديث التلقائي لقائمة القنوات؛ زر التحديث اليدوي يظل متاحًا.'],
    ['reduceRequests','تقليل طلبات الشبكة المتوازية','يقلل عدد محاولات الوسطاء لجلب بيانات القناة.'],
    ['reduceMotion','تقليل الحركة البصرية','يوقف الأنيميشن والانتقالات لتقليل استخدام المعالج والبطارية.']
  ];

  function currentPhase() {
    const active = D.querySelector('.phase.active');
    return active ? active.id.replace(/^ph-/, '') : 'main';
  }
  function ensureDataSaverPage() {
    if ($('ph-datasaver')) return;
    const app = D.querySelector('.app-container');
    if (!app) return;
    const page = D.createElement('section');
    page.className = 'phase bbk-v7-data-page';
    page.id = 'ph-datasaver';
    page.innerHTML = `
      <div class="back-bar"><button class="back-btn" type="button" onclick="closeDataSaverPage()"><i class="fas fa-arrow-right"></i><span>رجوع</span></button><div class="back-title">توفير البيانات</div></div>
      <div class="card">
        <div class="app-header" style="margin-bottom:10px"><div class="logo-img" style="display:flex;align-items:center;justify-content:center;background:rgba(83,252,24,.1);border-radius:12px;color:var(--accent)"><i class="fas fa-gauge-high"></i></div><div style="flex:1"><div class="app-name" style="font-size:21px">توفير البيانات</div><div class="app-tagline">اختار الخدمات التي تريد إيقافها أو تقليلها</div></div><button class="btn btn-fire btn-xs" type="button" onclick="enableFullDataSaver()"><i class="fas fa-leaf"></i> توفير أقصى</button></div>
        <p class="bbk-v7-muted">كل خيار هنا يوقف وظيفة محددة. تقدر تشغّل الخيارات أو توقفها بشكل منفصل، ثم تعود إلى القنوات من غير إعادة ضبط التطبيق.</p>
        <div id="bbkDataSaverSettings" class="bbk-v7-settings-grid"></div>
        <div class="bbk-v7-button-row"><button class="btn btn-ghost" type="button" onclick="resetDataSaver()"><i class="fas fa-rotate-left"></i> إعادة الوضع الطبيعي</button><button class="btn btn-fire" type="button" onclick="closeDataSaverPage()"><i class="fas fa-check"></i> تم</button></div>
      </div>`;
    app.appendChild(page);
  }
  function renderDataSaverPage() {
    const box = $('bbkDataSaverSettings');
    if (!box) return;
    box.innerHTML = settingsInfo.map(([key, title, description]) => `
      <label class="bbk-v7-setting"><input type="checkbox" data-bbk-ds="${key}" ${on(key) ? 'checked' : ''}><span class="bbk-v7-setting-copy"><b>${title}</b><small>${description}</small></span></label>`).join('');
    box.querySelectorAll('[data-bbk-ds]').forEach((input) => input.addEventListener('change', () => window.BBKDataSaver.set(input.dataset.bbkDs, input.checked)));
  }
  window.openDataSaverPage = function () { priorPhase = currentPhase(); ensureDataSaverPage(); renderDataSaverPage(); window.showPhase('datasaver'); };
  window.closeDataSaverPage = function () { window.showPhase(priorPhase && $('ph-' + priorPhase) ? priorPhase : 'main'); };
  window.enableFullDataSaver = function () {
    ['disableStream','pauseChat','pauseHistory','hideUserImages','hideChannelImages','hideEmotes','manualVideo','lowQuality','smartQuality','disableReconnect','disableAutoRefresh','reduceRequests'].forEach(k => dataSaver[k] = true);
    saveDataSaver(); applyDataSaver('all', false); if(window.__bbkChatRefreshPlayer)window.__bbkChatRefreshPlayer(false); renderDataSaverPage();
  };
  window.resetDataSaver = function () { const wasPaused=on('pauseChat'); dataSaver = Object.assign({}, defaults); window.BBKDataSaver.settings = dataSaver; saveDataSaver(); applyDataSaver('all', false); if(wasPaused&&window.__bbkChatSetNetwork)window.__bbkChatSetNetwork(true); if(window.__bbkChatRefreshPlayer)window.__bbkChatRefreshPlayer(true); renderDataSaverPage(); };

  function classifyImage(img) {
    if (img.matches('.kick-native-emote,.bbk-v7-emote img,.kick-emote-render img,.kick-emote-btn img,.kick-emote-tile img')) return 'hideEmotes';
    if (img.closest('.chat-channel-cover,.chat-channel-card,.stream-card,.stream-hub-card,.channel-card,.bot-channel-cover,.chat-stream-thumbnail,.stream-card-cover,.channel-thumbnail')) return 'hideChannelImages';
    if (img.matches('.chat-msg-avatar,.chat-channel-avatar,.chat-room-avatar,.chat-picker-avatar,.account-list-avatar img,.bot-avatar img') || img.closest('.chat-message-head,.chat-account-choice,.chat-room-header,.chat-account-picker,.account-list-avatar')) return 'hideUserImages';
    return '';
  }
  function applyImagePolicies(root) {
    const scope = root && root.querySelectorAll ? root : D;
    const imageNodes = [];
    if (root && root.nodeType === 1 && root.matches && root.matches('img')) imageNodes.push(root);
    scope.querySelectorAll('img').forEach((img) => imageNodes.push(img));
    imageNodes.forEach((img) => {
      const key = classifyImage(img);
      if (!key) return;
      if (on(key)) {
        if (img.getAttribute('src') && !img.dataset.bbkOriginalSrc) img.dataset.bbkOriginalSrc = img.getAttribute('src');
        if (img.getAttribute('srcset') && !img.dataset.bbkOriginalSrcset) img.dataset.bbkOriginalSrcset = img.getAttribute('srcset');
        img.removeAttribute('src'); img.removeAttribute('srcset');
        img.loading = 'lazy';
      } else {
        if (img.dataset.bbkOriginalSrc) { img.setAttribute('src', img.dataset.bbkOriginalSrc); delete img.dataset.bbkOriginalSrc; }
        if (img.dataset.bbkOriginalSrcset) { img.setAttribute('srcset', img.dataset.bbkOriginalSrcset); delete img.dataset.bbkOriginalSrcset; }
      }
    });
  }
  function applyDataSaver(changedKey, before) {
    D.documentElement.classList.toggle('bbk-v7-reduced-motion', on('reduceMotion'));
    applyImagePolicies(D);
    if (changedKey === 'all' || changedKey === 'pauseChat') {
      if (on('pauseChat') && window.__bbkChatSetNetwork) window.__bbkChatSetNetwork(false);
      else if (!on('pauseChat') && before && window.__bbkChatSetNetwork) window.__bbkChatSetNetwork(true);
    }
    if (changedKey !== 'all' && ['disableStream','manualVideo','lowQuality'].includes(changedKey) && window.__bbkChatRefreshPlayer) {
      window.__bbkChatRefreshPlayer(!on('manualVideo') && !on('disableStream'));
    }
    if (['all','hideUserImages','hideChannelImages','hideEmotes'].includes(changedKey)) {
      try { if (window.chatRenderCatalog) window.chatRenderCatalog(); } catch (_) {}
      try { if (window.chatRenderAccountOptions) window.chatRenderAccountOptions(); } catch (_) {}
      applyImagePolicies(D);
      updateEmoteToolbar();
    }
    updateToolbarState();
  }

  function addTopButtons() {
    const main = D.querySelector('#ph-main .app-header');
    if (main && !$('bbkDataSaverHomeBtn')) {
      const btn = D.createElement('button'); btn.id = 'bbkDataSaverHomeBtn'; btn.type = 'button'; btn.className = 'btn btn-ghost btn-xs'; btn.title = 'توفير البيانات'; btn.innerHTML = '<i class="fas fa-leaf"></i><span>توفير البيانات</span>'; btn.onclick = window.openDataSaverPage; main.appendChild(btn);
    }
    const headerActions = D.querySelector('.chat-page-header-actions');
    if (headerActions && !$('bbkDataSaverChatBtn')) {
      const btn = D.createElement('button'); btn.id = 'bbkDataSaverChatBtn'; btn.type = 'button'; btn.className = 'btn btn-ghost btn-sm'; btn.innerHTML = '<i class="fas fa-leaf"></i> توفير البيانات'; btn.onclick = window.openDataSaverPage; headerActions.appendChild(btn);
    }
  }

  function getModal(title, bodyHtml, maxWidth) {
    const overlay = D.createElement('div');
    overlay.className = 'modal-overlay open bbk-v7-modal';
    overlay.innerHTML = `<div class="modal" style="max-width:${maxWidth || 640}px"><button type="button" class="modal-x" aria-label="إغلاق"><i class="fas fa-xmark"></i></button><div class="modal-head"><div class="modal-title">${esc(title)}</div></div><div class="modal-divider"></div><div class="bbk-v7-modal-body">${bodyHtml}</div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>إغلاق</button></div></div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]') || e.target.closest('.modal-x')) overlay.remove(); });
    D.body.appendChild(overlay);
    return overlay;
  }
  function esc(value) {
    const node = D.createElement('span'); node.textContent = String(value == null ? '' : value); return node.innerHTML;
  }
  function formatDate(value) {
    try { return new Date(value).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'medium' }); } catch (_) { return String(value || ''); }
  }
  function persistEvents() { events = events.slice(-500); saveJson(EVENTS_KEY, events); }
  function track(kind, detail) {
    events.push({ id: 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), at: Date.now(), kind: String(kind || 'حدث'), detail: String(detail || '') });
    persistEvents(); updateStats();
  }
  function updateStats() {
    const host = $('bbkV7Stats'); if (!host) return;
    const messageCount = D.querySelectorAll('#chatMessages .chat-message').length;
    const accountCount = (typeof window.kickReadOAuthAccounts === 'function' ? window.kickReadOAuthAccounts().length : 0) + (Array.isArray(window.accounts) ? window.accounts.filter(a => a && a.token).length : 0);
    const status = $('chatNetworkLabel') ? $('chatNetworkLabel').textContent : '—';
    host.innerHTML = `<span class="bbk-v7-stat">الرسائل الظاهرة: <b>${messageCount}</b></span><span class="bbk-v7-stat">الحسابات: <b>${accountCount}</b></span><span class="bbk-v7-stat">قائمة الانتظار: <b>${queue.length}</b></span><span class="bbk-v7-stat">الاتصال: <b>${esc(status)}</b></span>`;
  }
  function updateToolbarState() {
    const q = $('bbkQueueBadgeV7'); if (q) q.textContent = String(queue.length);
    const btn = $('bbkDataSaverChatBtn'); if (btn) btn.classList.toggle('active-run', on('disableStream') || on('pauseChat') || on('pauseHistory'));
    updateStats();
  }

  function ensureToolbar() {
    const composer = $('chatComposer');
    if (!composer || $('bbkV7ToolsToolbar')) return;
    const toolbar = D.createElement('div'); toolbar.id = 'bbkV7ToolsToolbar'; toolbar.className = 'bbk-v7-toolbar';
    toolbar.innerHTML = `<button type="button" class="btn btn-ghost" id="bbkV7Snippets"><i class="fas fa-bookmark"></i> الرسائل المحفوظة</button><button type="button" class="btn btn-ghost" id="bbkV7Schedule"><i class="fas fa-calendar-clock"></i> جدولة الشات</button><button type="button" class="btn btn-ghost" id="bbkV7Queue"><i class="fas fa-clock"></i> الانتظار <b id="bbkQueueBadgeV7">0</b></button><button type="button" class="btn btn-ghost" id="bbkV7Events"><i class="fas fa-list-check"></i> سجل الأحداث</button><button type="button" class="btn btn-ghost" id="bbkV7Backup"><i class="fas fa-shield-halved"></i> النسخ الاحتياطي</button>`;
    const main = composer.querySelector('.chat-composer-main');
    if (main) composer.insertBefore(toolbar, main); else composer.prepend(toolbar);
    const emotes = D.createElement('div'); emotes.id = 'bbkV7Emotes'; emotes.className = 'bbk-v7-emotes'; emotes.setAttribute('aria-label', 'الستيكرات المستخدمة في هذه المحادثة');
    if (main) composer.insertBefore(emotes, main);
    const searchWrap = D.createElement('label'); searchWrap.className = 'bbk-v7-search'; searchWrap.innerHTML = `<i class="fas fa-magnifying-glass"></i><input id="bbkV7ChatSearch" type="search" placeholder="بحث داخل الرسائل المحمّلة..." aria-label="بحث داخل الشات"><button class="btn btn-ghost btn-xs" type="button" id="bbkV7ClearSearch">مسح</button>`;
    const hist = $('chatHistoryState');
    const histToolbar = hist && hist.parentElement;
    if (histToolbar) histToolbar.appendChild(searchWrap);
    const stats = D.createElement('div'); stats.id = 'bbkV7Stats'; stats.className = 'bbk-v7-stats';
    const area = $('chatMessages'); if (area && area.parentElement) area.parentElement.insertBefore(stats, area);
    $('bbkV7Snippets').onclick = openSnippetLibrary;
    $('bbkV7Schedule').onclick = openScheduler;
    $('bbkV7Queue').onclick = openQueue;
    $('bbkV7Events').onclick = openEventLog;
    $('bbkV7Backup').onclick = openBackupModal;
    $('bbkV7ChatSearch').addEventListener('input', filterChat);
    $('bbkV7ClearSearch').onclick = () => { $('bbkV7ChatSearch').value = ''; filterChat(); };
    updateEmoteToolbar(); updateStats();
  }
  function filterChat() {
    const q = String($('bbkV7ChatSearch')?.value || '').trim().toLowerCase();
    D.querySelectorAll('#chatMessages .chat-message').forEach((node) => { node.style.display = !q || node.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  }

  function updateEmoteToolbar() {
    const box = $('bbkV7Emotes'); if (!box) return;
    const found = new Map();
    D.querySelectorAll('#chatMessages .chat-message-text').forEach((node) => {
      const text = node.textContent || '';
      const re = /\[emote:(\d+):([^\]]+)\]/g; let match;
      while ((match = re.exec(text))) found.set(match[1], { id: match[1], name: match[2] });
      node.querySelectorAll('img.kick-native-emote,img').forEach((img) => {
        const m = String(img.src || '').match(/\/emotes\/(\d+)(?:\/|\?|$)/i);
        if (m) found.set(m[1], { id: m[1], name: img.alt || 'ستيكر' });
      });
    });
    box.innerHTML = '';
    Array.from(found.values()).slice(-30).forEach((item) => {
      const btn = D.createElement('button'); btn.type = 'button'; btn.className = 'bbk-v7-emote'; btn.title = item.name; btn.setAttribute('aria-label', 'إدراج ' + item.name);
      if (on('hideEmotes')) btn.textContent = '☺';
      else { const img = D.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.alt = item.name; img.src = 'https://files.kick.com/emotes/' + encodeURIComponent(item.id) + '/fullsize'; btn.appendChild(img); }
      btn.addEventListener('click', () => { const input = $('chatComposerInput'); if (!input) return; const token = '[emote:' + item.id + ':' + item.name + ']'; const start = input.selectionStart == null ? input.value.length : input.selectionStart; const end = input.selectionEnd == null ? input.value.length : input.selectionEnd; input.value = input.value.slice(0, start) + token + input.value.slice(end); input.focus(); input.setSelectionRange(start + token.length, start + token.length); if (typeof window.chatUpdateChars === 'function') window.chatUpdateChars(); });
      box.appendChild(btn);
    });
  }

  function openSnippetLibrary() {
    const body = `<div class="field"><label>اسم الرسالة</label><input id="bbkSnippetTitle" placeholder="مثال: ترحيب"></div><div class="field"><label>نص الرسالة</label><textarea id="bbkSnippetText" rows="3" placeholder="اكتب نصًا تحفظه لإعادة استخدامه"></textarea></div><button type="button" class="btn btn-fire btn-full" id="bbkSnippetAdd"><i class="fas fa-plus"></i> حفظ الرسالة</button><div class="bbk-v7-divider"></div><div id="bbkSnippetList"></div>`;
    const modal = getModal('مكتبة الرسائل المحفوظة', body, 580);
    const render = () => {
      const box = modal.querySelector('#bbkSnippetList');
      if (!snippets.length) { box.innerHTML = '<div class="bbk-v7-muted">مفيش رسائل محفوظة حتى الآن.</div>'; return; }
      box.innerHTML = snippets.map((item) => `<div class="bbk-v7-saved-row"><div class="bbk-v7-row-main"><b>${esc(item.title || 'رسالة محفوظة')}</b><small>${esc(item.text)}</small></div><div class="bbk-v7-row-actions"><button type="button" class="btn btn-fire btn-xs" data-use="${esc(item.id)}">إدراج</button><button type="button" class="btn btn-ghost btn-xs" data-del="${esc(item.id)}">حذف</button></div></div>`).join('');
      box.querySelectorAll('[data-use]').forEach((b) => b.onclick = () => { const item = snippets.find(x => x.id === b.dataset.use); const input = $('chatComposerInput'); if (!item || !input) return; input.value = item.text; input.focus(); input.dispatchEvent(new Event('input', { bubbles: true })); modal.remove(); });
      box.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { snippets = snippets.filter(x => x.id !== b.dataset.del); saveJson(SNIPPETS_KEY, snippets); render(); });
    };
    modal.querySelector('#bbkSnippetAdd').onclick = () => { const title = modal.querySelector('#bbkSnippetTitle').value.trim(); const text = modal.querySelector('#bbkSnippetText').value.trim(); if (!text) { window.toast ? toast('اكتب نص الرسالة الأول.','e') : alert('اكتب نص الرسالة الأول.'); return; } snippets.unshift({ id:'snip-'+Date.now()+'-'+Math.random().toString(36).slice(2,6), title:title || 'رسالة محفوظة', text, createdAt:Date.now() }); saveJson(SNIPPETS_KEY, snippets); modal.querySelector('#bbkSnippetTitle').value=''; modal.querySelector('#bbkSnippetText').value=''; render(); track('مكتبة الرسائل','تم حفظ رسالة جديدة'); };
    render();
  }

  function currentChannelSlug() { const state = window.__bbkChatGetState ? window.__bbkChatGetState() : {}; return String(state.slug || '').trim().toLowerCase(); }
  function openScheduler() {
    const accounts = typeof window.kickReadOAuthAccounts === 'function' ? window.kickReadOAuthAccounts() : [];
    const accountOptions = accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.username || a.slug || a.id)}</option>`).join('');
    const body = `<div class="field"><label>القناة</label><input id="bbkSchedSlug" value="${esc(currentChannelSlug())}" placeholder="اسم قناة Kick"></div><div class="field"><label>حساب الإرسال</label><select id="bbkSchedAccount">${accountOptions || '<option value="">اتصل بحساب Kick أولًا</option>'}</select></div><div class="field"><label>الرسائل (كل رسالة في سطر)</label><textarea id="bbkSchedText" rows="4" placeholder="اكتب كل رسالة في سطر مستقل"></textarea></div><div class="field"><label>ترتيب الرسائل</label><select id="bbkSchedMode"><option value="ordered">بالترتيب</option><option value="random">عشوائي</option></select></div><div class="inputs-grid"><div class="field-mini"><label>الفاصل بالثواني</label><input id="bbkSchedInterval" type="number" min="10" max="86400" value="30"></div><div class="field-mini"><label>عدد الإرسالات (0 = بلا حد)</label><input id="bbkSchedCount" type="number" min="0" max="100000" value="0"></div></div><div class="field"><label>بدء من (اختياري)</label><input id="bbkSchedStart" type="datetime-local"></div><div class="field"><label>انتهاء عند (اختياري)</label><input id="bbkSchedEnd" type="datetime-local"></div><button type="button" class="btn btn-fire btn-full" id="bbkSchedCreate"><i class="fas fa-calendar-plus"></i> إنشاء الجدولة</button><div class="bbk-v7-divider"></div><div id="bbkSchedulesList"></div><p class="bbk-v7-muted">تستمر الجدولة أثناء بقاء التطبيق مفتوحًا في المتصفح؛ لا تعمل بعد إغلاق المتصفح.</p>`;
    const modal = getModal('جدولة رسائل الشات', body, 620);
    const render = () => {
      const box = modal.querySelector('#bbkSchedulesList');
      if (!schedules.length) { box.innerHTML = '<div class="bbk-v7-muted">لا توجد جداول محفوظة.</div>'; return; }
      box.innerHTML = schedules.map((s) => `<div class="bbk-v7-schedule-row"><div class="bbk-v7-row-main"><b>${esc(s.slug)} · ${esc(s.enabled ? 'مفعّلة' : 'متوقفة')}</b><small>${esc((Array.isArray(s.messages)?s.messages:[s.content]).length+' رسالة · '+(s.mode==='random'?'عشوائي':'بالترتيب'))}<br>${esc((Array.isArray(s.messages)?s.messages:[s.content]).join(' | '))}<br>الإرسال: ${Number(s.sentCount||0)} · التالي: ${esc(s.nextAt?formatDate(s.nextAt):'—')}${s.lastError?'<br>الخطأ: '+esc(s.lastError):''}</small></div><div class="bbk-v7-row-actions"><button type="button" class="btn btn-ghost btn-xs" data-toggle="${esc(s.id)}">${s.enabled?'إيقاف':'تشغيل'}</button><button type="button" class="btn btn-ghost btn-xs" data-delete="${esc(s.id)}">حذف</button></div></div>`).join('');
      box.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = () => { const s = schedules.find(x => x.id === b.dataset.toggle); if (s) { s.enabled=!s.enabled; if(s.enabled&&!s.nextAt)s.nextAt=Date.now(); saveJson(SCHEDULES_KEY,schedules); render(); } });
      box.querySelectorAll('[data-delete]').forEach((b) => b.onclick = () => { schedules=schedules.filter(x=>x.id!==b.dataset.delete);saveJson(SCHEDULES_KEY,schedules);render(); });
    };
    modal.querySelector('#bbkSchedCreate').onclick = () => {
      const slug = String(modal.querySelector('#bbkSchedSlug').value||'').trim().replace(/^@/,'').replace(/^https?:\/\/(www\.)?kick\.com\//i,'').replace(/[?#].*$/,'').replace(/\/$/,'').toLowerCase();
      const accountId = String(modal.querySelector('#bbkSchedAccount').value||'');
      const messages = String(modal.querySelector('#bbkSchedText').value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      const content = messages[0] || '';
      const mode = String(modal.querySelector('#bbkSchedMode').value||'ordered');
      const interval = Math.max(10,Math.min(86400,Number(modal.querySelector('#bbkSchedInterval').value)||30));
      const maxCount = Math.max(0,Math.min(100000,Number(modal.querySelector('#bbkSchedCount').value)||0));
      const startValue = modal.querySelector('#bbkSchedStart').value, endValue = modal.querySelector('#bbkSchedEnd').value;
      const startAt = startValue ? new Date(startValue).getTime() : Date.now();
      const endAt = endValue ? new Date(endValue).getTime() : 0;
      if (!/^[a-z0-9_-]{1,50}$/.test(slug) || !messages.length || messages.some(m=>m.length>500) || !accountId || !accounts.some(a=>String(a.id)===accountId)) { alert('أدخل قناة صحيحة ورسالة واحدة على الأقل، واختر حساب Kick متصلًا.'); return; }
      if (endAt && endAt <= startAt) { alert('وقت النهاية لازم يكون بعد وقت البداية.'); return; }
      schedules.unshift({id:'sch-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),slug,accountId,content,messages,mode,intervalSec:interval,maxCount,startAt,endAt,enabled:true,sentCount:0,nextIndex:0,nextAt:Math.max(Date.now(),startAt),lastError:'',createdAt:Date.now()});
      saveJson(SCHEDULES_KEY,schedules);track('الجدولة','تم إنشاء جدولة للقناة '+slug);render();modal.querySelector('#bbkSchedText').value='';
    };
    render();
  }
  async function scheduleTick() {
    if (!schedules.length || on('pauseChat')) return;
    const now = Date.now();
    for (const schedule of schedules.slice()) {
      if (!schedule.enabled || scheduleBusy.has(schedule.id) || now < Number(schedule.startAt||0) || now < Number(schedule.nextAt||0)) continue;
      if (schedule.endAt && now >= schedule.endAt) { schedule.enabled=false; saveJson(SCHEDULES_KEY,schedules); track('الجدولة','انتهى وقت الجدولة '+schedule.slug); continue; }
      if (schedule.maxCount > 0 && schedule.sentCount >= schedule.maxCount) { schedule.enabled=false; saveJson(SCHEDULES_KEY,schedules); continue; }
      scheduleBusy.add(schedule.id);
      try {
        if (typeof window.kickGetTokenForAccount !== 'function') throw new Error('سجّل الدخول بحساب Kick لاستخدام الجدولة.');
        const token = await window.kickGetTokenForAccount(schedule.accountId, false);
        let broadcasterId = schedule.broadcasterUserId;
        if (!broadcasterId) {
          const pr = await fetch('/api/kick/profile?slug='+encodeURIComponent(schedule.slug), { headers:{Accept:'application/json'}, cache:'no-store' });
          const pd = await pr.json().catch(()=>({}));
          if (!pr.ok) throw new Error('تعذر تحميل معلومات القناة.');
          const root = pd.data || pd;
          const ch = root.data || root.channel || root;
          broadcasterId = ch.broadcaster_user_id || ch.user_id || ch.user?.user_id || ch.user?.id || root.target_user_id;
          if (!broadcasterId) throw new Error('لم يتم العثور على معرّف صاحب القناة.');
          schedule.broadcasterUserId = Number(broadcasterId);
        }
        const messageList=Array.isArray(schedule.messages)&&schedule.messages.length?schedule.messages:[schedule.content];
        const chosen=schedule.mode==='random'?messageList[Math.floor(Math.random()*messageList.length)]:messageList[(Number(schedule.nextIndex||0)%messageList.length)];
        const response = await fetch('/api/kick/chat', {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({type:'user',broadcaster_user_id:Number(broadcasterId),content:chosen})});
        const answer = await response.json().catch(()=>({}));
        if (!response.ok || answer?.data?.is_sent === false) { const er=new Error(answer.message || 'تعذر إرسال الرسالة المجدولة.'); er.status=response.status; throw er; }
        schedule.sentCount = Number(schedule.sentCount||0)+1; if(schedule.mode!=='random')schedule.nextIndex=(Number(schedule.nextIndex||0)+1)%messageList.length; schedule.lastSentMessage=chosen; schedule.lastError=''; schedule.nextAt=Date.now()+Number(schedule.intervalSec||30)*1000;
        if (schedule.maxCount > 0 && schedule.sentCount >= schedule.maxCount) schedule.enabled=false;
        track('جدولة مرسلة', schedule.slug+' · '+String(chosen).slice(0,90));
      } catch (e) {
        schedule.lastError=String(e&&e.message||e); schedule.nextAt=Date.now()+Math.max(30000, Number(schedule.intervalSec||30)*1000);
        track('فشل جدولة',schedule.slug+' · '+schedule.lastError);
      } finally { scheduleBusy.delete(schedule.id); saveJson(SCHEDULES_KEY,schedules); }
    }
  }

  function enqueue(item) {
    const duplicate = queue.find(q => q.slug===item.slug && q.content===item.content && q.accountValue===item.accountValue && q.status==='pending');
    if (duplicate) { duplicate.lastError=item.message; duplicate.lastStatus=item.status; duplicate.updatedAt=Date.now(); }
    else queue.unshift({id:'q-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),createdAt:Date.now(),status:'pending',tries:0,...item});
    queue=queue.slice(0,250);saveJson(QUEUE_KEY,queue);track('قائمة انتظار','تم حفظ رسالة تحتاج لمحاولة أخرى.');updateToolbarState();
  }
  function offerQueueOnFailure(item) {
    const message=String(item.message||'');
    const likelyRetryable=item.status===429 || item.status>=500 || /network|fetch|timeout|اتصال|شبكة|انقطع/i.test(message);
    if (!likelyRetryable || !item.content || !item.slug) return;
    // Failures with ambiguous server outcomes are stored for manual review; only HTTP 429 is retried automatically.
    enqueue({...item,autoRetry:item.status===429,needsReview:item.status!==429,nextAt:Date.now()+(item.status===429?8000:0)});
  }
  function markQueueSendSuccess(content, slug, accountValue) {
    const before=queue.length;
    queue=queue.filter(q=>!(q.slug===slug&&q.content===content&&q.accountValue===accountValue));
    if(queue.length!==before){saveJson(QUEUE_KEY,queue);track('قائمة الانتظار','تم حذف الرسالة بعد نجاح الإرسال.');updateToolbarState();}
  }
  function openQueue() {
    const body = `<div class="bbk-v7-muted">الرسائل التي واجهت خطأ محفوظة هنا. الأخطاء غير المؤكدة لا تعاد تلقائيًا حتى لا تتكرر رسالة وصلت بالفعل.</div><div id="bbkQueueList"></div>`;
    const modal = getModal('قائمة انتظار الإرسال', body, 650);
    const render = () => {
      const box=modal.querySelector('#bbkQueueList');
      if(!queue.length){box.innerHTML='<div class="bbk-v7-muted">قائمة الانتظار فارغة.</div>';return;}
      box.innerHTML=queue.map(q=>`<div class="bbk-v7-queue-row"><div class="bbk-v7-row-main"><b>${esc(q.slug)} · ${esc(q.needsReview?'مراجعة مطلوبة':q.autoRetry?'محاولة آلية':'في الانتظار')}</b><small>${esc(q.content)}<br>${esc(q.message||q.lastError||'')}<br>${esc(formatDate(q.createdAt))}</small></div><div class="bbk-v7-row-actions"><button type="button" class="btn btn-fire btn-xs" data-retry="${esc(q.id)}">إعادة المحاولة</button><button type="button" class="btn btn-ghost btn-xs" data-remove="${esc(q.id)}">حذف</button></div></div>`).join('');
      box.querySelectorAll('[data-retry]').forEach(b=>b.onclick=async()=>{const q=queue.find(x=>x.id===b.dataset.retry);if(!q)return;modal.remove();await retryQueueItem(q.id);});
      box.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{queue=queue.filter(x=>x.id!==b.dataset.remove);saveJson(QUEUE_KEY,queue);render();updateToolbarState();});
    };
    render();
  }
  async function retryQueueItem(id, silent) {
    const q=queue.find(x=>x.id===id);if(!q)return false;
    q.tries=Number(q.tries||0)+1;q.status='retrying';q.lastError='';saveJson(QUEUE_KEY,queue);updateToolbarState();
    try {
      if(!navigator.onLine)throw new Error('الاتصال بالإنترنت غير متاح.');
      let result;
      const accountValue=String(q.accountValue||'');
      if(accountValue.indexOf('oauth:')===0 || accountValue==='oauth') {
        if(typeof window.kickGetTokenForAccount!=='function')throw new Error('سجّل الدخول بحساب Kick من جديد.');
        const idValue=accountValue.indexOf('oauth:')===0?accountValue.slice(6):(typeof window.kickActiveOAuthId==='function'?window.kickActiveOAuthId():'');
        const token=await window.kickGetTokenForAccount(idValue||undefined,false);
        const profileResponse=await fetch('/api/kick/profile?slug='+encodeURIComponent(q.slug),{headers:{Accept:'application/json'},cache:'no-store'});
        const profile=await profileResponse.json().catch(()=>({}));
        if(!profileResponse.ok)throw new Error(profile.message||'تعذر تحميل معلومات القناة.');
        const root=profile.data||profile, channel=root.data||root.channel||root;
        const broadcasterId=channel.broadcaster_user_id||channel.user_id||channel.user?.user_id||channel.user?.id||root.target_user_id;
        if(!broadcasterId)throw new Error('تعذر تحديد صاحب القناة.');
        const payload={type:'user',broadcaster_user_id:Number(broadcasterId),content:String(q.content||'')};
        if(q.reply&&q.reply.id)payload.reply_to_message_id=String(q.reply.id);
        const response=await fetch('/api/kick/chat',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});
        result=await response.json().catch(()=>({}));
        if(!response.ok||result?.data?.is_sent===false) { const er=new Error(result.message||'تعذر إعادة إرسال الرسالة.');er.status=response.status;throw er; }
      } else if(accountValue.indexOf('account:')===0) {
        if(q.reply)throw new Error('الرد المحفوظ يحتاج حسابًا متصلًا عبر Kick؛ اختَر حسابًا متصلًا ثم أعد محاولة الرد.');
        const accountId=Number(accountValue.slice(8));
        const legacy=Array.isArray(window.accounts)?window.accounts.find(a=>a&&Number(a.id)===accountId&&a.token):null;
        if(!legacy)throw new Error('حساب الإرسال لم يعد متاحًا. أضِف الحساب مرة أخرى.');
        let roomId='';
        const active=window.__bbkChatGetState?window.__bbkChatGetState():{};
        if(active.slug===q.slug&&active.chatroomId)roomId=String(active.chatroomId);
        if(!roomId){const roomResponse=await fetch('/api/kick/room?slug='+encodeURIComponent(q.slug),{headers:{Accept:'application/json'},cache:'no-store'});const room=await roomResponse.json().catch(()=>({}));if(!roomResponse.ok||!room.chatroom_id)throw new Error(room.message||'تعذر تحديد غرفة الشات.');roomId=String(room.chatroom_id);}
        if(typeof window.sendMessage!=='function')throw new Error('الإرسال غير متاح الآن.');
        await window.sendMessage(roomId,String(q.content||''),legacy.token,legacy.workingSendProxy);
      } else throw new Error('اختَر حساب الإرسال الصحيح ثم أعد المحاولة.');
      queue=queue.filter(x=>x.id!==id);saveJson(QUEUE_KEY,queue);track('إعادة إرسال ناجحة',q.slug+' · '+String(q.content||'').slice(0,90));updateToolbarState();
      if(!silent&&typeof window.toast==='function')window.toast('تمت إعادة إرسال الرسالة.','s');
      return true;
    } catch(e) {
      q.status='pending';q.lastError=String(e&&e.message||e);q.lastStatus=Number(e&&e.status||0);q.updatedAt=Date.now();q.autoRetry=Number(e&&e.status||0)===429&&q.tries<3;q.needsReview=!q.autoRetry;q.nextAt=q.autoRetry?Date.now()+8000:0;saveJson(QUEUE_KEY,queue);track('فشل إعادة الإرسال',q.slug+' · '+q.lastError);updateToolbarState();
      if(!silent&&typeof window.toast==='function')window.toast('لم تُرسل الرسالة: '+q.lastError,'e');
      return false;
    }
  }

  function openEventLog() {
    const body=`<div class="bbk-v7-button-row"><button class="btn btn-ghost btn-xs" type="button" id="bbkEventClear">مسح السجل</button><button class="btn btn-ghost btn-xs" type="button" id="bbkEventExport">تصدير CSV</button></div><div id="bbkEventRows"></div>`;
    const modal=getModal('سجل الأحداث والإحصائيات',body,700);
    const render=()=>{const box=modal.querySelector('#bbkEventRows');const sorted=events.slice().reverse();box.innerHTML=sorted.slice(0,250).map(e=>`<div class="bbk-v7-log-row"><div class="bbk-v7-row-main"><b>${esc(e.kind)}</b><small>${esc(e.detail)}</small></div><small>${esc(formatDate(e.at))}</small></div>`).join('')||'<div class="bbk-v7-muted">لا توجد أحداث مسجلة بعد.</div>';};
    modal.querySelector('#bbkEventClear').onclick=()=>{events=[];persistEvents();render();};
    modal.querySelector('#bbkEventExport').onclick=()=>{const rows=[['time','event','detail'],...events.map(e=>[new Date(e.at).toISOString(),e.kind,e.detail])];const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');downloadFile('BadBoy-Kick-events.csv',csv,'text/csv;charset=utf-8;');};
    render();
  }
  function downloadFile(name, text, type) {
    const blob=new Blob([text],{type:type||'application/octet-stream'}),url=URL.createObjectURL(blob),a=D.createElement('a');a.href=url;a.download=name;D.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2500);
  }
  function deriveBackupKey(password, salt) {
    return crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']).then(base=>crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:200000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']));
  }
  function bytesToBase64(bytes) { let out='';for(const b of bytes)out+=String.fromCharCode(b);return btoa(out); }
  function base64ToBytes(value) { const raw=atob(value);return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
  async function readArchiveForBackup() {
    return new Promise((resolve) => {
      if(!window.indexedDB){resolve([]);return;}
      const request=indexedDB.open('BadBoyKickChatArchive_v2',1);
      request.onerror=()=>resolve([]);
      request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('messages')){db.close();resolve([]);return;}try{const tx=db.transaction('messages','readonly'),req=tx.objectStore('messages').getAll();req.onsuccess=()=>{resolve(req.result||[]);db.close();};req.onerror=()=>{resolve([]);db.close();};}catch(_){db.close();resolve([]);}};
    });
  }
  async function writeArchiveFromBackup(rows) {
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB||!Array.isArray(rows)||!rows.length){resolve();return;}
      const request=indexedDB.open('BadBoyKickChatArchive_v2',1);
      request.onerror=()=>reject(request.error||new Error('تعذر فتح أرشيف الشات.'));
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('messages')){const st=db.createObjectStore('messages',{keyPath:'key'});st.createIndex('byChannelTimestamp',['channelSlug','timestamp'],{unique:false});}};
      request.onsuccess=()=>{const db=request.result;try{const tx=db.transaction('messages','readwrite'),st=tx.objectStore('messages');rows.forEach(row=>{if(row&&row.key)st.put(row);});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error||new Error('تعذر استعادة سجل الشات.'));};}catch(e){db.close();reject(e);}};
    });
  }
  async function exportEncryptedBackup() {
    const password=prompt('اكتب كلمة مرور للنسخة الاحتياطية (8 أحرف على الأقل). لا يتم تضمين توكنات الحسابات في الملف.');
    if(password===null)return;if(String(password).length<8){alert('كلمة المرور لازم تكون 8 أحرف على الأقل.');return;}
    if(!crypto||!crypto.subtle){alert('التشفير غير مدعوم في هذا المتصفح.');return;}
    const archive=await readArchiveForBackup();
    const payload={format:BACKUP_FORMAT,version:1,createdAt:new Date().toISOString(),settings:dataSaver,snippets,schedules,queue:queue.map(q=>({...q,accountValue:String(q.accountValue||'')})),events,localStorage:{badboykick_chat_channels_v1:localStorage.getItem('badboykick_chat_channels_v1'),badboykick_chat_metadata_v1:localStorage.getItem('badboykick_chat_metadata_v1')},chatArchive:archive};
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveBackupKey(String(password),salt);
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(payload)));
    const out={format:BACKUP_FORMAT,version:1,createdAt:payload.createdAt,salt:bytesToBase64(salt),iv:bytesToBase64(iv),data:bytesToBase64(new Uint8Array(cipher))};
    downloadFile('BadBoy-Kick-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(out,null,2),'application/json');track('نسخ احتياطي','تم إنشاء نسخة احتياطية مشفرة لا تتضمن رموز الدخول.');
  }
  async function restoreEncryptedBackup(file) {
    const password=prompt('أدخل كلمة مرور النسخة الاحتياطية.');if(password===null)return;
    try {
      const wrapper=JSON.parse(await file.text());if(wrapper.format!==BACKUP_FORMAT)throw new Error('صيغة النسخة غير معروفة.');
      const key=await deriveBackupKey(String(password),base64ToBytes(wrapper.salt));
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(wrapper.iv)},key,base64ToBytes(wrapper.data));
      const data=JSON.parse(new TextDecoder().decode(plain));
      if(data.settings){dataSaver=Object.assign({},defaults,data.settings);window.BBKDataSaver.settings=dataSaver;saveDataSaver();}
      if(Array.isArray(data.snippets)){snippets=data.snippets;saveJson(SNIPPETS_KEY,snippets);}
      if(Array.isArray(data.schedules)){schedules=data.schedules;saveJson(SCHEDULES_KEY,schedules);}
      if(Array.isArray(data.queue)){queue=data.queue;saveJson(QUEUE_KEY,queue);}
      if(Array.isArray(data.events)){events=data.events;persistEvents();}
      Object.keys(data.localStorage||{}).forEach(k=>{if(data.localStorage[k]!=null)localStorage.setItem(k,data.localStorage[k]);});
      if(Array.isArray(data.chatArchive))await writeArchiveFromBackup(data.chatArchive);
      applyDataSaver('all',false);renderDataSaverPage();updateToolbarState();track('استعادة نسخة','تمت استعادة بيانات التطبيق.');alert('تمت استعادة النسخة الاحتياطية. حدّث الصفحة لعرض كل التغييرات.');
    } catch(e) { alert('تعذر فتح النسخة الاحتياطية. تأكد من كلمة المرور وسلامة الملف.'); }
  }
  function openBackupModal() {
    const body=`<p class="bbk-v7-muted">النسخة الاحتياطية مشفرة بكلمة مرور تختارها. لا يتم تصدير توكنات الدخول أو أسرار المصادقة.</p><div class="bbk-v7-button-row"><button type="button" class="btn btn-fire" id="bbkBackupExport"><i class="fas fa-download"></i> إنشاء نسخة مشفرة</button><label class="btn btn-ghost" for="bbkBackupFile"><i class="fas fa-upload"></i> استعادة نسخة</label><input id="bbkBackupFile" type="file" accept="application/json,.json" style="display:none"></div><div class="bbk-v7-muted">تتضمن النسخة إعدادات توفير البيانات والرسائل المحفوظة والجداول وقائمة الانتظار وسجل الأحداث وأرشيف الرسائل المحلي المتاح.</div>`;
    const modal=getModal('النسخ الاحتياطي المشفّر',body,560);
    modal.querySelector('#bbkBackupExport').onclick=()=>exportEncryptedBackup().catch(e=>alert('تعذر إنشاء النسخة الاحتياطية: '+String(e&&e.message||e)));
    modal.querySelector('#bbkBackupFile').onchange=e=>{const file=e.target.files&&e.target.files[0];if(file)restoreEncryptedBackup(file);};
  }

  async function loadHlsScript() {
    if (window.Hls) return true;
    if (on('disableStream')) return false;
    if (hlsScriptPromise) return hlsScriptPromise;
    hlsScriptPromise = new Promise((resolve) => {
      const script = D.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js';
      script.async = true; script.onload = () => resolve(!!window.Hls); script.onerror = () => resolve(false);
      D.head.appendChild(script);
    });
    return hlsScriptPromise;
  }
  function setQualityOptions(levels) {
    const wrap=$('bbkQualityControl'),select=$('chatHlsQuality');if(!wrap||!select)return;
    if(!levels||!levels.length){wrap.style.display='none';return;}
    wrap.style.display='inline-flex';select.innerHTML='<option value="-1">تلقائي</option>';
    levels.forEach(level=>{const opt=D.createElement('option');opt.value=String(level.index);opt.textContent=String(level.label||('مستوى '+(level.index+1)));select.appendChild(opt);});
    select.value=on('lowQuality')?String(levels[0].index):'-1';
  }
  window.BBKHlsPlayer = {
    async play(url) {
      if (on('disableStream') || !url || !/^https?:\/\//i.test(url)) return false;
      const video=$('chatHlsVideo');if(!video)return false;
      this.stop();
      const hasHls=await loadHlsScript();
      if (on('disableStream')) return false;
      video.style.display='block';video.preload='none';
      if (hasHls && window.Hls.isSupported()) {
        try {
          const hls=new window.Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:60,capLevelToPlayerSize:true});hlsInstance=hls;
          hls.loadSource(url);hls.attachMedia(video);
          hls.on(window.Hls.Events.MANIFEST_PARSED,(_ev,data)=>{
            const levels=(data.levels||[]).map((l,i)=>({index:i,height:Number(l.height||0),bitrate:Number(l.bitrate||0),label:(l.height?l.height+'p':'جودة '+(i+1))})).sort((a,b)=>(a.height-b.height)||(a.bitrate-b.bitrate));
            setQualityOptions(levels);
            const select=$('chatHlsQuality');if(select){select.onchange=()=>{const value=Number(select.value);hls.currentLevel=value<0?-1:value;};}
            if(levels.length){if(on('lowQuality'))hls.currentLevel=levels[0].index;else hls.currentLevel=-1;}
            if(!on('disableStream'))video.play().catch(()=>{});
          });
          hls.on(window.Hls.Events.ERROR,(_ev,data)=>{if(data&&data.fatal){track('مشغل HLS','خطأ في تشغيل مصدر البث: '+String(data.type||'fatal'));if(window.__bbkHlsFallbackToEmbed&&window.__bbkChatGetState){const state=window.__bbkChatGetState();window.__bbkHlsFallbackToEmbed(state.slug);}}});
          clearInterval(qualityTimer);qualityTimer=setInterval(()=>smartQualityTick(levelsSafe(hls)),5000);
          return true;
        } catch(e) { this.stop(); return false; }
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src=url;video.style.display='block';video.play().catch(()=>{});setQualityOptions([]);return true;
      }
      video.style.display='none';return false;
    },
    stop() {
      clearInterval(qualityTimer);qualityTimer=null;
      if(hlsInstance){try{hlsInstance.destroy();}catch(_){}hlsInstance=null;}
      const video=$('chatHlsVideo');if(video){try{video.pause();}catch(_){}video.removeAttribute('src');video.load();video.style.display='none';}
      setQualityOptions([]);
    }
  };
  function levelsSafe(hls){return hls&&Array.isArray(hls.levels)?hls.levels.map((level,index)=>({index,height:Number(level.height||0),bitrate:Number(level.bitrate||0)})).sort((a,b)=>(a.height-b.height)||(a.bitrate-b.bitrate)):[];}
  let lastQualityChange=0;
  function smartQualityTick(levels) {
    if(!on('smartQuality')||on('lowQuality')||!hlsInstance||!levels||levels.length<2)return;
    const video=$('chatHlsVideo');if(!video||!video.buffered||!video.buffered.length)return;
    const now=Date.now();if(now-lastQualityChange<10000)return;
    let buffered=0;try{buffered=video.buffered.end(video.buffered.length-1)-video.currentTime;}catch(_){}
    const conn=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    const downlink=Number(conn&&conn.downlink||0);
    const currentRaw=Number(hlsInstance.currentLevel<0?hlsInstance.loadLevel:hlsInstance.currentLevel);
    let pos=levels.findIndex(x=>x.index===currentRaw);if(pos<0)pos=levels.length-1;
    if(buffered<2.5||video.readyState<3){if(pos>0){hlsInstance.currentLevel=levels[pos-1].index;lastQualityChange=now;track('جودة البث','خفض الجودة بسبب ضعف التحميل.');}}
    else if(buffered>14&&downlink>0&&pos<levels.length-1){const next=levels[pos+1];if(!next.bitrate||downlink*1000000>next.bitrate*1.35){hlsInstance.currentLevel=next.index;lastQualityChange=now;track('جودة البث','رفع الجودة بعد استقرار الاتصال.');}}
  }

  // Queue retry worker: automatic retry is limited to an explicit HTTP 429 response only.
  async function queueWorker() {
    if(on('pauseChat')||!navigator.onLine)return;
    const q=queue.find(item=>item.autoRetry&&item.status==='pending'&&Number(item.nextAt||0)<=Date.now());
    if(!q)return;
    q.status='retrying';saveJson(QUEUE_KEY,queue);
    await retryQueueItem(q.id, true);
    const current=queue.find(x=>x.id===q.id);
    if(current){current.status='pending';current.autoRetry=false;current.needsReview=true;current.nextAt=0;saveJson(QUEUE_KEY,queue);}
  }

  function installObserver() {
    if (!('MutationObserver' in window)) return;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') m.addedNodes.forEach((node) => { if (node.nodeType === 1) applyImagePolicies(node); });
      }
    });
    observer.observe(D.body, {childList:true,subtree:true});
  }

  // Window the DOM in normal use; the complete raw messages remain stored in IndexedDB.
  function virtualTrim() {
    const area=$('chatMessages');if(!area||virtualTrimBusy||browsingOlder||on('pauseChat'))return;
    if(area.scrollHeight-area.scrollTop-area.clientHeight>160)return;
    const nodes=Array.from(area.querySelectorAll('.chat-message')).sort((a,b)=>Number(a.dataset.chatTimestamp||0)-Number(b.dataset.chatTimestamp||0));
    if(nodes.length<=700)return;
    virtualTrimBusy=true;
    const removeCount=nodes.length-500;
    for(let i=0;i<removeCount;i++)nodes[i].remove();
    const remaining=Array.from(area.querySelectorAll('.chat-message'));
    const oldest=remaining.reduce((min,node)=>Math.min(min,Number(node.dataset.chatTimestamp||Infinity)),Infinity);
    if(Number.isFinite(oldest)&&window.__bbkMarkVirtualTrim)window.__bbkMarkVirtualTrim(oldest);
    virtualTrimBusy=false;
    track('تحسين الشات','تم تخفيف عدد عناصر الرسائل الظاهرة مع الاحتفاظ بالأرشيف المحلي.');
  }

  function injectToolbarActions() {
    const select=$('chatSendAccount');if(select&&!select.dataset.bbkTokenCopyBound){select.addEventListener('change',()=>{if(typeof window.kickShowCopyTokenButton==='function')window.kickShowCopyTokenButton();});select.dataset.bbkTokenCopyBound='1';}
    const playerToolbar=D.querySelector('.chat-player-toolbar');
    if(playerToolbar&&!$('bbkV7ManualPlay')){const btn=D.createElement('button');btn.type='button';btn.id='bbkV7ManualPlay';btn.className='btn btn-fire btn-xs';btn.innerHTML='<i class="fas fa-play"></i> تشغيل البث';btn.onclick=()=>{if(window.chatReloadPlayer)window.chatReloadPlayer();};playerToolbar.appendChild(btn);}
    const historyBtn=$('chatHistoryOlderBtn');if(historyBtn&&!historyBtn.dataset.bbkWrapped){historyBtn.dataset.bbkWrapped='1';}
  }

  function installToastTracker() {
    if(typeof window.toast!=='function'||window.toast.__bbkV7Wrapped)return;
    const old=window.toast;
    const wrapped=function(message,type){lastToast={message:String(message||''),type:String(type||'i'),at:Date.now()};if(type==='e'||/تم إرسال|تم نسخ|اتصال|انقطع|جدول|فشل/i.test(String(message||'')))track(type==='e'?'خطأ':'حالة',String(message||''));return old.apply(this,arguments);};
    wrapped.__bbkV7Wrapped=true;window.toast=wrapped;
  }

  function boot() {
    addStyle();ensureDataSaverPage();addTopButtons();ensureToolbar();injectToolbarActions();
    renderDataSaverPage();applyDataSaver('all',false);installObserver();installToastTracker();updateToolbarState();
    if(typeof window.kickShowCopyTokenButton==='function')window.kickShowCopyTokenButton();
    if($('chatMessages'))$('chatMessages').addEventListener('scroll',()=>{
      const area=$('chatMessages');if(!area)return;
      const nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<100;
      browsingOlder=!nearBottom&&area.scrollTop>30;
      if(nearBottom){browsingOlder=false;setTimeout(virtualTrim,0);}
    },{passive:true});
    D.addEventListener('click',(e)=>{if(e.target.closest('#chatReconnectBtn'))track('اتصال','طلب إعادة الاتصال يدويًا.');});
    const phaseObserver=new MutationObserver(()=>{if(!$('ph-datasaver'))ensureDataSaverPage();addTopButtons();ensureToolbar();injectToolbarActions();});
    const app=D.querySelector('.app-container');if(app)phaseObserver.observe(app,{childList:true,subtree:true});
    setInterval(scheduleTick,2500);setInterval(queueWorker,5000);setInterval(updateStats,4000);
    track('التطبيق','تم تحميل أدوات إدارة الشات وتوفير البيانات.');
  }

  window.BBKTools = {
    track,
    onMessageAdded(){updateEmoteToolbar();updateStats();if(!browsingOlder)setTimeout(virtualTrim,0);applyImagePolicies(D);},
    offerQueueOnFailure,
    markQueueSendSuccess,
    async exportBackup(){return exportEncryptedBackup();},
    openEventLog,
    openQueue,
    openSnippetLibrary,
    openScheduler
  };

  if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
