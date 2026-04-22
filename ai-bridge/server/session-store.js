import { randomUUID } from 'crypto';

const sessions = new Map();

export function createSession(provider = 'claude') {
  const id = randomUUID();
  const session = {
    id,
    provider,
    model: null,
    permissionMode: 'default',
    reasoningEffort: 'medium',
    createdAt: Date.now(),
    channelId: null,
    busy: false,
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function updateSession(id, updates) {
  const session = sessions.get(id);
  if (!session) return null;
  Object.assign(session, updates);
  return session;
}

export function deleteSession(id) {
  return sessions.delete(id);
}

export function listSessions() {
  return Array.from(sessions.values());
}

export function getActiveSession() {
  const all = listSessions();
  return all.length > 0 ? all[all.length - 1] : null;
}
