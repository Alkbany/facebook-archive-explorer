export interface ArchiveAssistantHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ArchiveAssistantCitation {
  sourceId: string;
  recordId: number;
  sectionKey: string;
  recordType: string;
  sourcePath: string;
  sourceCardIndex: number;
  dateRaw: string | null;
  title: string | null;
  excerpt: string;
}

export interface ArchiveAssistantAnswer {
  answer: string;
  citations: ArchiveAssistantCitation[];
  evidenceCount: number;
  retrievalScope: {
    snapshotId: string;
    sectionKey: string | null;
    year: number | null;
  };
}

export type AiAssistantPhase = 'disabled' | 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

export interface AiAssistantStatus {
  enabled: boolean;
  modelId: string;
  modelVersion: string;
  phase: AiAssistantPhase;
  progressPercent: number | null;
  lastErrorCode: string | null;
}

export interface AiAssistantHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}
