# Spike: reading before bed and sleep (BOO-87)

**Question.** Is there a practical source of nightly sleep data, and do we know enough about
*when* someone reads to ask whether late reading goes with shorter sleep? Is it worth
building?

**Answer, short.** Not yet. The sleep side is solvable: a file upload of an Oura, Fitbit,
Garmin or Health Connect export is enough. The reading side is the problem. For Moon+
Reader, which is most of what this dashboard sees, we don't know when in the evening
someone stopped reading. The one cheap signal that could tell us (the times Moon+ syncs its
reading position over WebDAV) isn't kept yet. The recommendation is a small, separate first
step, **"last read tonight"**, and to revisit sleep once a few months of it have built up. It
would be done as an opt-in, admin-only card, never shown to visitors.

## 1. What time-of-day data we have

| Source | Clock times? | What we keep today |
| --- | --- | --- |
| Moon+ `statistics` table | No. Days only (`<day>|<ms>@<words>`) | Minutes and words per **day** |
| Moon+ highlights, notes, bookmarks | Yes, ms timestamps | `time` on each row of `highlights.json` (the 24-hour reading clock uses it) |
| Moon+ positions synced over WebDAV (`.po` files) | Yes. The `.po` holds a ms timestamp, and the write time is logged | Only the newest position per book. Each write is a line in `activity.jsonl`, which rolls over at 2 MB |
| Kobo `AnalyticsEvents` (`LeaveContent`) | Yes. When a book was closed, plus the seconds read | Rolled up into minutes per **day**. The device also deletes these events when it syncs |
| Kindle `ReadingSession` (Amazon data request) | Yes. Start time plus length, so real sessions | Rolled up into minutes per **day** |
| Plex, Audiobookshelf (media) | Yes, start and end | `media_sessions.json` keeps them (TV and audiobooks, not books) |

So for books:

- **Highlights are a poor proxy.** Most nights have no highlight, and a highlight at 22:10
  says nothing about whether reading went on until 01:00. Coverage depends on how much
  someone highlights: heavy highlighters might have one on 20–30% of reading days, and
  most readers far fewer.
- **WebDAV position syncs are the best Moon+ signal.** Moon+ uploads the position when a
  book is closed or the app is left (when sync is on). The time of the **last sync before
  about 05:00** is a decent "stopped reading at" for that night. It is cheap: we already
  receive these writes and log them. But it only works for people using WebDAV sync,
  activity.jsonl is pruned, and several phones or tablets could mix in.
- **Kindle and Kobo** have real session times, but the imports throw the clock time away.
  Keeping session ends from the Kindle export would be easy, but Kindle readers are a
  minority here. Kobo's data disappears on every sync, so its history is thin.

## 2. Where nightly sleep could come from

| Source | How we'd get it | Gives | Practical? |
| --- | --- | --- | --- |
| **Oura** | API v2 `/v2/usercollection/sleep` (bedtime start and end, durations), or the app's CSV/JSON export | Bedtime, wake time, duration, stages | API: personal access tokens are gone (end of 2025), so it now needs a registered OAuth2 app with single-use refresh tokens. That's heavy for a self-hosted dashboard. **The export is easy** |
| **Fitbit** | Google Takeout → `Fitbit/Global Export Data/sleep-YYYY-MM-DD.json` (`startTime`, `endTime`, `minutesAsleep`) | Sleep sessions | Upload of the Takeout files: easy. The Web API needs OAuth and is being folded into Google Health, so not worth it |
| **Garmin** | Account data export (`DI_CONNECT/DI-Connect-Wellness/*sleepData.json`) | Sleep start and end, stages | Upload: easy. The official API is partners-only |
| **Health Connect** (Android; Samsung Health, Fitbit, Oura and others write to it) | Settings → Health Connect → export: a zip (daily, weekly or monthly) to a cloud folder | `SleepSessionRecord` with start and end | One export covers many devices, which is attractive. **Unverified**: Google documents the zip only as something to import back into Health Connect. Community tools read the SQLite inside it, but the format isn't public and could change |
| **Apple Health** | `export.zip` → `export.xml` (`HKCategoryTypeIdentifierSleepAnalysis`) | Sleep intervals | Upload: well known, but large files (hundreds of MB). Few Moon+ users are on iPhone (Moon+ is Android-only) |
| **Home Assistant** | REST `GET /api/history/period/<start>?filter_entity_id=…` with a long-lived token | Whatever entity tracks sleep: the companion app's sleep sensors, a bed sensor, a "sleeping" input_boolean | Fits this dashboard best (self-hosted, a URL plus a token, like Tautulli). But the history is only as long as the recorder keeps (10 days by default) unless the user has long-term statistics. There's no standard "sleep" entity, so the user must pick one and say what "asleep" means |

The cheapest sleep source to build is **file upload of one export**, parsed like the
existing Goodreads, Kobo and Netflix imports. Oura's export and Fitbit's Takeout JSON are
the easiest formats. A Home Assistant pull is a nice second step for people who already
track sleep there.

## 3. Would the comparison mean anything?

With a nightly "stopped reading at" (from position syncs) and nightly sleep (from an
export), the card would be: *on nights you read past 23:30, you slept X min less / fell
asleep Y min later*. The caveats:

- **Confounding.** Late reading nights are weekends, holidays and nights you weren't tired.
  This is correlation, and the card would have to say so. Comparing weekdays only helps.
- **Sample size.** It needs months of nights with both signals. With WebDAV sync on every
  day, a few months is enough. With highlights only, it never is.
- **Direction.** Someone who can't sleep may read *because* they can't sleep. The data
  can't tell which came first.

It could be interesting, but it's thin compared with the other "in context" views.

## 4. Privacy

Sleep is **health data** (special category data under the UK and EU GDPR). If built:

- It must be **admin-only**: a new privacy flag that is off in every preset, as with life
  events (BOO-86). There should be no setting that shows raw sleep times to the public,
  and the friends share file should leave it out entirely.
- The uploaded export should be **reduced on arrival** to the nightly start, end and
  duration (no heart rate, HRV, stages or SpO₂), and the original file should be thrown away.
- Nothing should go to third parties: no lookups, and no analytics events naming it (the
  Mixpanel integration already sends only ids).
- Tokens (Home Assistant, Oura) should be stored like the Tautulli and *arr keys: on the
  server, never returned to the page.
- The "last read tonight" signal is also sensitive on its own, since it shows when you go
  to bed. It should get the same admin-only treatment, and it falls under the existing
  `exact_dates` and `diary` hiding at the very least.

## 5. Recommendation

**Don't build the sleep correlation now.** Instead:

1. **Small, worth doing:** keep a nightly "last read" time from Moon+ WebDAV position syncs.
   That means a small append-only `library/sessions.jsonl`, written by `dav.service.ts`
   next to the activity log entry, with time, book and device, and kept long-term. It also
   means keeping session times from the Kindle import. Together these give real
   time-of-day data for books: "what time do you stop reading", "late nights per month",
   and a better reading clock than highlights. Show it admin-only by default.
2. **Later, if (1) shows enough nights:** add a sleep upload for **Oura and Fitbit exports**
   first (the simplest formats), reduced to nightly start, end and duration. Add a Home
   Assistant history pull after that. Health Connect's export should wait until its format
   is documented.
3. **Skip** OAuth integrations (the Oura API and Fitbit Web API) for a single-user
   self-hosted dashboard. The setup cost is out of proportion.

Effort if done: (1) about a day. (2) a few days per export format, plus the privacy flag,
the card and tests.

*Not verified here:* the sandbox can't reach the vendors' sites or a real Home Assistant.
The export layouts above come from public documentation and community tools and should be
checked against real files before building. Sources: Oura API v2 notes on personal access
token deprecation and OAuth2 ([field notes](https://cdn.jsdelivr.net/npm/pi-oura-hr@1.2.0/OURA-API.md));
Health Connect backup and export ([Google support](https://support.google.com/android/answer/15323271?hl=EN-GB));
Home Assistant REST history API ([developers.home-assistant.io](https://developers.home-assistant.io/docs/api/rest/)).
