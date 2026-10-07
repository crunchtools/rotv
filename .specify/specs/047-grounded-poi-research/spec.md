# Spec 047: POI research from fetched pages

## Why
"Research with AI" in the POI editor drafted fields from the model's memory. Google Search grounding was removed everywhere in April (`ac98fb7`: crawl first, then extract), and news and events moved to Serper plus rendered pages, but research was left with nothing to read. Well-known places came back with confident detail nobody could check and URLs nobody had opened: Cascade Locks Park returned "a stairway of 18 locks" where the curated record says Locks 10 through 16 (#724).

## User stories
- As an admin, I click **Research with AI** and get a draft whose facts come from pages the app actually read: the POI's own reference page and the top web results for its name.
- As an admin, I can see which pages were cited, which were read, and which could not be read and why, so I can check a claim before accepting it.
- As an admin researching an obscure place, I get an empty draft that says nothing could be read, not an invented one.

## Behavior
- One Serper web search per run: `"{POI name}" {containing boundaries}`, no date filter. An unsaved POI has no boundaries and searches by name alone.
- Pages read: `more_info_link` first (the editor's unsaved value counts), then the top 4 search results. Skipped: non-public addresses, PDFs, blocklisted URLs (`blocklist_urls`), Facebook, Instagram, X/Twitter and Grokipedia.
- Each page contributes up to 8,000 characters of rendered text. Pages come from the render cache when it has them.
- Both LLM calls get the numbered pages and may state only what a page says; anything else is null. They cite pages by number, and the response carries the URLs of those pages, so a draft cannot contain a URL that was not fetched.
- The two calls run at the same time. If the first finds nothing specific to the place, the history from the second is dropped (#721).
- No page read: no LLM call, every field null, and a notice in the draft.
- Serper key missing: the editor shows the error. Serper down: the reference page is read alone.
- Search snippets are not source text; only fetched pages count.
- No model-side search tool, on any provider.

## API
`POST /api/admin/ai/research-v2` (admin) keeps its request and its `data` fields, where `sources` is still an array of URL strings. `data` adds:

| Field | Meaning |
|---|---|
| `pages_read` | `[{ url, title, origin: 'reference' \| 'search', cached }]` |
| `unreachable` | `[{ url, reason }]` |
| `search_query` | the Serper query, or null when search failed |
| `notice` | set when nothing was drafted, else null |

## Out of scope
- The editable "POI Research" prompts in the Jobs tab (`gemini_prompt_brief`, `gemini_prompt_historical`) are not read by research; tracked separately.
- Settings for the page count and text budget; they are constants in `researchSources.js`.
