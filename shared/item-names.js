import { objectNameKey } from './numbering.js';
export const itemDisplayName = item => item.autoNumbered === 0 ? item.name : `${item.name} ${item.instanceNumber}`;
export const itemNameKey = item => objectNameKey(itemDisplayName(item));
export const itemNameIndex = items => new Map(items.map(item=>[objectNameKey(item.displayName || itemDisplayName(item)),item]));
export function conflictingItem(items, name, id) {
  const key=objectNameKey(name);
  const match=items instanceof Map ? items.get(key) : items.find(item=>item.id!==id && objectNameKey(item.displayName || itemDisplayName(item))===key);
  return match?.id!==id?match:undefined;
}
