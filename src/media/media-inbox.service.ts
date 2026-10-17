import { open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { Injectable } from '@nestjs/common';
import * as yauzl from 'yauzl';
import { RequestBodyError, saveRequestBody } from '../common/http/request-body';
import { localDateTime } from '../common/time';
import { ActivityLogService } from '../library/activity-log.service';
import { LibraryService, safeFileName } from '../library/library.service';
import { MediaBuildService } from './media-build.service';
import { MediaFiles } from './media-files.service';
import { looksLikeNetflix, parseNetflix } from './sources/netflix';

/** How many Netflix uploads to keep; only the newest is used, the rest are for going back. */
const KEEP_NETFLIX = 3;
const MAX_CSV_BYTES = 200 * 1024 * 1024;

const isZip = (chunk: Buffer) => chunk.subarray(0, 2).toString('latin1') === 'PK';

/** A refused upload, with a message for the page. */
export class MediaUploadError extends Error {}

/** Uploads of other media: the Netflix export (as its .csv, or the whole .zip Netflix sends). */
@Injectable()
export class MediaInboxService {
  constructor(
    private readonly files: MediaFiles,
    private readonly builder: MediaBuildService,
    private readonly library: LibraryService,
    private readonly activity: ActivityLogService,
  ) {}

  /** Saves an uploaded Netflix file and starts a rebuild. Returns the profiles found in it. */
  async receiveNetflix(
    req: IncomingMessage,
    name: string,
  ): Promise<{ file: string; profiles: string[] }> {
    const stamp = localDateTime().replace(/[-:]/g, '').replace('T', '-');
    const tmp = join(this.files.netflixInbox, `.upload-${stamp}`);
    try {
      await saveRequestBody(req, tmp, {
        maxBytes: MAX_CSV_BYTES,
        accept: (c) => isZip(c) || looksLikeNetflix(c.toString('utf8', 0, 300)),
      });
    } catch (e) {
      if (!(e instanceof RequestBodyError)) throw e;
      throw new MediaUploadError(
        e.problem === 'bad-content'
          ? "That isn't a Netflix viewing activity file (ViewingActivity.csv, NetflixViewingHistory.csv or the export's .zip)."
          : e.message,
      );
    }
    try {
      const head = Buffer.alloc(2);
      const fh = await open(tmp, 'r');
      await fh.read(head, 0, 2, 0).finally(() => fh.close());
      const text = isZip(head) ? await viewingActivityFromZip(tmp) : await readFile(tmp, 'utf8');
      const parsed = parseNetflix(text); // throws when it isn't one
      const base = safeFileName(name.replace(/\.(zip|csv)$/i, '')) || 'netflix';
      const file = `${base}-${stamp}.csv`;
      await writeFile(join(this.files.netflixInbox, `${file}.part`), text, 'utf8');
      await rename(
        join(this.files.netflixInbox, `${file}.part`),
        join(this.files.netflixInbox, file),
      );
      this.activity.log(
        `Received Netflix ${parsed.kind === 'activity' ? 'viewing activity' : 'viewing history'} ${file} (${parsed.rows.length} rows)`,
      );
      for (const old of (await this.builder.netflixFiles()).slice(KEEP_NETFLIX)) {
        await rm(old, { force: true });
      }
      this.library.changed();
      return { file, profiles: parsed.profiles };
    } catch (e) {
      if (e instanceof MediaUploadError) throw e;
      throw new MediaUploadError((e as Error).message);
    } finally {
      await rm(tmp, { force: true });
    }
  }
}

/** The ViewingActivity.csv inside the zip Netflix's data download comes as. */
async function viewingActivityFromZip(path: string): Promise<string> {
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false });
  } catch {
    throw new MediaUploadError("That zip file can't be opened.");
  }
  try {
    for await (const entry of zip.eachEntry()) {
      if (/(^|\/)ViewingActivity\.csv$/i.test(entry.fileName)) {
        return (await buffer(await zip.openReadStreamPromise(entry))).toString('utf8');
      }
    }
  } finally {
    zip.close();
  }
  throw new MediaUploadError(
    'No CONTENT_INTERACTION/ViewingActivity.csv in that zip. Upload the zip from Netflix\'s "Download your personal information".',
  );
}
