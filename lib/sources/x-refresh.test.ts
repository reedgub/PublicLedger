import { describe, expect, it } from "vitest";
import { samePostText, type XApiPost } from "@/lib/sources/x-parser";

const post = (text: string, note?: string): XApiPost => ({ id: "1", text, ...(note ? { note_tweet: { text: note } } : {}) });

// Real stored/live pairs that the 2026-10-12 weekly refresh wrongly treated
// as edited: only the rendering differs, the words are the same.
const unchanged: Array<[string, string]> = [
  [
    "Its going to be an era of contradictions.Polls will show everyone hates AI overall but also everyone will secretly use AI all the time. AI companies will be underwater in public opinion but also many people will feel strongly attached to their own favorite model & care about it",
    "Its going to be an era of contradictions.\n\nPolls will show everyone hates AI overall but also everyone will secretly use AI all the time. AI companies will be underwater in public opinion but also many people will feel strongly attached to their own favorite model &amp; care about it",
  ],
  ["Omarchy Quattro will be shipping this week. pic.twitter.com/yGlvFodXkJ", "Omarchy Quattro will be shipping this week. https://t.co/yGlvFodXkJ"],
  [
    "Probably over 30k people working in high-paying jobs at Tesla HQ & manufacturing in Austin by 2028! https://t.co/1ftByFypQg",
    "Probably over 30k people working in high-paying jobs at Tesla HQ &amp; manufacturing in Austin by 2028! https://t.co/1ftByFypQg",
  ],
  [
    "IMO people are underestimating the chance of a double-digit Dem margin in Nov. Modal outcome? No, but certainly 20-30%+ chance. Our LV generic ballot is D+8-9, and out-party tends to gain 1-2 points from Sept to Novhttps://t.co/tN6vJp1VTC",
    "IMO people are underestimating the chance of a double-digit Dem margin in Nov. Modal outcome? No, but certainly 20-30%+ chance. Our LV generic ballot is D+8-9, and out-party tends to gain 1-2 points from Sept to Nov\n\nhttps://t.co/tN6vJp1VTC",
  ],
  ["Uber will be a ~$125 stock in 12 months.", "@BobDerise @SawyerMerritt Uber will be a ~$125 stock in 12 months."],
  [
    "I asked @Jaguars HC Liam Coen about Travis Hunter-- the person-- and what made him so special. His answer will make you want to run through a wall. The second overall pick is due for a big Year 2. From today's \"The Schrager Hour\". @OmahaProd @TravisHunterJr @DeionSanders pic.twitter.com/t9yQDGmyGL",
    "I asked @Jaguars HC Liam Coen about Travis Hunter-- the person-- and what made him so special. \n\nHis answer will make you want to run through a wall. \n\nThe second overall pick is due for a big Year 2. \n\nFrom today's \"The Schrager Hour\". \n\n@OmahaProd @TravisHunterJr @DeionSanders https://t.co/t9yQDGmyGL",
  ],
];

describe("X source refresh comparison", () => {
  it.each(unchanged)("treats formatting-only differences as unchanged: %s", (stored, live) => {
    expect(samePostText(stored, post(live))).toBe(true);
  });

  it("matches the truncated or the long-form text", () => {
    expect(samePostText("Short form…", post("Short form…", "Short form with the full long-form text"))).toBe(true);
    expect(samePostText("Short form with the full long-form text", post("Short form…", "Short form with the full long-form text"))).toBe(true);
  });

  it("still catches real edits and deletions of text", () => {
    expect(samePostText("Uber will be a ~$125 stock in 12 months.", post("Uber will be a ~$150 stock in 12 months."))).toBe(false);
    expect(samePostText("Omarchy Quattro will be shipping this week.", post("Omarchy Quattro will be shipping next month."))).toBe(false);
    expect(samePostText("Bitcoin to $1M by 2027 https://t.co/abc", post("Bitcoin to $1M by 2027 https://t.co/xyz"))).toBe(false);
    expect(samePostText(null, post("anything"))).toBe(false);
  });

  it("only strips @mentions at the very start of a reply", () => {
    expect(samePostText("Thanks @alice for the call", post("Thanks for the call"))).toBe(false);
  });
});
