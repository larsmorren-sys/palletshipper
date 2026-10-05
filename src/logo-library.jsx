import React, { useEffect, useState } from 'react';
import { api } from './api.js';

export function LogoLibrary({ shipmentId, busy, onSelect }) {
  const [logos, setLogos] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api('/api/logos').then(rows => { if (!cancelled) setLogos(rows); }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [shipmentId]);
  return <div className="logo-library"><h4>Kies een bewaard logo</h4><p className="import-explanation">Je ziet alleen logo’s van shipments waartoe je toegang hebt. Nieuwe uploads worden automatisch bewaard voor volgende shipments.</p>{loading && <p>Logo’s laden…</p>}{error && <p className="form-error" role="alert">{error}</p>}{!loading && !error && !logos.length && <p className="import-explanation">Nog geen bewaarde logo’s. Ga terug naar Shipmentinstellingen om je eerste logo te uploaden.</p>}<div className="logo-library-grid">{logos.map(logo => <button className="secondary" key={logo.id} disabled={busy} onClick={() => onSelect(logo.id)} aria-label={`Logo kiezen: ${logo.name}`}><img src={`/api/logos/${logo.id}`} alt=""/><span>{logo.name}</span></button>)}</div></div>;
}
