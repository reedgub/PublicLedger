import type { SourceAdapter, SourceRecord } from "@/lib/sources/types";

export type ManualSourceOptions = Omit<SourceRecord, "sourceType">;

export const manualSourceAdapter: SourceAdapter<ManualSourceOptions> = {
  sourceType: "manual",
  async fetch(options) {
    return [{ ...options, sourceType: "manual" }];
  },
};
