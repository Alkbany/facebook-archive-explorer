import * as cheerio from 'cheerio';
import { basename } from 'node:path';

export type FriendRecordType = 'friend' | 'received' | 'sent' | 'rejected' | 'removed';

export interface FriendRecord {
  recordType: FriendRecordType;
  nameRaw: string;
  dateRaw: string | null;
  contactInfoRaw: string | null;
  sourceFile: string;
  sourceCardIndex: number;
}

export interface FriendParseIssue {
  code: 'no_cards_found' | 'missing_name';
  sourceCardIndex: number | null;
}

export interface FriendParseResult {
  records: FriendRecord[];
  issues: FriendParseIssue[];
}

const RECORD_TYPE_BY_FILE: Readonly<Record<string, FriendRecordType>> = {
  'friends.html': 'friend',
  'received_friend_requests.html': 'received',
  'sent_friend_requests.html': 'sent',
  'rejected_friend_requests.html': 'rejected',
  'removed_friends.html': 'removed'
};

const CARD_SELECTOR = 'div.pam._3-95._2pi0._2lej.uiBoxWhite.noborder';
const NAME_SELECTOR = 'div._3-96._2pio._2lek._2lel';
const DATE_SELECTOR = 'div._3-94._2lem';
const CONTACT_SELECTOR = 'div._3-96._2let';

/**
 * Parses one of the five known Friends export pages.
 *
 * Dates are retained as raw text; the parser does not infer their meaning.
 * Duplicate names remain separate records with their original card positions.
 */
export function parseFriendsExport(html: string, sourceFile: string): FriendParseResult {
  const fileName = basename(sourceFile).toLocaleLowerCase();
  const recordType = RECORD_TYPE_BY_FILE[fileName];

  if (!recordType) {
    throw new Error(`Unsupported friends export file: ${fileName}`);
  }

  const $ = cheerio.load(html);
  const cards = $(CARD_SELECTOR);
  const result: FriendParseResult = { records: [], issues: [] };

  if (cards.length === 0) {
    result.issues.push({ code: 'no_cards_found', sourceCardIndex: null });
    return result;
  }

  cards.each((sourceCardIndex, element) => {
    const card = $(element);
    const nameText = card.find(NAME_SELECTOR).first().text().replace(/\u00a0/gu, ' ').trim();
    const nameRaw = nameText.length > 0 ? nameText : null;

    if (!nameRaw) {
      result.issues.push({ code: 'missing_name', sourceCardIndex });
      return;
    }

    const dateText = card.find(DATE_SELECTOR).first().text().replace(/\u00a0/gu, ' ').trim();
    const dateRaw = dateText.length > 0 ? dateText : null;
    const contactText = recordType === 'friend'
      ? card.find(CONTACT_SELECTOR).first().text().replace(/\u00a0/gu, ' ').trim()
      : '';
    const contactInfoRaw = contactText.length > 0 ? contactText : null;

    result.records.push({
      recordType,
      nameRaw,
      dateRaw,
      contactInfoRaw,
      sourceFile,
      sourceCardIndex
    });
  });

  return result;
}
