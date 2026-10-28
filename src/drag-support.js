import { useEffect, useState } from 'react';
// Keep dragging off on phones/tablets (including iPads using a desktop user agent).
function supported() {
  return !navigator.maxTouchPoints && !navigator.userAgentData?.mobile && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !window.matchMedia('(any-pointer: coarse)').matches;
}
export function useDragSupported() {
  const [value,setValue]=useState(supported);
  useEffect(()=>{const query=window.matchMedia('(any-pointer: coarse)');const update=()=>setValue(supported());query.addEventListener('change',update);window.addEventListener('resize',update);return()=>{query.removeEventListener('change',update);window.removeEventListener('resize',update);};},[]);
  return value;
}
