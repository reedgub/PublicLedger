import { describe, expect, it } from "vitest";
import { dailyMessage, escapeSlack, resolveMessage, type DailyReport, type SiteSnapshot } from "@/lib/notify/slack";

const report = (overrides: Partial<DailyReport> = {}): DailyReport => ({
  x: { experts: 25, posts: 40, newSources: 30, errors: 0, stoppedByBudget: false },
  feeds: { feeds: 16, newSources: 12, errors: 0 },
  podcasts: { shows: 0, episodes: 0, errors: 0, stoppedByBudget: false },
  cascade: { sourcesExamined: 42, extracted: 9, candidatesPending: 6, candidatesRejected: 3, deferredByBudget: 0 },
  verified: { published: 2, rejected: 5 },
  batchSubmitted: 6,
  runCostUsd: 0.274,
  durationS: 150,
  ...overrides,
});

const snapshot = (overrides: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  newlyPublished: [{ id: "p1", expertName: "Nate Silver", claim: "Dems win the House <by 5+ seats> & more", resolutionDate: "2026-11-03" }],
  newlyPublishedCount: 1,
  totalPublished: 423,
  spendTodayUsd: 0.3,
  spend7dUsd: 3.59,
  ...overrides,
});

const body = (message: { blocks: unknown[] }) => JSON.stringify(message.blocks);

describe("slack run reports", () => {
  it("escapes Slack control characters", () => {
    expect(escapeSlack("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  it("lists what went live with links and escaped claims", () => {
    const message = dailyMessage(report(), snapshot(), "https://publicledger.example");
    expect(message.text).toContain("1 new prediction live");
    expect(body(message)).toContain("https://publicledger.example/predictions/p1|Dems win the House &lt;by 5+ seats&gt; &amp; more");
    expect(body(message)).toContain("423 predictions live");
    expect(body(message)).not.toContain("Needs attention");
  });

  it("says plainly when nothing was published", () => {
    const message = dailyMessage(report({ verified: { published: 0, rejected: 4 } }), snapshot({ newlyPublished: [], newlyPublishedCount: 0 }), null);
    expect(message.text).toContain("no new predictions today");
    expect(body(message)).not.toContain("Published in the last 24 hours");
  });

  it("flags crashes, provider refusals and budget stops", () => {
    const message = dailyMessage(
      report({ error: "boom", cascade: { sourcesExamined: 1, extracted: 0, candidatesPending: 0, candidatesRejected: 0, deferredByBudget: 3, providerError: "402 no credits" } }),
      snapshot(),
      null,
    );
    const text = body(message);
    expect(text).toContain("❌");
    expect(text).toContain("Run crashed");
    expect(text).toContain("402 no credits");
    expect(text).toContain("daily budget cap");
  });

  it("reports verdicts and held-back resolutions", () => {
    const message = resolveMessage({ due: 3, verdicts: [{ id: "p2", claim: "Fed hikes in September", outcome: "correct" }], heldBack: 2, errors: 0, costUsd: 0.21, stoppedByBudget: false }, null);
    expect(message.text).toContain("1 new verdict");
    expect(body(message)).toContain("Fed hikes in September");
    expect(body(message)).toContain("2 below the confidence bar");
  });
});
