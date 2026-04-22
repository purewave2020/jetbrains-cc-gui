import { Router } from 'express';
import { readdir, readFile, stat, unlink } from 'fs/promises';
import { join, homedir } from 'path';
import { existsSync } from 'fs';

const router = Router();

const CLAUDE_SESSIONS_DIR = join(homedir(), '.claude', 'projects');
const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');

async function listClaudeSessions() {
  if (!existsSync(CLAUDE_SESSIONS_DIR)) return [];
  const sessions = [];
  try {
    const projectDirs = await readdir(CLAUDE_SESSIONS_DIR);
    for (const projectDir of projectDirs) {
      const sessionsDir = join(CLAUDE_SESSIONS_DIR, projectDir, 'sessions');
      if (!existsSync(sessionsDir)) continue;
      const files = await readdir(sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = join(sessionsDir, file);
        try {
          const s = await stat(filePath);
          sessions.push({
            id: file.replace('.jsonl', ''),
            provider: 'claude',
            project: projectDir,
            lastModified: s.mtimeMs,
            size: s.size,
          });
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* skip unreadable dirs */ }
  return sessions.sort((a, b) => b.lastModified - a.lastModified);
}

async function listCodexSessions() {
  if (!existsSync(CODEX_SESSIONS_DIR)) return [];
  const sessions = [];
  try {
    const dirs = await readdir(CODEX_SESSIONS_DIR);
    for (const dir of dirs) {
      const dirPath = join(CODEX_SESSIONS_DIR, dir);
      try {
        const s = await stat(dirPath);
        if (!s.isDirectory()) continue;
        sessions.push({
          id: dir,
          provider: 'codex',
          lastModified: s.mtimeMs,
        });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return sessions.sort((a, b) => b.lastModified - a.lastModified);
}

// List all history sessions
router.get('/', async (req, res) => {
  const provider = req.query.provider || 'all';
  try {
    let sessions = [];
    if (provider === 'all' || provider === 'claude') {
      sessions = sessions.concat(await listClaudeSessions());
    }
    if (provider === 'all' || provider === 'codex') {
      sessions = sessions.concat(await listCodexSessions());
    }
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get session detail
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { provider } = req.query;
  try {
    if (provider === 'claude') {
      if (!existsSync(CLAUDE_SESSIONS_DIR)) return res.status(404).json({ error: 'Not found' });
      const projectDirs = await readdir(CLAUDE_SESSIONS_DIR);
      for (const projectDir of projectDirs) {
        const filePath = join(CLAUDE_SESSIONS_DIR, projectDir, 'sessions', `${id}.jsonl`);
        if (existsSync(filePath)) {
          const content = await readFile(filePath, 'utf8');
          const messages = content.trim().split('\n').map(line => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
          return res.json({ id, provider: 'claude', messages });
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete session
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { provider, project } = req.query;
  try {
    if (provider === 'claude' && project) {
      const filePath = join(CLAUDE_SESSIONS_DIR, project, 'sessions', `${id}.jsonl`);
      if (existsSync(filePath)) {
        await unlink(filePath);
        return res.json({ success: true });
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
