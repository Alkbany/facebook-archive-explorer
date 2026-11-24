import { describe, expect, it } from 'vitest';
import { mergeArchiveAssistantEvidence, validateArchiveAssistantCitations } from '../src/main/database/ai-assistant-service';
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
    expect(merged.map((item) => item.recordId)).toEqual([7, 8, 9]);
    expect(merged.map((item) => item.sourceId)).toEqual(['S1', 'S2', 'S3']);
    expect(merged[2]).toMatchObject({
      sourcePath: 'comments/comments.html',
      excerpt: 'Semantic-only record — A related archived subject'
    });
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

describe('AI Assistant citation validation', () => {
  it('keeps only citations that were supplied by local evidence retrieval', () => {
    const result = validateArchiveAssistantCitations(
      'The archive mentions a work discussion [S1]. This unsupported marker [S99] is not valid.',
      [source('S1'), source('S2')]
    );

    expect(result.answer).toBe('The archive mentions a work discussion [S1]. This unsupported marker  is not valid.');
    expect(result.citations).toEqual([source('S1')]);
  });

  it('withholds source navigation when no valid citation marker exists', () => {
    const result = validateArchiveAssistantCitations(
      'A model-generated claim without a source marker.',
      [source('S1')]
    );
    expect(result.citations).toEqual([]);
  });

  it('recognizes multiple valid source IDs without accepting malformed markers', () => {
    const result = validateArchiveAssistantCitations(
      'First point [S1], second point [S2], invalid [S0] and malformed [SX].',
      [source('S1'), source('S2')]
    );

    expect(result.citations.map((item) => item.sourceId)).toEqual(['S1', 'S2']);
    expect(result.answer).not.toContain('[S0]');
    expect(result.answer).not.toContain('[SX]');
  });
});
