import React, { useEffect, useRef, useState } from 'react';

export function PhotoViewer({ photos, initialIndex, palletName, onClose }) {
  const [index, setIndex] = useState(initialIndex);
  const dialog = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current.querySelector('button').focus();
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); setIndex(i => (i + 1) % photos.length); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); setIndex(i => (i - 1 + photos.length) % photos.length); }
      if (event.key === 'Tab') {
        const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, [photos.length, onClose]);
  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal photo-viewer" ref={dialog} role="dialog" aria-modal="true" aria-label={`Foto’s van ${palletName}`}>
      <header><h2>{palletName}</h2><button className="secondary" aria-label="Fotopopup sluiten" onClick={onClose}>Sluiten</button></header>
      <img className="viewer-image" src={photos[index].url} alt={`Foto ${index + 1} van ${palletName}`}/>
      <div className="viewer-controls"><button className="secondary" disabled={photos.length < 2} onClick={() => setIndex(i => (i - 1 + photos.length) % photos.length)}>Vorige foto</button><span role="status">Foto {index + 1} van {photos.length}</span><button className="secondary" disabled={photos.length < 2} onClick={() => setIndex(i => (i + 1) % photos.length)}>Volgende foto</button></div>
    </section>
  </div>;
}
