export interface SourceRecord {
  sourceType: string;
  externalId?: string;
  authorExternalId?: string;
  authorHandle?: string;
  publishedAt: Date;
  exactText?: string;
  canonicalPath?: string;
  metadata: Record<string, unknown>;
}

export interface SourceAdapter<TOptions = Record<string, never>> {
  readonly sourceType: string;
  fetch(options: TOptions): Promise<SourceRecord[]>;
}
