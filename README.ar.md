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

## التثبيت المحلي

يتطلب Node.js 20 أو أحدث:

```bash
git clone https://github.com/EngMahmoudHafez/hafez-development-system.git
cd hafez-development-system
npm install
npm run validate
```

داخل Codex أو ChatGPT Work اطلب من المهارة المدمجة:

```text
Use $plugin-creator to add the existing plugin at /absolute/path/hafez-development-system
to my personal marketplace so I can test it locally.
```

بعد تحديث التطبيق ثبّت **Hafez Development System** من مصدر Personal واختبره في محادثة جديدة.
المشروع مجهز للنشر العام، لكنه لم يُنشر بعد في دليل الـplugins العام.

لإتاحة محرك الأوامر محليًا:

```bash
npm link
hafez doctor .
```

## ماذا يضيف للمشروع؟

- `.hafez/project.json` لعقد المعمارية وبوابات الجودة وسياسة الاستقلالية.
- `.hafez/state.json` للمرحلة الحالية والـslice والـblockers والخطوة الآمنة التالية.
- `.hafez/evidence/` لنتائج التحقق الفعلية.
- `docs/hafez/` للقرارات والخطط والـhandoffs.
- معمارية Laravel باسم `laravel-domain-slices-v1`.
- مهارات Nuxt/Vue لربط الواجهات بعقد OpenAPI مولّد.
- تفويض منضبط لمزودين مختلفين بدون تخزين الحسابات أو الأسرار.

## الاستمرار بدون أسئلة روتينية

المشاريع المتبناة تستخدم `continue-until-decision`: يستطيع الوكيل تنفيذ التعديلات الآمنة داخل النطاق،
وتشغيل الاختبارات، وإصلاح فشل سببه التعديل، وتحديث الأدلة من غير طلب تأكيد في كل خطوة.

يتوقف فقط عند قرار منتج أو معمارية يغيّر السلوك، أو صلاحيات وبيانات سرية، أو production، أو نشر ودفع
وتواصل خارجي، أو عملية مدمرة. لو توقفت الجلسة بسبب limit يمكن لجلسة جديدة استخدام `hafez resume`.

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
