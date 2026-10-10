import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { RankingSymbol } from './ranking-symbol.jsx';

function position(board, userId) {
  const me = board.rows.find(row => row.id === userId);
  return me?.checks > 0 ? 1 + board.rows.filter(row => row.checks > me.checks).length : null;
}

export function RankingStatus({ user, onOpen }) {
  const [standing, setStanding] = useState(null), [notice, setNotice] = useState(null);
  const previous = useRef(null);
  useEffect(() => {
    let cancelled = false, inFlight = false, pending = false;
    previous.current = null; setStanding(null); setNotice(null);
    async function update() {
      if (document.visibilityState === 'hidden' || cancelled) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      try {
        const board = await api('/api/challenges');
        if (cancelled) return;
        const rank = position(board, user.id);
        const scope = `${user.id}:${board.year}:${board.shared}`;
        if (!board.participating) { previous.current = null; setStanding(null); setNotice(null); return; }
        if (previous.current?.scope === scope && previous.current.rank !== rank) setNotice({ from: previous.current.rank, to: rank });
        previous.current = { rank, scope }; setStanding({ rank, year: board.year });
      } catch { /* Keep the last known position during a temporary connection failure. */ }
      finally { inFlight = false; if (pending && !cancelled) { pending = false; update(); } }
    }
    update();
    const interval = window.setInterval(update, 5000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('challenge-scores-changed', update);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); window.removeEventListener('challenge-scores-changed', update); };
  }, [user.id, user.challengeParticipating]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 15000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!standing) return null;
  const label = `Shipment Finisher ${standing.year} · ${standing.rank ? `Rank ${standing.rank}` : 'Not ranked yet'}`;
  return <><button className="account-ranking" type="button" title={label} aria-label={label} onClick={onOpen}><span aria-hidden="true"><RankingSymbol rank={standing.rank}/></span>{standing.rank > 3 && <small>#{standing.rank}</small>}</button>{notice && <aside className="ranking-toast" role="status" aria-live="polite" aria-atomic="true"><span className="ranking-toast-symbol" aria-hidden="true"><RankingSymbol rank={notice.to}/></span><div><strong>{notice.to === null ? 'You are currently unranked' : notice.from === null ? `You are now ranked #${notice.to}!` : notice.to < notice.from ? `You moved up to #${notice.to}!` : `Your ranking changed to #${notice.to}`}</strong><p>Shipment Finisher · {standing.year}{notice.from !== null && notice.to !== null ? ` · #${notice.from} → #${notice.to}` : ''}</p></div><button type="button" aria-label="Dismiss ranking notification" onClick={() => setNotice(null)}>×</button></aside>}</>;
}
