export interface TransferCounts {
  items: number;
  folders: number;
  links: number;
}

/** Account metadata and aggregate counts only; no document identities. */
export interface TransferPreview {
  source: { id: string; name: string };
  recipients: { id: string; name: string }[];
  counts: TransferCounts;
  confirmation: string;
}
