/** Admin → Imports → KOReader plugin: the plugin as a zip, with this dashboard filled in. */
import request from 'supertest';
import { TOKEN, TestDashboard } from './support/test-dashboard';

let dash: TestDashboard | undefined;
afterEach(async () => {
  await dash?.stop();
  dash = undefined;
});

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('KOReader plugin download', () => {
  it('is only for the admin', async () => {
    dash = await TestDashboard.start();
    await request(dash.server).get('/api/koreader/plugin.zip').expect(403);
  });

  it('holds the plugin folder and a defaults.lua, with the password only when asked', async () => {
    dash = await TestDashboard.start();
    const plain = await request(dash.server)
      .get('/api/koreader/plugin.zip')
      .set('X-Upload-Token', TOKEN)
      .set('Host', 'books.example.com')
      .set('X-Forwarded-Proto', 'https')
      .buffer(true)
      .parse(binary)
      .expect(200)
      .expect('Content-Type', 'application/zip');
    const body = (plain.body as Buffer).toString('latin1');
    expect(body.startsWith('PK')).toBe(true);
    expect(body).toContain('readingdashboard.koplugin/main.lua');
    expect(body).toContain('readingdashboard.koplugin/_meta.lua');
    expect(body).toContain('readingdashboard.koplugin/defaults.lua');
    expect(body).toMatch(/return \{ url = "https?:\/\/books\.example\.com" \}/);
    expect(body).not.toContain(TOKEN);

    const withToken = await request(dash.server)
      .get('/api/koreader/plugin.zip?token=1')
      .set('X-Upload-Token', TOKEN)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((withToken.body as Buffer).toString('latin1')).toContain(`token = "${TOKEN}"`);
  });
});
