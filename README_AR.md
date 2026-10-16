# BadBoy Kick — مشروع Vercel جاهز للرفع

الحزمة دي معمولة عشان تترفع على مستودع GitHub متوصل بـVercel من الموبايل. مش محتاج Python أو كمبيوتر أو تثبيت Node عندك.

## الملفات الموجودة

- `index.html`: واجهة التطبيق كاملة.
- `api/kick.js`: وظائف الخادم الرسمية للمصادقة، تحديث التوكن، التحقق من الحساب، وإرسال الرسائل/الردود عبر Kick Public API.
- `vercel.json`: توصيل مسارات `/api/kick/...` بملف الوظائف الواحد؛ ده يقلل عدد الملفات والمجلدات اللي محتاج ترفعها من الموبايل.
- `package.json`: إعداد JavaScript modules.
- `.env.example`: أسماء متغيرات البيئة فقط، من غير أسرار حقيقية.

## خطوات الرفع من الموبايل

1. نزّل ZIP وفك ضغطه بتطبيق الملفات على الموبايل.
2. افتح مستودع GitHub الحالي، واستبدل ملف `index.html` بالنسخة الموجودة في الحزمة.
3. ارفع `package.json` و`vercel.json` و`.env.example` إلى جذر المستودع.
4. داخل جذر المستودع أنشئ مجلدًا باسم `api`، ثم ارفع بداخله الملف `kick.js`.
5. اعمل Commit للتغييرات. Vercel هيعيد النشر لو المستودع متوصل بالمشروع.
6. في Vercel افتح: **Project → Settings → Environment Variables** وأضف المتغيرات الثلاثة التالية لكل من Production وPreview لو هتستخدم الاثنين:
   - `KICK_CLIENT_ID`: معرّف تطبيق Kick.
   - `KICK_CLIENT_SECRET`: السر الخاص بتطبيق Kick. **لا تضيفه في HTML أو GitHub.**
   - `KICK_REDIRECT_URI`: رابط موقع Vercel نفسه متبوعًا بشرطة مائلة، مثال توضيحي فقط: `https://YOUR-PROJECT.vercel.app/`.
7. افتح إعدادات تطبيق Kick Developer وسجّل **نفس** قيمة `KICK_REDIRECT_URI` حرفيًا كعنوان إعادة التوجيه. لازم تستخدم رابط مشروعك الحقيقي بدل `YOUR-PROJECT`.
8. بعد حفظ المتغيرات، اعمل **Redeploy** لآخر نسخة.
9. اختبر `https://YOUR-PROJECT.vercel.app/api/health`. لو ظهرت `ok: true` و`missingEnvironmentVariables: []` يبقى الخادم شايف الإعدادات المطلوبة.
10. افتح رابط Vercel الرئيسي، واضغط تسجيل الدخول الرسمي إلى Kick.

## ملاحظات مهمة

- افتح التطبيق من رابط Vercel وليس رابط GitHub Pages؛ Pages يعرض ملفات ثابتة ولا يشغّل وظائف الخادم المستخدمة في OAuth.
- لو غيّرت اسم نطاق Vercel بعد تسجيل عنوان إعادة التوجيه، لازم تحدث `KICK_REDIRECT_URI` في Vercel وإعدادات Kick معًا، ثم تعيد النشر.
- تبادل OAuth وإرسال الرسائل يمرّان من وظائف Vercel، والـClient Secret يظل على الخادم. توكن المستخدم الحالي يُخزّن في `sessionStorage` داخل جلسة المتصفح.
- قراءة الشات المباشر في الواجهة تعتمد على اتصال WebSocket غير موثّق رسميًا من Kick، لذلك لا تعتبر هذه الحزمة ضمانًا لعرض كل الرسائل القديمة. واجهة Kick الرسمية تدعم إرسال الرسائل، والردود عبر `reply_to_message_id` عندما تقبلها الخدمة وتكون الصلاحيات صحيحة.
- ميزة القفل البسيطة في وضع الرسائل لا تُعدّ حماية أمنية حقيقية؛ التطبيق عميل واجهة، ويمكن تعديل كوده من المتصفح. لا تستخدمها لحماية أسرار فعلية.

## مصادر رسمية

- Kick OAuth: https://github.com/KickEngineering/KickDevDocs/blob/main/getting-started/generating-tokens-oauth2-flow.md
- Kick Chat API: https://github.com/KickEngineering/KickDevDocs/blob/main/apis/chat.md
- Vercel Functions: https://vercel.com/docs/functions
- Vercel rewrites: https://vercel.com/docs/routing/rewrites
