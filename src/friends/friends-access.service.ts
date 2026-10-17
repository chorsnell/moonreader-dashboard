import type { IncomingMessage } from 'node:http';
import { Injectable } from '@nestjs/common';
import { AccessSettingsService } from '../access/access-settings.service';
import { AccessService } from '../access/access.service';
import { PrivacyService } from '../privacy/privacy.service';

/**
 * Friends' data is theirs, shared with you: by default only the admin sees it. The admin can
 * let people with the read password, or everyone who can see the dashboard, see it too.
 */
@Injectable()
export class FriendsAccessService {
  constructor(
    private readonly access: AccessService,
    private readonly settings: AccessSettingsService,
    private readonly privacy: PrivacyService,
  ) {}

  canRead(req: IncomingMessage): Promise<boolean> {
    return this.access.canRead(req);
  }

  async canSee(req: IncomingMessage): Promise<boolean> {
    if (!(await this.access.canRead(req))) return false;
    const { friends } = await this.settings.load();
    const viewer = await this.privacy.viewer(req);
    // the admin previewing as a visitor sees what that visitor would
    const role = viewer.preview ?? viewer.role;
    if (role === 'admin') return true;
    if (friends.visible_to === 'public') return role !== 'friends';
    return friends.visible_to === 'reader' && role === 'reader';
  }
}
