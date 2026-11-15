# Prediction leads (`seed/manual/*.json`)

Files here are **leads, not facts**. They can come from anywhere: the daily
Grok Bot web search, a research assistant, or a person. Pushing a new or
changed file to `main` runs the **Import manual predictions** workflow. You
can also run `pnpm import:manual <file> [--batch | --no-verify]`.

Nothing in a lead is trusted. Every row is checked against the live original,
and only rows that pass every check reach the cascade verifier, which then
publishes or rejects them.

## Row format

A JSON array of objects:

```json
{
  "expertSlug": "larry-summers",
  "sourcePath": "https://x.com/LHSummers/status/1234567890123456789",
  "sourceQuote": "exact words copied from the original, no ellipses",
  "normalizedClaim": "One falsifiable sentence.",
  "resolutionCriteria": "What observable fact decides it.",
  "resolutionDate": "2027-12-31",
  "category": "economy-rates",
  "recordType": "prediction",
  "explicitProbability": 0.7,
  "falsifiabilityScore": 0.9
}
```

`expertSlug` must be an active expert in the roster. `category` must be one of
`CATEGORY_SLUGS` in `lib/constants.ts`. `resolutionDate` must be a real
`YYYY-MM-DD` date. `recordType: "take"` also requires an `imputationNote`.
Extra fields (for example `exactText`, `publishedAtSource`) are ignored. The
importer reads the original itself and never uses text or dates from the lead.

## What gets a lead rejected

| Result | Meaning |
| --- | --- |
| `x_post_unavailable` | X can't show the post (deleted, protected, or the id is wrong). |
| `not_expert_account` | X says someone other than the expert wrote the post. |
| `repost_not_authored` | The post is a repost. |
| `robots_disallowed`, `source_unreachable` | The page can't be fetched politely. |
| `source_date_unknown` | The page doesn't state when it was published. |
| `quote_not_found_in_source` | The quote isn't in the original, word for word. Typographic differences such as curly quotes, dashes, case and whitespace are tolerated; ellipses are not. |
| `not_a_direct_quote` | The words are on a third-party page but outside quotation marks, so they are the writer's paraphrase and not the expert's own words. |
| `probability_not_stated_in_quote` | A probability is kept only when the quote states it as one ("70% chance", "odds of 60%"). Otherwise it is dropped and never inferred. |
| verifier rejection | The cascade verifier judged the claim unfaithful, not falsifiable, hindsight-tainted, or below 0.9 confidence. |

## How sources are verified, and what it costs

- **X posts**: with `X_BEARER_TOKEN` set, the official API is used (billed per
  read). Without it, X's public oEmbed endpoint is used (free). The posting
  time is taken from the post id itself.
- **Web pages**: fetched live for free, respecting robots.txt. Only an excerpt
  around the quote is stored.
- **Verification**: the workflow uses the OpenAI Batch API by default (about
  half price). The next daily ingestion collects the results and publishes.
  Run it with `verify: sync` to publish right away.

After publication, `pnpm refresh:sources` (weekly) re-checks every original.
A deleted page, a deleted post, or a quote that is no longer on the page
quarantines the prediction.
