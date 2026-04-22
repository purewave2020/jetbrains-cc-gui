import { Router } from 'express';
import { createSession, getSession, deleteSession, listSessions } from '../session-store.js';

const router = Router();

// List sessions
router.get('/', (_req, res) => {
  res.json(listSessions());
});

// Create session
router.post('/', (req, res) => {
  const { provider } = req.body || {};
  const session = createSession(provider || 'claude');
  res.status(201).json(session);
});

// Get session
router.get('/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// Delete session
router.delete('/:id', (req, res) => {
  const deleted = deleteSession(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Session not found' });
  res.json({ success: true });
});

export default router;
