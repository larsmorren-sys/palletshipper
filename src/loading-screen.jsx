import React from 'react';

export function LoadingScreen({ error, onRetry }) {
  return <div className="startup-screen" role={error?'alert':'status'} aria-live="polite"><div className="startup-brand">Palletshipper<span>.</span></div>{!error&&<span className="startup-spinner" aria-hidden="true"/>}<p>{error||'Loading your workspace…'}</p>{error&&onRetry&&<button className="secondary" onClick={onRetry}>Try again</button>}</div>;
}
