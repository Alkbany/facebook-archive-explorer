export interface MessageConversationSummary {
  sourceFileId: number;
  relativePath: string;
  conversationType: string;
  messageCount: number;
  participants: string[];
}

export interface MessageMediaSummary {
  relativePath: string;
  mediaKind: string;
  role: string | null;
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
