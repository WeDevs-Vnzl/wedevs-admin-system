import type { PortalShare, PortalSupport, PortalVisitor } from './portal-support';

export interface ResolveShareTokenInput {
  readonly token: string;
  readonly visitor: PortalVisitor;
}

/**
 * `resolveShareToken` (PRD §12 `shares`, HU-22 CA2–CA4): the portal page of a link. The token is the authority
 * (DT-84): no session, no `can()`. It has no side effect and writes no log row (contract choice 2); the `VIEW`
 * is a separate call. Only the documents and pinned versions of the link are reachable.
 */
export class ResolveShareToken {
  constructor(private readonly support: PortalSupport) {}

  async execute(input: ResolveShareTokenInput): Promise<PortalShare> {
    const link = await this.support.liveLink(input.token);
    const unlocked = this.support.unlockedIds(input.visitor, link.token);
    const rows = await this.support.documentsOf(link);
    const names = await this.support.typeNamesById();
    const documents = await Promise.all(
      rows.map((row) => this.support.toPortalDocument(row, unlocked, names)),
    );
    return {
      title: link.title,
      message: link.message,
      locale: link.locale,
      allowDownload: link.allowDownload,
      clientName: await this.support.clientName(link),
      expiresAt: link.expiresAt,
      documents,
    };
  }
}
