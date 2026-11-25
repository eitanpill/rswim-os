# The store listing (Aqua Swim)

Texts and answers for App Store Connect and Play Console (store launch, stage 9). Hebrew is the primary language;
English is the second. Screenshots are made from the fake demo data (`/mnt/project-files/store/listing/` in the
project files; regenerate with `apps/web/e2e`'s dev personas). Nothing here is a real customer.

## Identity

| Field | Value |
|---|---|
| App name (both stores) | Aqua Swim |
| Bundle id / package | `il.co.aquaswim.app` |
| Category | Apple: Business (secondary: Education). Google: Business |
| Price | Free (schools subscribe on the website; nothing is sold in the app) |
| Age rating | 4+ / Everyone: no user-generated public content, no ads, no purchases in the app |
| Privacy policy URL | `https://app.aqua-swim.co.il/privacy` (staging: `https://staging.aqua-swim.co.il/privacy`) |
| Support URL / email | `https://aqua-swim.co.il` · `support@aqua-swim.co.il` |
| Account deletion URL (Google) | `https://app.aqua-swim.co.il/me/account` (sign in, then delete) |

## Hebrew

**Subtitle (Apple, up to 30 characters):** בית הספר לשחייה, בכף היד

**Short description (Google, up to 80 characters):** לוח שיעורים, נוכחות, תשלומים והודעות: בית הספר לשחייה או מועדון הצלילה שלכם

**Promotional text (Apple, up to 170 characters):** כל מה שקורה בבית הספר לשחייה או במועדון הצלילה במקום אחד: השיעורים של הילדים, השלמות, תשלומים, טפסים והודעות מהמשרד, ישר לטלפון.

**Description (both, up to 4,000 characters):**

Aqua Swim היא האפליקציה של בית הספר לשחייה או של מועדון הצלילה שלכם. כל אחד נכנס עם מספר הטלפון ומגיע ישר למקום שלו: הורים, מדריכים, צוללים וצוות המשרד.

להורים
• השיעורים של כל ילד, הקבוצה, הבריכה והמדריך
• הודעה על היעדרות ותיאום שיעור השלמה בכמה הקלקות
• היתרה, הקבלות ותשלום מאובטח דרך הסולק של בית הספר
• טפסים וחתימה מהטלפון
• הודעות מבית הספר: ביטול שיעור, תזכורות, חגים

לצוללים
• הצלילות הקרובות, הרשמה לסשן וכרטיסייה
• טפסי בריאות, ויתור וביטוח עם חתימה בטלפון
• העלאת תעודות צלילה לאימות המועדון

למדריכים
• היום שלי: השיעורים, מי מגיע, ונוכחות גם בלי קליטה
• החלפות וזמינות

לבעלים ולמשרד
• לוח בקרה של העסק: מי חייב, מי לא הגיע, איפה יש מקום
• בקשות הצטרפות ושיעורי ניסיון ממשפחות חדשות
• עוזר חכם שעונה להורים ומעביר למשרד רק את מה שצריך

איך מצטרפים: בית הספר שולח לכם קישור או קוד QR, או שמחפשים אותו באפליקציה. אם המשרד כבר מכיר את מספר הטלפון שלכם, האפליקציה מוצאת אתכם לבד.

האפליקציה חינמית למשפחות ולצוללים. בעלי בתי ספר ומועדונים פותחים מנוי באתר aqua-swim.co.il.

**Keywords (Apple, up to 100 characters, comma-separated):** שחייה,בית ספר לשחייה,צלילה,חופשית,שיעורי שחייה,הורים,מדריך,נוכחות,חוג,בריכה

**What's new (first version):** הגרסה הראשונה של Aqua Swim בחנות.

## English

**Subtitle:** Your swim school, in your pocket

**Short description:** Lessons, attendance, payments and messages for your swim school or dive club

**Description:**

Aqua Swim is the app of your swim school or freediving club. Everyone signs in with their phone number and lands in
their own place: parents, instructors, divers and the office.

For parents: each child's lessons, group, pool and instructor; report an absence and book a makeup in a few taps; the
balance, receipts and secure payment through the school's own processor; forms signed on the phone; messages from the
school (cancellations, reminders, holidays).

For divers: upcoming dives, session booking and passes; health, waiver and insurance forms signed on the phone;
certification cards uploaded for the club to verify.

For instructors: my day, who is coming, and attendance that works without reception; substitutes and availability.

For owners and the office: the business at a glance (who owes, who missed, where there is room), join and trial
requests from new families, and a smart assistant that answers parents and passes the office only what needs it.

Joining: the school sends you a link or a QR code, or you find it in the app. If the office already has your number,
the app finds you by itself.

The app is free for families and divers. School and club owners subscribe on aqua-swim.co.il.

**Keywords:** swim school,swimming lessons,freediving,parents,instructor,attendance,pool,kids,club

## App Store review notes (fill the numbers and codes in App Store Connect only)

```
Sign-in is by phone number and a one-time code. The review accounts below use fixed test codes (no SMS is sent):
- School owner: +972 <owner test number>, code <code>  → the owner's dashboard of the review school
- Parent:       +972 <parent test number>, code <code> → a family with two children
The review school ("בית ספר לבדיקה") is filled with invented families and is hidden from the school search.
Nothing is sold in the app: families pay their school for lessons through the school's own payment processor (a
physical service, guideline 3.1.3(e)), and schools subscribe on our website only.
Account deletion: the name at the top of any screen → "החשבון שלי" → delete.
```

## Google Play: Data safety (draft, check against the privacy policy before submitting)

| Data | Collected | Why | Shared |
|---|---|---|---|
| Name, phone number, email | Yes | App functionality, account | With the person's school only |
| Children's names, ages, swim level | Yes (entered by the parent or school) | App functionality | With the school only |
| Payment info | No (the school's processor's page handles cards) | | |
| Photos and files (forms, certification cards) | Yes, when the person uploads them | App functionality | With the club only |
| Messages with the school | Yes | App functionality | With the school only |
| Device push token | Yes | Notifications | No |
| Crash logs | Yes (Sentry) | App stability | No |

Encrypted in transit: yes. Deletion: in the app (`/me/account`) and on the web. Target audience: adults (parents and
staff); the app is not designed for children (Families policy: not opted in).

## Screenshots

| Store | Size | Count |
|---|---|---|
| App Store, iPhone 6.9" | 1320 × 2868 (portrait) | 3 to 10 |
| Google Play, phone | 1080 × 1920 or larger, 9:16 | 2 to 8 |
| Google Play, feature graphic | 1024 × 500 | 1 |

The set (same order in both stores): the parent's home, the parent's payments, report an absence and book a makeup,
the instructor's day, the owner's dashboard, a freediving diver's dives, signing a form.
