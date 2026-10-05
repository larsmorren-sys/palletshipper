import { createHash } from 'node:crypto';
export const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function checkRevision(body, current) {
  if (body?.revision !== undefined && body.revision !== current) throw Object.assign(new Error('Iemand anders heeft deze gegevens gewijzigd. De actuele gegevens zijn opgehaald. Sluit het formulier en open het opnieuw om verder te werken.'), { status: 409 });
}
