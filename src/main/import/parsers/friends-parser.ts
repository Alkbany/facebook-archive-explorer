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

function readText(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<cheerio.Element>,
  selector: string
): string | null {
  const value = root.find(selector).first().text().replace(/\u00a0/gu, ' ').trim();
  return value.length > 0 ? value : null;
}

/**
 * Parses one of the five known Friends export pages.
 *
 * The parser deliberately keeps raw date text and does not infer what the date
 * represents. It also does not merge duplicate names or create profile IDs.
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
    const nameRaw = readText($, card, NAME_SELECTOR);

    if (!nameRaw) {
      result.issues.push({ code: 'missing_name', sourceCardIndex });
      return;
    }

    const dateRaw = readText($, card, DATE_SELECTOR);
    const contactInfoRaw = recordType === 'friend'
      ? readText($, card, CONTACT_SELECTOR)
      : null;

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
