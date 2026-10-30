import { useEffect, useRef } from 'react';

export function useDragShortcut({ enabled, onToggle }) {
  const current=useRef({enabled,onToggle});
  current.current={enabled,onToggle};
  useEffect(()=>{
    let held=false;
    const modifier=event=>event.key==='Meta'||event.key==='Control';
    const down=event=>{
      if(!modifier(event)||event.repeat||held)return;
      held=true;
      if(!current.current.enabled||event.defaultPrevented||event.isComposing||event.altKey||event.shiftKey)return;
      if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"]'))return;
      current.current.onToggle();
    };
    const up=event=>{if(modifier(event))held=false;};
    const reset=()=>{held=false;};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',reset);
    return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',reset);};
  },[]);
}
