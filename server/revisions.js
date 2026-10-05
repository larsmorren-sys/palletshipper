import { createHash } from 'node:crypto';
export const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function checkRevision(body, current) {
  if (body?.revision !== undefined && body.revision !== current) throw Object.assign(new Error('Someone else has changed this data. The latest data has been retrieved. Close and reopen the form to continue.'), { status: 409 });
}
