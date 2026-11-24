export const MESSAGE_CONVERSATION_PAGE_SIZE = 50;
export const MESSAGE_CONVERSATION_LIST_PAGE_SIZE = 50;

export interface MessageConversationListPage {
  items: MessageConversationSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MessageConversationPage {
  records: MessageRecordSummary[];
  page: number;
  pageSize: number;
  total: number;
}

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

export interface MessageMediaGalleryItem {
  id: number;
  relativePath: string;
  mediaKind: string;
  role: string | null;
  sourceFileId: number;
  conversationPath: string;
  sender: string | null;
  timestampRaw: string | null;
  body: string | null;
}
