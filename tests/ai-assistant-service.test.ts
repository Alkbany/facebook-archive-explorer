import { describe, expect, it } from 'vitest';
import { combineArchiveAssistantComparisonEvidence, mergeArchiveAssistantEvidence, validateArchiveAssistantCitations } from '../src/main/database/ai-assistant-service';
import type { ArchiveSearchResult } from '../src/shared/archive/search';
import type { ArchiveAssistantCitation } from '../src/shared/archive/assistant';

const source = (sourceId: string): ArchiveAssistantCitation => ({
  sourceId,
  recordId: Number(sourceId.slice(1)),
  sectionKey: 'posts',
  recordType: 'post',
  sourcePath: 'posts/your_posts.html',
  sourceCardIndex: 0,
  dateRaw: '2022-11-24',
  title: 'Synthetic post',
  excerpt: 'A synthetic archived post'
});

describe('AI Assistant evidence merge', () => {
  it('combines lexical and semantic matches, removes duplicate records, and reassigns source IDs', () => {
    const lexical = [
      { citation: source('S7'), relevance: -2 },
      { citation: { ...source('S8'), recordId: 8 }, relevance: -1 }
    ];
    const semantic: ArchiveSearchResult[] = [
      {
        id: 8, sectionKey: 'posts', recordType: 'post',
        sourcePath: 'posts/your_posts.html', sourceCardIndex: 3,
        title: 'Duplicate lexical record', body: 'Should not appear twice',
        dateRaw: '2024-01-02', relevance: -0.9, matchType: 'semantic', similarity: 0.9
      },
      {
        id: 9, sectionKey: 'comments', recordType: 'comment',
        sourcePath: 'comments/comments.html', sourceCardIndex: 4,
        title: 'Semantic-only record', body: 'A related archived subject',
        dateRaw: '2024-02-03', relevance: -0.85, matchType: 'semantic', similarity: 0.85
      }
    ];

    const merged = mergeArchiveAssistantEvidence(lexical, semantic);
    // Record 8 is retrieved by both methods, so its combined RRF score ranks first.
    expect(merged.map((item) => item.recordId)).toEqual([8, 7, 9]);
    expect(merged.map((item) => item.sourceId)).toEqual(['S1', 'S2', 'S3']);
    expect(merged[0]).toMatchObject({ recordId: 8, title: 'Synthetic post' });
    expect(merged[2]).toMatchObject({
      sourcePath: 'comments/comments.html',
      excerpt: 'Semantic-only record — A related archived subject'
    });
  });

  it('breaks equal reciprocal-rank scores by stable record ID', () => {
    const lexical = [
      { citation: { ...source('S15'), recordId: 15 }, relevance: -2 },
      { citation: { ...source('S20'), recordId: 20 }, relevance: -1 }
    ];
    const semantic: ArchiveSearchResult[] = [
      {
        id: 10, sectionKey: 'posts', recordType: 'post',
        sourcePath: 'posts/your_posts.html', sourceCardIndex: 10,
        title: 'Semantic record ten', body: 'Evidence ten',
        dateRaw: null, relevance: -0.9, matchType: 'semantic', similarity: 0.9
      },
      {
        id: 30, sectionKey: 'comments', recordType: 'comment',
        sourcePath: 'comments/comments.html', sourceCardIndex: 30,
        title: 'Semantic record thirty', body: 'Evidence thirty',
        dateRaw: null, relevance: -0.8, matchType: 'semantic', similarity: 0.8
      }
    ];

    const merged = mergeArchiveAssistantEvidence(lexical, semantic);
    expect(merged.map((item) => item.recordId)).toEqual([10, 15, 20, 30]);
  });

  it('uses up to twelve lexical records when semantic retrieval is unavailable', () => {
    const lexical = Array.from({ length: 14 }, (_, index) => ({
      citation: { ...source('S' + (index + 1)), recordId: index + 1 },
      relevance: index
    }));
    const merged = mergeArchiveAssistantEvidence(lexical, []);
    expect(merged).toHaveLength(12);
    expect(merged[0].sourceId).toBe('S1');
    expect(merged[11].sourceId).toBe('S12');
  });
});

describe('AI Assistant multi-snapshot evidence', () => {
  it('assigns unique citation IDs and explicit backup provenance to both evidence sets', () => {
    const baseline = { ...source('S1'), recordId: 11 };
    const compared = { ...source('S1'), recordId: 22 };
    const result = combineArchiveAssistantComparisonEvidence(
      [baseline],
      [compared],
      { id: 'older-id', backupName: 'Older backup' },
      { id: 'newer-id', backupName: 'Newer backup' }
    );

    expect(result.map((item) => item.sourceId)).toEqual(['S1', 'S2']);
    expect(result[0]).toMatchObject({
      recordId: 11, snapshotId: 'older-id', snapshotLabel: 'Older backup', comparisonSide: 'baseline'
    });
    expect(result[1]).toMatchObject({
      recordId: 22, snapshotId: 'newer-id', snapshotLabel: 'Newer backup', comparisonSide: 'compared'
    });
  });
});

describe('AI Assistant citation validation', () => {
  it('rejects the whole answer when any sentence contains no valid source citation', () => {
    const result = validateArchiveAssistantCitations(
      'The archive mentions a work discussion [S1]. This unsupported statement has no valid source [S99].',
      [source('S1'), source('S2')]
    );

    expect(result.citations).toEqual([source('S1')]);
    expect(result.hasCompleteCoverage).toBe(false);
    expect(result.answer).not.toContain('[S99]');
  });

  it('withholds source navigation and reports incomplete coverage when no valid marker exists', () => {
    const result = validateArchiveAssistantCitations(
      'A model-generated claim without a source marker.',
      [source('S1')]
    );
    expect(result.citations).toEqual([]);
    expect(result.hasCompleteCoverage).toBe(false);
  });

  it('requires coverage for every sentence and accepts only source IDs in the evidence set', () => {
    const result = validateArchiveAssistantCitations(
      'First point [S1]. Second point [S2]. Third point [S1] includes invalid [S0] and malformed [SX].',
      [source('S1'), source('S2')]
    );

    expect(result.citations.map((item) => item.sourceId)).toEqual(['S1', 'S2']);
    expect(result.hasCompleteCoverage).toBe(true);
    expect(result.answer).not.toContain('[S0]');
    expect(result.answer).not.toContain('[SX]');
  });

  it('associates a citation placed after sentence punctuation with the preceding claim', () => {
    const result = validateArchiveAssistantCitations(
      'The archive contains a work discussion. [S1]',
      [source('S1')]
    );
    expect(result.hasCompleteCoverage).toBe(true);
    expect(result.citations).toEqual([source('S1')]);
  });
});
