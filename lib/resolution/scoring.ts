import type { ResolutionOutcome } from "@/types/domain";

export function isScoringEligibleOutcome(outcome: ResolutionOutcome): boolean {
  return outcome === "correct" || outcome === "incorrect";
}

export function assertResolutionScoring(outcome: ResolutionOutcome, scoringEligible: boolean): void {
  if (scoringEligible && !isScoringEligibleOutcome(outcome)) {
    throw new Error(`${outcome} resolutions cannot be scoring eligible`);
  }
}
