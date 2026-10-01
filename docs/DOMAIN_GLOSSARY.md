# Domain Glossary — עברית ↔ English

Use the **code name** in code, DB and APIs. Use the **Hebrew** term in UI and messages.

## Business & people
| Hebrew | English | Code name | Notes |
|---|---|---|---|
| בית ספר לשחייה | swim school | `organization` | A tenant. R-SWIM is tenant #1 |
| בעלת העסק | owner | role `owner` | Reut |
| מנהל/ת, שותף/ה | admin / co-owner | role `admin` | Asaf, Sharon; permissions are granular |
| מדריך/ה, מאמן/ת | instructor | `staff_member`, role `instructor` | |
| מלווה / נהג | escort / driver | role `escort` | After-school transport |
| רואה חשבון | accountant | role `accountant` | Read-only portal |
| משפחה / משק בית | household | `household` | The billing unit |
| הורה / אפוטרופוס | guardian | `guardian` | Has phone, WhatsApp opt-in, `ghl_contact_id` |
| תלמיד/ה, ילד/ה | student | `student` | |
| מתאמן/ת בוגר/ת | adult student | `student` with `is_self_guardian` | Own guardian |
| אחים | siblings | `student_relation(type=sibling)` | Drives sibling discount |
| הסדרי ראייה / משמורת | custody pattern | `students.custody_pattern` | E.g. alternating weekdays |
| מוסד | institution | `institution` | Children's home, school, municipality, NGO, ministry |
| ועד הורים | parent committee | `institution(type=parent_committee)` | |
| מועמד/ת | applicant | `applicant` | Recruitment |

## Venues
| Hebrew | English | Code name | Notes |
|---|---|---|---|
| סניף / מיקום | branch / venue | `venue` | Temporary by nature |
| קאנטרי | country club (venue type) | `venue.kind=country_club` | Har Homa, Ramat Rachel |
| בריכה | pool | `pool` | |
| מסלול | lane | `lane` | |
| חלון פעילות | operating window | `venue_operating_window` | Day × time × gender × lanes |
| הפרדה מגדרית | gender separation | `gender_restriction` | mixed / women / men / girls / boys |
| שעות נשים / שעות גברים | women's / men's hours | `gender_restriction=women|men` | |
| כרטיס מלווה | companion card | `venue_rules.companions_allowed` | 1 adult per child free |
| דמי כניסה לאח נוסף | extra sibling entry fee | `venue_rules.extra_child_fee_agorot` | ₪20 at Har Homa |
| סגירה | closure | `venue_closure` | Renovation, authority, water quality... |
| שיפוץ | renovation | `venue.status=renovation` | |
| מכרז | tender | `venue_contract.kind=tender` | Efrat |
| שכירות | rent | `venue_contract.rent_model` | |
| מצילה / מציל | lifeguard | certification `lifeguard` | |
| פיקוד העורף | Home Front Command | closure source `authority` | E.g. "max 10 in the pool" |

## Programs & products
| Hebrew | English | Code name | Notes |
|---|---|---|---|
| חוג / קבוצה | group class | `program=group_kids`, `class_template` | Weekly recurring |
| מנוי חודשי | monthly subscription | `enrollment` on a class template | |
| שיעור ניסיון | trial lesson | `trial` | Fee may offset first month |
| קיזוז שיעור ניסיון | trial offset | `trialOffset()` policy | |
| שיעור פרטי | private lesson | `program=private` | 30 min |
| זוגי / שלישייה | pair / trio | `program=pair|trio` | |
| שיעור וחצי | lesson and a half | duration 45 | |
| שיעור כפול | double lesson | `makeup_booking.kind=double` | Also a makeup option |
| שחיית תינוקות | baby swim | `program=baby` | Parent in water |
| שחיית מבוגרים | adult swim | `program=adult_beginner` | |
| שיפור סגנון | style improvement | `program=adult_style` | |
| שחייה טיפולית / רגשית | therapeutic / emotional swimming | `program=therapy` | |
| הידרותרפיה | hydrotherapy | `program=therapy` | Formal receipts |
| פחד ממים | water fear | `students.water_fear` | Surfaced to instructors |
| צהרון שחייה | after-school swim program | `program=after_school` | With transport |
| קורס אינטנסיבי | intensive course | `package(kind=course)` | 12 lessons, own regulations |
| קייטנה | camp | `package(kind=camp_week)` | Weekly |
| מנוי שנתי | annual subscription | `package(kind=annual)` | Early termination difference |
| כרטיסייה | punch card | `package(kind=punch_card)` | Credit-based |
| יתרה | balance | derived from ledger | Positive = debt, negative = credit |
| זיכוי | credit | `ledger_entries(entry_type=*_credit)` | |
| הנחת אחים | sibling discount | `discount_rule(kind=sibling)` | 10% or flat ₪30 |
| רמה | level | `level` | Ordered ladder |
| מתחילים / מתקדמים / בינוני | beginners / advanced / intermediate | `level.code` | |
| עלייה ברמה | level-up | `enrollment transfer (reason=level_up)` | |
| רשימת המתנה | waitlist | `waitlist_entry` | |
| כרטיס התקדמות | progress card | `progress_report` | Monthly to parents |
| שנת לימודים / מחזור / תקופה | term | `term` | |

## Attendance & makeups
| Hebrew | English | Code name | Notes |
|---|---|---|---|
| נוכחות | attendance | `attendance` | |
| היעדרות | absence | `attendance.status=absent_*` | |
| הודעת היעדרות | absence notice | `absence_notice` | Timestamped; classified by policy |
| לא הגיע ללא הודעה | no-show | `attendance.status=no_show` | |
| איחור | late | `attendance.status=late` | >10 min = absence |
| השלמה | makeup (credit) | `makeup_credit` | Earned right to a makeup |
| שיעור השלמה | makeup lesson / booking | `makeup_booking` | |
| הזדמנות אחרונה להשלמות | last call for makeups | `mass_cancellation_event.final_notice_at` | |
| ביטול מצד בית הספר | school-initiated cancellation | `session.status=cancelled_by_school` | Makeup given |
| ביטול חיצוני | external cancellation | `session.status=cancelled_external` | Best-effort makeup |
| אירוע ביטול המוני | mass cancellation event | `mass_cancellation_event` | War, renovation |
| מערך יומי / רשימה להיום | daily lineup | `lineup` (generated) | Sent to instructors |
| מחליף/ה | substitute | `session_staff.role=substitute` | |

## Money & admin
| Hebrew | English | Code name | Notes |
|---|---|---|---|
| הוראת קבע | standing order | `standing_order` | Via Grow |
| קישור תשלום | payment link | `payment_link` | |
| גביה חוזרת / תשלום שנכשל | dunning / failed payment | `dunning_case` | |
| ביט / פייבוקס | Bit / PayBox | `payment.method=bit|paybox` | Manual, with screenshot |
| מזומן | cash | `payment.method=cash` | Handover log |
| העברה בנקאית | bank transfer | `payment.method=bank_transfer` | |
| צ׳ק | cheque | `payment.method=cheque` | |
| חשבונית מס קבלה | tax invoice-receipt | `documents_fiscal.kind=invoice_receipt` | Via invoicing provider |
| קבלה | receipt | `documents_fiscal.kind=receipt` | |
| חשבונית זיכוי | credit note | `documents_fiscal.kind=credit_note` | |
| החזר / מצב החזר | reimbursement mode | `reimbursement_profile` | MoD, insurance, reservists, employer |
| משרד הביטחון | Ministry of Defense | `reimbursement_profile.kind=mod` | |
| מילואימניקים | IDF reservists' benefits | `reimbursement_profile.kind=reservists` | |
| קופת חולים | health fund | `reimbursement_profile.kind=health_fund` | |
| דף חשבון | statement of account | `household_statement` | PDF |
| חוב | debt | `debts` view | Aging buckets |
| מע״מ | VAT | `org_settings.vat_rate_bp` | |
| עוסק מורשה | VAT-registered business | `employment_type=freelancer_licensed` / org tax status | R-SWIM itself |
| עוסק פטור | VAT-exempt sole trader | `employment_type=freelancer_exempt` | Some instructors |
| הקפאה | freeze | `freeze` | Medical, long vacation; reason + attachment |
| ביטול מנוי | cancellation | `cancellation_request` | 25th cut-off |
| תקנון | regulations | `regulation_version` + `form_submission` | Versioned acceptance |
| הצהרת בריאות | health declaration | `form(kind=health_declaration)` | |
| ביטוח | insurance | `form(kind=insurance)` | |
| הסכמת צילום | photo consent | `consents(kind=photo)` | Opt-out in writing |

## Staff & payroll
| Hebrew | English | Code name | Notes |
|---|---|---|---|
| שכיר/ה | employee | `employment_type=employee` | Payslip |
| פרילנסר | freelancer | `employment_type=freelancer_*` | Transfer |
| היברידי | hybrid | `employment_type=hybrid` | Payslip for groups + transfer for privates |
| תלוש שכר | payslip | `staff_document(kind=payslip)` | From accountant |
| טופס 101 | Form 101 (employee tax card) | `staff_document(kind=form_101)` | Yearly |
| טופס 100 | Form 100 | `staff_document(kind=form_100)` | |
| פנסיה / קרן השתלמות / קופת גמל | pension / provident fund | `pension_eligibility` | After N continuous months, retro |
| ימי מחלה | sick days | `sick_leave_accrual` | |
| נסיעות / החזר נסיעות | travel allowance | `pay_rules.travel_*` | |
| דוח שעות | timesheet / hours report | `timesheet` | Auto from sessions |
| וינגייט | Wingate Institute | certification issuer | |
| משמרת | shift | `session_staff` | |
| החלפת משמרת | shift swap | `swap_request` | |

## Calendar
| Hebrew | English | Code name |
|---|---|---|
| שבת | Shabbat | `calendar.isShabbat` |
| ערב חג | holiday eve | `calendar.isErevChag` |
| חג | holiday (Yom Tov) | `calendar.isYomTov` |
| חול המועד | Chol HaMoed | `calendar.isCholHaMoed` |
| יום הזיכרון | Memorial Day | `calendar.isModernMemorial` |
| תשעה באב | Tisha B'Av | `calendar.isFastMajor` |
| יום כיפור | Yom Kippur | `calendar.isYomTov` (+ major fast) |
| חזרה לשגרה | back to routine | template `holiday_schedule` |
