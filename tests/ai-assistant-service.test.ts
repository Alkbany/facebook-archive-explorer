import { describe, expect, it } from 'vitest';
import { validateArchiveAssistantCitations } from '../src/main/database/ai-assistant-service';
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
