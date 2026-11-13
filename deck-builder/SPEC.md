# CoreBuild deck spec

You build a deck by sending one JSON object. You choose slide **types** and write the **content**.
The service handles all design: brand colours, fonts, right-to-left Arabic, layout, page numbers.

```json
{
  "title": "العرض الفني — مشروع ...",
  "footer": "مشروع إنشاء عمارة سكنية — حي مشرفة، جدة",
  "tagline": "COREBUILD  |  TECHNICAL PROPOSAL",
  "file_name": "CoreBuild_Technical_Proposal",
  "sections": [
    { "title": "المقدمة", "slides": [ { "type": "cover", ... }, { "type": "agenda", ... } ] },
    { "title": "01 المؤسسة والخبرات", "slides": [ { "type": "divider", ... }, { "type": "cards", ... } ] }
  ]
}
```

## Writing rules

1. Arabic, formal, short. A slide title fits on **one line** (about 45 characters max). No full stop at the end of a title.
2. Every content slide has a `kicker`: the section label, e.g. `"01 / المؤسسة والخبرات"`.
3. Card `items` use the pattern `"Label: text"`. The label is bold. Keep 2–5 items per card, each under ~110 characters.
4. Never invent numbers, names, clients or dates. Use only what the user gave you. If something is missing, ask or leave it out.
5. Vary slide types. Do not put two `cards` slides in a row more than twice; use `hero`, `tiles`, `stats`, `process` or `table` in between.
6. After building, read `warnings`. Each warning names a slide and the text that does not fit. Shorten that text and build again. Repeat until there are no warnings (at most 3 rounds).
7. Icons are Font Awesome 6 names (`FaBuilding`, `FaHelmetSafety`, …). A list of good ones is at the end.

## Slide types

### `cover` (dark title slide)
```json
{ "type": "cover", "kicker": "TECHNICAL PROPOSAL", "title": "العرض الفني",
  "subtitle": "مشروع إنشاء عمارة سكنية\nبحي مشرفة — جدة", "meta": "القطعة رقم 26/أ بمخطط 127/3/ع",
  "submitted_to": "لجنة فحص العروض — وقف الإخلاص" }
```

### `agenda` (2–6 tiles)
```json
{ "type": "agenda", "title": "محتويات العرض", "kicker": "ستة أقسام من التعريف بالمؤسسة حتى التسليم",
  "items": [ { "title": "المؤسسة والخبرات", "subtitle": "البيانات والهوية والمشروعات السابقة", "icon": "FaBuilding" } ] }
```

### `divider` (dark section opener)
```json
{ "type": "divider", "number": "01", "title": "المؤسسة والخبرات", "subtitle": "هوية المؤسسة، سابقة الأعمال والهيكل الإداري" }
```

### `cards` (1–3 cards side by side — the workhorse)
```json
{ "type": "cards", "kicker": "01 / المؤسسة والخبرات", "title": "خبرات معالجة وتحلية المياه",
  "cards": [
    { "icon": "FaDroplet", "heading": "محطة تحلية الشعيبة — المرحلة الرابعة",
      "items": ["العزل: صيانة ورفع كفاءة العزل المائي والحراري.", "البيئة: مواد مقاومة للرطوبة والأملاح."],
      "tag": "العميل: الهيئة السعودية للمياه" } ] }
```
`tag` is optional (a highlighted line at the bottom: client, contractor, partner). The first card is on the right.

### `hero` (dark panel with a big number or statement + 1–2 cards or 2–4 tiles)
```json
{ "type": "hero", "kicker": "...", "title": "مشروع الشعيبة — أعمال رصف الطرق",
  "panel": { "icon": "FaRoad", "label": "مساحة الأسفلت والرصف", "value": "39,750", "unit": "مترًا مربعًا", "text": "شبكة الطرق والمداخل" },
  "cards": [ { "icon": "FaLayerGroup", "heading": "نطاق التنفيذ", "items": ["..."], "tag": "المقاول الرئيسي: ..." } ] }
```
`value` can also be a short phrase (e.g. `"Zero Harm"` or `"بناء واستثمار المستقبل العقاري"`). Use `"tiles": [...]` instead of `"cards"` for 2–4 small tiles. `"panel_side": "right"` puts the panel on the right.

### `tiles` (2–8 small boxes: icon + heading + one sentence)
```json
{ "type": "tiles", "kicker": "...", "title": "مكونات المشروع ونطاق التخصصات", "numbered": true,
  "subtitle": "optional line under the title",
  "tiles": [ { "icon": "FaCubes", "heading": "الأعمال الإنشائية", "text": "القواعد والخرسانات والهياكل" } ] }
```
For 4 tiles add `"columns": 4` to put them in one row (default is 2×2).

### `stats` (2–4 big numbers + optional fact strip)
```json
{ "type": "stats", "kicker": "...", "title": "ملخص المشروع",
  "stats": [ { "value": "1,255", "unit": "م²", "label": "مساحة الأرض", "icon": "FaRulerCombined" } ],
  "facts": [ { "label": "الموقع", "value": "حي مشرفة — جدة" } ] }
```

### `process` (2–5 numbered steps with arrows + optional dark band of 2–4 items)
```json
{ "type": "process", "kicker": "...", "title": "عدم المطابقة والتدقيق والتسليم", "subtitle": "CAR & NCR — دورة المعالجة",
  "steps": [ { "icon": "FaTriangleExclamation", "heading": "الرصد", "text": "تقرير فوري لأي مخالفة." } ],
  "band": { "heading": "التدقيق وملفات التسليم", "items": [ { "heading": "As-Built", "text": "تسليم المخططات النهائية." } ] } }
```

### `table` (up to ~9 rows; split longer tables across slides)
```json
{ "type": "table", "kicker": "...", "title": "المعدات والآليات المستخدمة",
  "columns": ["المعدات", "العدد", "الحالة", "الاستخدام"], "column_widths": [4, 1, 1.3, 4],
  "rows": [ ["حفارات ثقيلة", "06", "ممتازة", "الحفر والتجهيز الترابي"] ], "note": "optional footnote" }
```
Columns are in reading order: the first column is the rightmost.

### `timeline` (Gantt chart, months right-to-left, up to 12 activities)
```json
{ "type": "timeline", "kicker": "...", "title": "الجدول الزمني التقديري — ستة عشر شهرًا", "months": 16,
  "categories": { "civil": "الخرسانات / المعماري", "mep": "الميكانيكا والكهرباء", "fin": "التشطيبات", "hand": "الاستلام" },
  "activities": [ { "name": "القواعد والأساسات", "start": 2, "end": 4, "category": "civil" } ],
  "note": "الأنشطة متداخلة لتقليل مدة التنفيذ." }
```

### `org` (org chart: root, up to 3 below it, up to 3 below the middle one)
```json
{ "type": "org", "kicker": "...", "title": "الهيكل الإداري",
  "root": { "dept": "الإدارة العليا", "name": "م. ...", "role": "مالك المؤسسة" },
  "level2": [ { "dept": "...", "name": "...", "role": "..." } ], "level3": [ ... ] }
```

### `closing` (dark thank-you slide)
```json
{ "type": "closing", "title": "شكرًا لكم", "text": "نتطلع إلى شراكة ناجحة ...",
  "contacts": { "phone": "05...", "email": "...", "address": "...", "website": "..." } }
```

Any slide may have `"notes": "..."` for speaker notes (internal remarks go here, never on the slide).

## Good icons
Company & people: FaBuilding FaCity FaHouse FaUserTie FaPeopleGroup FaHandshake FaIdCard FaAward
Contact: FaPhone FaEnvelope FaLocationDot FaGlobe
Construction: FaHelmetSafety FaTrowelBricks FaCubes FaLayerGroup FaPersonDigging FaRulerCombined FaRoad FaTruck FaTruckMoving FaHammer FaWrench FaGears
Finishes & MEP: FaPaintRoller FaDoorOpen FaBorderAll FaFaucetDrip FaShower FaDroplet FaWater FaBolt FaPlug FaSnowflake FaElevator FaVideo FaWifi FaHeadset FaTowerBroadcast
Quality & safety: FaClipboardCheck FaListCheck FaMagnifyingGlass FaFlask FaShieldHalved FaUserShield FaTriangleExclamation FaFireExtinguisher FaFireFlameCurved FaKitMedical FaPersonFallingBurst FaCircleCheck
Planning & money: FaCalendarDays FaChartPie FaChartLine FaFileContract FaFileInvoiceDollar FaCoins FaReceipt FaBookOpen FaMapLocationDot FaWarehouse FaTree FaQuoteRight
