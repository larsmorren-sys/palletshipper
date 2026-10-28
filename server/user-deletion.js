const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function installUserDeletion(app, db, editor) {
  app.delete('/api/users/:id', (req, res) => {
    if (req.user.role !== 'admin') throw fail('Only administrators can delete users.', 403);
    let cleanup;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Recheck permissions and the last-admin guard under the same write lock as deletion.
      const actor = db.prepare('SELECT role,active FROM users WHERE id=?').get(req.user.id);
      if (!actor?.active || actor.role !== 'admin') throw fail('Only active administrators can delete users.', 403);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
      if (!user) throw fail('User not found.', 404);
      if (user.role === 'admin' && user.active && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1").get().n <= 1) throw fail('At least one active administrator must remain.');
      if (user.id === req.user.id) throw fail('You cannot delete your own account. Ask another administrator.');
      if (typeof req.body?.confirmEmail !== 'string' || req.body.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) throw fail('Type the user’s email address to confirm deletion.');
      cleanup = editor.prepareUserDeletion(user.id);
      for (const table of ['sessions', 'shipment_access', 'column_preferences']) db.prepare(`DELETE FROM ${table} WHERE userId=?`).run(user.id);
      db.prepare('UPDATE shipments SET ownerId=? WHERE ownerId=?').run(req.user.id, user.id);
      // The foreign key anonymizes check attribution while preserving arrivals and timestamps.
      db.prepare('DELETE FROM users WHERE id=?').run(user.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    cleanup();
    res.json({ ok: true, message: 'User deleted. Shipment contents and tracking were preserved. Owned shipments now belong to you.' });
  });
}
