# نظام حافظ لتطوير البرمجيات

> نظام تشغيل للمشاريع البرمجية يعتمد على Skills ويعمل مع وكلاء الذكاء الاصطناعي.

[English](README.md) · [دليل التجربة الكاملة](docs/trial-runbook.md) · [المعمارية](docs/architecture.md) · [خطة التطوير](docs/roadmap.md)

يساعد Hafez الوكيل على فهم حالة المشروع الحقيقية، واستكمال العمل المتوقف، وتسليم Vertical Slices،
وتشغيل بوابات الجودة، وحفظ الأدلة والـhandoffs داخل المستودع بدل الاعتماد على ذاكرة المحادثة.

الاستخدام الأساسي باللغة الطبيعية؛ لا يحتاج المستخدم إلى حفظ أوامر الـCLI أو أسماء كل المهارات.

## ابدأ بطلب طبيعي

بعد تثبيت الـplugin افتح المشروع وقل:

```text
استخدم Hafez لفهم المشروع واستمر لحد أقرب مرحلة مكتملة ومتحقق منها.
توقف فقط لو محتاج مني قرار حقيقي.
```

أمثلة أخرى:

```text
كمّل الـfeature اللي وقفنا عندها.
ابنِ تسجيل الحساب بالكامل في الباك والفرونت.
راجع هل معمارية Laravel مطابقة للنظام المتفق عليه.
تحقق من الـslice الحالية وجهز handoff لموديل آخر.
```

مهارة `hafez` تفهم المقصود وتنتقل تلقائيًا بين inspect وadopt وresume وplan وverify
وhandoff، وتستدعي مهارة Laravel أو Nuxt/Vue عند الحاجة.

أسماء ومسارات المشاريع الموجودة في الشرح أمثلة فقط. Hafez لا يختار مشروعًا أو علاقة بين
repositories اعتمادًا على الاسم.

## دورة العمل

```text
طلب المستخدم
    ↓
فهم المشروع أو استئنافه
    ↓
اختيار المرحلة الحالية
    ↓
تخطيط Vertical Slice
    ↓
تنفيذ أو تفويض آمن
    ↓
تحقق بالأدلة
    ↓
Handoff قابل للاستئناف
```

## التثبيت

### تثبيت الـSkills فقط — الاختيار المناسب لمعظم المستخدمين

اعرض المهارات الموجودة قبل التثبيت:

```bash
npx skills add EngMahmoudHafez/hafez-development-system --list --full-depth
```

ثبّت الحزمة داخل المشروع الحالي أو على مستوى الجهاز:

```bash
npx skills add EngMahmoudHafez/hafez-development-system
npx skills add EngMahmoudHafez/hafez-development-system --global
```

يمكنك تثبيت المدخل الرئيسي فقط لأداة معينة:

```bash
npx skills add EngMahmoudHafez/hafez-development-system --skill hafez --agent codex
npx skills add EngMahmoudHafez/hafez-development-system --skill hafez-laravel --agent claude-code
```

للتحديث أو الإزالة:

```bash
npx skills update
npx skills update --global
npx skills remove hafez
```

### تثبيت المحرك الكامل

على مستوى الجهاز:

```bash
npm install --global github:EngMahmoudHafez/hafez-development-system
hafez doctor .
```

أو داخل مشروع واحد:

```bash
npm install --save-dev github:EngMahmoudHafez/hafez-development-system
npx hafez inspect . --json
```

نسخة Skills-only تعمل بدون executable؛ كل مهارة لديها fallback يستخدم أدوات الوكيل مباشرة. المحرك
الكامل يضيف أوامر ثابتة للحالة والأدلة والـhandoffs.

حزمة Skills-only تحتوي على Markdown ومراجع وبيانات YAML خفيفة فقط، بدون scripts تنفيذية داخل
المهارات أو credentials أو MCP. المحرك الكامل الاختياري يضيف CLI مبنيًا على Node.js بدون runtime
dependencies. راجع أي Skill قبل تفعيلها لأنها تعمل بصلاحيات الـagent المستضيف.

المشروع مجهز أيضًا كـPlugin كامل لـCodex وChatGPT Work. أوامر GitHub ستعمل بعد نشر المستودع على
الرابط المعلن. قبل النشر يمكن تجربة نفس الخطوات من النسخة المحلية باستخدام
`npx skills add /absolute/path` و`npm install --global /absolute/path`.

## ماذا يضيف للمشروع؟

- `.hafez/project.json` لعقد المعمارية وبوابات الجودة وسياسة الاستقلالية.
- `.hafez/state.json` للمرحلة الحالية والـslice والـblockers والخطوة الآمنة التالية.
- `.hafez/evidence/` لنتائج التحقق الفعلية.
- `docs/hafez/` للقرارات والخطط والـhandoffs.
- معمارية Laravel باسم `laravel-domain-slices-v1`.
- مهارات Nuxt/Vue لربط الواجهات بعقد OpenAPI مولّد.
- تفويض منضبط لمزودين مختلفين بدون تخزين الحسابات أو الأسرار.

## أول تشغيل

من داخل المشروع المقصود:

```bash
hafez init .             # معاينة بدون كتابة
hafez init . --apply     # إنشاء حالة Hafez فقط
hafez run .              # عرض الخطوة الآمنة التالية
hafez run . --execute    # تنفيذ gates وhandoff الحتمية فقط
```

في وضع الـPlugin أو Skills ينفذ الـhost agent مهام التخطيط والكود ثم يعيد الدورة إلى أن يظهر قرار
حقيقي. الـCLI المستقل لا يدّعي أنه موديل ذكاء اصطناعي؛ ينفذ العمليات الحتمية ويتوقف عند المهمة التي
تحتاج Agent.

## أكثر من Repository

يتم تعريف الأعضاء صراحة، وليس من أسماء المجلدات:

```bash
hafez workspace /path/to/product --init \
  --repository service=repositories/service \
  --repository client=repositories/client

# بعد المراجعة
hafez workspace /path/to/product --init \
  --repository service=repositories/service \
  --repository client=repositories/client --apply
```

يسجل `.hafez/workspace.json` منتج العقود والمستهلكين ومسارات artifacts. أي أسماء في المثال قابلة
للتغيير بالكامل.

## التحقق والترحيل

```bash
hafez validate .
hafez migrate .
hafez migrate . --apply
```

الترحيل Dry-run افتراضيًا، ولا يخترع معلومات ناقصة لإجبار الملف على اجتياز الـschema.

## الاستمرار بدون أسئلة روتينية

المشاريع المتبناة تستخدم `continue-until-decision`: يستطيع الوكيل تنفيذ التعديلات الآمنة داخل النطاق،
وتشغيل الاختبارات، وإصلاح فشل سببه التعديل، وتحديث الأدلة من غير طلب تأكيد في كل خطوة.

يتوقف فقط عند قرار منتج أو معمارية يغيّر السلوك، أو صلاحيات وبيانات سرية، أو production، أو نشر ودفع
وتواصل خارجي، أو عملية مدمرة. لو توقفت الجلسة بسبب limit يمكن لجلسة جديدة استخدام `hafez resume`.

التفويض الكتابي ينشئ worktree مستقلًا وwriter reservation واحدًا، ويسجل base revision والمسارات
والأوامر المسموحة، ثم يرفض اعتبار النتيجة جاهزة للدمج ما لم تطابق Git والأدلة. يظل الدمج النهائي
لمتكامل واحد. Kimi وAntigravity يعملان كـtask packets إلى أن تتوفر لهما طبقة عزل خارجية صلبة.

## معمارية Laravel

البروفايل يفرض Domain Modules وActions مستقلة وControllers رفيعة وPolicies صريحة وفصل config عن
settings والصلاحيات، مع Pint وLarastan وPest ومزامنة OpenAPI.

```bash
hafez architecture /path/to/laravel-project --json
```

الفحص الآلي يغطي الهيكل، ثم تطلب المهارة مراجعة سلوكية للكود لأن أسماء المجلدات وحدها لا تثبت صحة
المعمارية.

## Superpowers

التكامل مع [Superpowers](https://github.com/obra/superpowers) اختياري: Superpowers يدير منهجية التنفيذ
مثل brainstorming وTDD وdebugging، بينما Hafez يدير حالة المشروع والاستئناف والعقود والتفويض والتحقق.

ابدأ من [دليل التجربة الكاملة](docs/trial-runbook.md). المشروع تحت ترخيص [MIT](LICENSE).

الإصدار الحالي `0.2.0` Preview ويحتوي على 12 Skill، onboarding، schema validation، migrations،
bounded runner، worktree delegation، workspace متعدد المستودعات، واختبارات وإصدارات آلية.
