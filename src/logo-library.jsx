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
  return <div className="logo-library"><h4>Choose a saved logo</h4><p className="import-explanation">You can only see logos from shipments you have access to. New uploads are saved for future shipments.</p>{loading && <p>Loading logos…</p>}{error && <p className="form-error" role="alert">{error}</p>}{!loading && !error && !logos.length && <p className="import-explanation">No saved logos yet. Return to Shipment settings to upload your first logo.</p>}<div className="logo-library-grid">{logos.map(logo => <button className="secondary" key={logo.id} disabled={busy} onClick={() => onSelect(logo.id)} aria-label={`Choose logo: ${logo.name}`}><img src={`/api/logos/${logo.id}`} alt=""/><span>{logo.name}</span></button>)}</div></div>;
}
