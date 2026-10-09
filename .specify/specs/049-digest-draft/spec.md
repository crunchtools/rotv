# Spec 049: Editor's draft of the weekly digest

## Why
Nobody could ask the app what Friday's digest would send. The editor read the Thursday preview email, and to see what would backfill after a cut, the digest query was rebuilt by hand. For the Oct 9, 2026 issue that copy used `NOW()` for its 7-day window and listed three stories that had already run on Oct 2 (#734). The preview email had the same flaw in smaller form: it was built as of "now plus N days", so a preview generated Thursday at 23:17 used a window ending Friday at 23:17, not at the 08:00 send. And the only way to hold a published item out of the digest was to relabel news as `pipeline='historical'` by SQL; events had no option short of rejection.

## User stories
- As the editor, I ask for the draft and see the news and events the next send will contain, in send order, with ids, plus the runners-up that take a slot if I cut something.
- As the editor, I hold an item out of the digest (a closure that ends before Friday, a walk that already happened) and it stays published on its POI page.
- As the editor, the draft I read Thursday night matches what sends Friday morning, apart from items collected or approved in between.

## Behavior
- The draft is built by `fetchDigestContent`, the call the email renders from: same queries, same host filter, same dedup, same caps (5 news, 15 events).
- `news_bench` holds up to 5 news items past the cap; `events_overflow` holds events past the cap.
- Previews and the draft are built as of the send instant: the coming Friday (today, on a Friday) at 08:00 in the digest timezone. The live send still uses the moment it runs.
- `digest_excluded` on `poi_news` and `poi_events` defaults to false. A flagged item is left out of the broadcast digest, the personalized digests and the draft. Nothing else reads the flag; moderation status and the news lane are untouched.
- Excluding an item is reversible.

## MCP tools
| Tool | Arguments | Returns |
|---|---|---|
| `digest_draft` | `as_of` (ISO 8601, optional) | `{ sends_at, timezone, greeting, news, news_bench, events, events_overflow }` |
| `digest_exclude` | `content_type` (`news` \| `event`), `id`, `excluded` (default true) | confirmation with the item's title, or an error when the id does not exist |

News items carry `id, title, summary, source_url, source_host, poi_id, poi_name, publication_date, collection_date`. Events carry `id, title, description, start_date, end_date, location, poi_id, poi_name, source_url`, where `location` is the line the email prints.

## Out of scope
- An admin UI for the draft or the flag. The consumer is the `/rotv-editor newsletter` skill.
- Cross-POI dedup of one story filed under two POIs, and of one event listed by two organizers.
- A record of which items each past issue contained.
