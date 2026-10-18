import { sameBook } from '../common/book-match';
import { ClubError, clubFor, progressOf, toClubInput, toComment, type Club } from './clubs';

const club: Club = {
  id: 'c1',
  book: { title: 'Emma', author: 'Jane Austen', isbn13: null, work_id: null, book_id: 'emma' },
  members: [
    { key: 'me', name: 'You', friend: null, follower: null },
    { key: 'friend:ada', name: 'Ada', friend: 'ada', follower: 'f1' },
  ],
  start: '2026-01-01',
  pct_per_week: 10,
  created: '2026-01-01T10:00:00',
  comments: [
    { id: 'b', member: 'friend:ada', name: 'Ada', position: 60, text: 'Twist!', created: '1' },
    { id: 'a', member: 'me', name: 'You', position: 20, text: 'Hello', created: '2' },
    { id: 'c', member: 'me', name: 'You', position: 40, text: 'Exactly here', created: '3' },
  ],
};

describe('book clubs', () => {
  it('shows comments up to where you are, in book order, and hides the rest', () => {
    const out = clubFor(club, 40);
    expect(out.comments.map((c) => [c.position, c.text, c.hidden])).toEqual([
      [20, 'Hello', false],
      [40, 'Exactly here', false],
      [60, null, true],
    ]);
    expect(JSON.stringify(out)).not.toContain('f1'); // follower ids stay on the server
    expect(clubFor(club, 100).comments.every((c) => !c.hidden)).toBe(true);
  });

  it('reads a new club, always with you in it', () => {
    const c = toClubInput({
      book: { title: ' Emma ', author: 'Jane Austen' },
      start: '2026-02-01',
      pct_per_week: '12.34',
      members: [{ friend: 'ada', name: 'Ada' }, { friend: 'ada' }, { name: 'nobody' }],
    });
    expect(c.book.title).toBe('Emma');
    expect(c.pct_per_week).toBe(12.3);
    expect(c.members.map((m) => m.key)).toEqual(['me', 'friend:ada']);
    expect(toClubInput({ book: { title: 'X' }, start: '2026-02-01' }).pct_per_week).toBeNull();
    expect(() => toClubInput({ book: {}, start: '2026-02-01' })).toThrow(ClubError);
    expect(() => toClubInput({ book: { title: 'X' }, start: 'tomorrow' })).toThrow(ClubError);
    expect(() => toComment({ position: 10, text: ' ' })).toThrow(ClubError);
    expect(toComment({ position: '33.33', text: 'ok' })).toEqual({ position: 33.3, text: 'ok' });
  });

  it('finds your copy of the book and how far you are', () => {
    const books = [
      { id: 'emma-1', title: 'EMMA', author: 'Jane  Austen', status: 'in_progress', progress: 42 },
    ];
    expect(progressOf(sameBook(books, club.book))).toBe(42);
    expect(progressOf({ status: 'finished', progress: 99.5 })).toBe(100);
    expect(progressOf(null)).toBe(0);
  });
});
