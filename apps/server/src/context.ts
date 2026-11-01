import type { config } from './config.ts';
import type { Db } from './db.ts';
import type { FileStore } from './storage.ts';

/** Dependencies shared by route modules (passed explicitly, no globals). */
export interface AppContext {
  db: Db;
  config: typeof config;
  files: FileStore;
}
