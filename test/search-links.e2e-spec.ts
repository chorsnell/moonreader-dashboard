/** Admin → Search links: saved by the admin, sent to each viewer in /api/config. */
import request from 'supertest';
import { TOKEN, TestDashboard } from './support/test-dashboard';

let dash: TestDashboard | undefined;
afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

describe('search links', () => {
  it('are saved by the admin, and visitors only get theirs', async () => {
    dash = await TestDashboard.start();
    const s = dash.server;
    await request(s).get('/api/admin/search-links').expect(403);
    await request(s).put('/api/admin/search-links').send({ links: [] }).expect(403);
    const admin = (r: request.Test) => r.set('X-Upload-Token', TOKEN);

    expect((await admin(request(s).get('/api/admin/search-links')).expect(200)).body).toEqual({
      links: [],
    });
    await admin(request(s).put('/api/admin/search-links'))
      .send({ links: [{ name: 'No book', url: 'https://example.org/' }] })
      .expect(400);
    const links = [
      { name: 'Library', url: 'https://library.example/search?q={query}', visitors: true },
      { name: 'Mine', url: 'https://mine.example/?isbn={isbn}' },
    ];
    const saved = await admin(request(s).put('/api/admin/search-links'))
      .send({ links })
      .expect(200);
    expect(saved.body.links.map((l: { name: string }) => l.name)).toEqual(['Library', 'Mine']);

    const asAdmin = await admin(request(s).get('/api/config')).expect(200);
    expect(asAdmin.body.search_links.map((l: { name: string }) => l.name)).toEqual([
      'Library',
      'Mine',
    ]);
    const asVisitor = await request(s).get('/api/config').expect(200);
    expect(asVisitor.body.search_links).toEqual([
      { name: 'Library', url: 'https://library.example/search?q={query}', visitors: true },
    ]);

    // saving none removes them
    await admin(request(s).put('/api/admin/search-links')).send({ links: [] }).expect(200);
    expect((await request(s).get('/api/config').expect(200)).body.search_links).toEqual([]);
  });
});
