export interface MessageConversationSummary {
  sourceFileId: number;
  relativePath: string;
  conversationType: string;
  messageCount: number;
  participants: string[];
}

export interface MessageMediaSummary {
  id: number;
  relativePath: string;
  mediaKind: string;
  role: string | null;
  previewDataUrl?: string;
}

export interface MessageRecordSummary {
  id: number;
  sourceCardIndex: number;
  sender: string | null;
  body: string | null;
  timestampRaw: string | null;
  reactions: string[];
  recordType: string;
  media: MessageMediaSummary[];
}
