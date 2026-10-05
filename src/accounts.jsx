import React, { useEffect, useState } from 'react';
import { api } from './api.js';

export function AuthGate({ children }) {
  const [session, setSession] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function refresh() {
    try { setSession(await api('/api/auth/session')); setError(''); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => {
    refresh();
    const expired = () => { setSession({ user: null, setupRequired: false }); setError('Je sessie is verlopen. Log opnieuw in.'); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  if (session?.user) return children({ user: session.user, refresh, logout: async () => { await api('/api/auth/logout', { method: 'POST' }); setSession({ user: null, setupRequired: false }); } });
  const setup = session?.setupRequired;
  return <div className="auth-page"><section className="auth-card"><a href="/" className="auth-brand">Palletshipper<span>.</span></a><p className="eyebrow">{setup ? 'EERSTE KEER INSTELLEN' : 'JOUW WERKRUIMTE'}</p><h1>{loading ? 'Even laden…' : setup ? 'Maak je beheerdersaccount.' : 'Welkom terug.'}</h1><p className="auth-intro">{setup ? 'Met dit account beheer je gebruikers en de toegang tot shipments.' : 'Log in om je shipments en materiaal te beheren.'}</p>{!loading && <form onSubmit={async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); setError(''); try { setSession(await api(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body })); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>
    {setup && <><label>Installatiecode<input name="setupToken" type="password" autoComplete="off" required/></label><p className="form-hint">Gebruik de code uit data/setup-token.txt of de SETUP_TOKEN-instelling op Railway.</p><label>Naam<input name="name" autoComplete="name" required maxLength="200"/></label></>}
    <label>E-mailadres<input name="email" type="email" autoComplete="username" required maxLength="254"/></label><label>Wachtwoord<input name="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 12 : undefined} maxLength="256" required/></label>{setup && <p className="form-hint">Gebruik minstens 12 tekens.</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary" disabled={busy || !session}>{busy ? 'Even wachten…' : setup ? 'Beheerdersaccount aanmaken' : 'Inloggen'}</button>{!session && <button type="button" className="secondary" onClick={refresh}>Opnieuw proberen</button>}
    </form>}</section></div>;
}

export function UserManager({ onAccountUpdated }) {
  const [users, setUsers] = useState([]), [editing, setEditing] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function load() { setUsers(await api('/api/users')); }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  return <div className="user-management"><p className="import-explanation">Beheerders zien alle shipments. Gewone gebruikers zien hun eigen en toegewezen shipments.</p><div className="user-list">{users.map(user => <div className="user-row" key={user.id}><div><strong>{user.name}</strong><span>{user.email}</span></div><span className="user-role">{user.role === 'admin' ? 'Beheerder' : 'Gebruiker'}{!user.active && ' · Inactief'}</span><button className="secondary" disabled={busy} onClick={() => { setEditing(user); setError(''); }}>Bewerken</button></div>)}</div><div className="user-form-heading"><h3>{editing ? `Account van ${editing.name}` : 'Gebruiker toevoegen'}</h3>{editing && <button className="secondary" onClick={() => { setEditing(null); setError(''); }}>Nieuw account</button>}</div><form key={editing?.id || 'new'} onSubmit={async e => {
    e.preventDefault(); const form = e.currentTarget, body = Object.fromEntries(new FormData(form));
    if (editing) { body.active = body.active === 'on'; if (!body.password) delete body.password; }
    setBusy(true); setError('');
    try { await api(editing ? `/api/users/${editing.id}` : '/api/users', { method: editing ? 'PATCH' : 'POST', body }); setEditing(null); form.reset(); await onAccountUpdated(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }}><div className="form-grid"><label>Naam<input name="name" required maxLength="200" defaultValue={editing?.name || ''}/></label><label>E-mailadres<input name="email" type="email" required maxLength="254" defaultValue={editing?.email || ''}/></label></div><div className="form-grid"><label>Rol<select name="role" defaultValue={editing?.role || 'member'}><option value="member">Gebruiker</option><option value="admin">Beheerder</option></select></label><label>{editing ? 'Nieuw wachtwoord (optioneel)' : 'Wachtwoord'}<input name="password" type="password" autoComplete="new-password" minLength="12" maxLength="256" required={!editing}/></label></div>{editing && <label className="check-label"><input name="active" type="checkbox" defaultChecked={editing.active}/> Account actief</label>}<p className="form-hint">Een nieuw wachtwoord of gedeactiveerd account beëindigt bestaande sessies.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button className="primary" disabled={busy}>{busy ? 'Opslaan…' : editing ? 'Wijzigingen opslaan' : 'Gebruiker aanmaken'}</button></div></form></div>;
}

export function ShipmentAccess({ shipment, close }) {
  const [access, setAccess] = useState(null), [selected, setSelected] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api(`/api/shipments/${shipment.id}/access`).then(result => { setAccess(result); setSelected(result.userIds.filter(id => result.users.some(u => u.id === id && u.active))); }).catch(e => setError(e.message)); }, [shipment.id]);
  return <div><p className="import-explanation">Selecteer wie deze shipment mag zien en bijwerken. Beheerders en de maker hebben altijd toegang.</p>{access?.owner && <div className="access-owner">Maker: <strong>{access.owner.name}</strong></div>}{!access && !error && <p>Gebruikers laden…</p>}<div className="access-list">{access?.users.filter(u => u.active).map(user => {
    const fixed = user.role === 'admin' || user.id === access.owner?.id;
    return <label className="access-user" key={user.id}><input type="checkbox" checked={fixed || selected.includes(user.id)} disabled={fixed || busy} onChange={e => setSelected(current => e.target.checked ? [...current, user.id] : current.filter(id => id !== user.id))}/><span><strong>{user.name}</strong><small>{user.email}</small></span><em>{fixed ? 'Altijd toegang' : ''}</em></label>;
  })}</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button className="secondary" disabled={busy} onClick={close}>Annuleren</button><button className="primary" disabled={busy || !access} onClick={async () => { setBusy(true); setError(''); try { await api(`/api/shipments/${shipment.id}/access`, { method: 'PUT', body: { userIds: selected } }); close(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>{busy ? 'Opslaan…' : 'Toegang opslaan'}</button></div></div>;
}

export function PasswordForm({ onAccountUpdated, close }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <form onSubmit={async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); setError(''); try { await api('/api/auth/password', { method: 'POST', body }); await onAccountUpdated(); close(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><label>Huidig wachtwoord<input name="currentPassword" type="password" autoComplete="current-password" required maxLength="256"/></label><label>Nieuw wachtwoord<input name="password" type="password" autoComplete="new-password" minLength="12" maxLength="256" required/></label><p className="form-hint">Minstens 12 tekens. Andere sessies worden uitgelogd.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button className="primary" disabled={busy}>{busy ? 'Opslaan…' : 'Wachtwoord wijzigen'}</button></div></form>;
}
