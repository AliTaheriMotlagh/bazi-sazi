export type ResourceKind = 'model' | 'texture' | 'image' | 'audio' | 'video' | 'font' | 'tool' | 'other';
export type LicenseGroup = 'cc0' | 'attribution' | 'other';

export interface ResourceItem {
  /** `<provider>:<provider's own id>` — stable across searches. */
  id: string;
  provider: string;
  title: string;
  kind: ResourceKind;
  thumb: string | null;
  /** Playable preview (audio/video) when the source offers one. */
  preview?: string;
  /** Short license name as the source states it, e.g. "CC0" or "CC BY 4.0". */
  license: string;
  licenseGroup: LicenseGroup;
  licenseUrl?: string;
  author?: string;
  description?: string;
  /** The human page for this resource (always set — opens in a new tab). */
  sourceUrl: string;
  /** Direct file the studio can import into a project (absent for link-only results). */
  downloadUrl?: string;
  size?: number;
  tags?: string[];
  /** Already downloaded by someone: adding it to a project is instant (no download). */
  inLibrary?: boolean;
  libraryId?: string;
  uses?: number;
}

export interface ResourceQuery {
  q: string;
  kind: ResourceKind | 'all';
  /** `cc0` = public domain only; `free` = anything free to use commercially (the default). */
  license: 'cc0' | 'free';
  page: number;
}

export interface ProviderResult {
  items: ResourceItem[];
  hasMore: boolean;
}

export interface Provider {
  id: string;
  label: string;
  kinds: ResourceKind[];
  search(query: ResourceQuery, fetchJson: FetchJson): Promise<ProviderResult>;
}

export type FetchJson = (url: string) => Promise<unknown>;

export const PAGE_SIZE = 24;

export function licenseGroup(name: string): LicenseGroup {
  const n = name.toLowerCase();
  if (/\bcc0\b|public domain|\bpd\b|pdm|unlicense/.test(n)) return 'cc0';
  if (/cc[- ]by/.test(n) || /attribution/.test(n)) return 'attribution';
  return 'other';
}

/** Licences that forbid commercial use or derivatives can't go into a published game. */
export const isFreeForGames = (name: string): boolean => !/\bnc\b|non-?commercial|\bnd\b|no[- ]?derivs?|all rights reserved|unknown/i.test(name);
