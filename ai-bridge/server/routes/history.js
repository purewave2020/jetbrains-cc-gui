import { Router } from 'express';
import { readdir, readFile, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

const router = Router();

const CLAUDE_SESSIONS_DIR = join(homedir(), '.claude', 'projects');
const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');

/** Extract title and message count from a session .jsonl file */
function extractSessionMeta(content) {
  let title = '';
  let messageCount = 0;
  let lastTimestamp = '';
  for (const line of content.trim().split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'ai-title' && entry.aiTitle) {
        title = entry.aiTitle;
      }
      if (entry.type === 'user' || entry.type === 'assistant') {
        messageCount++;
        if (entry.timestamp) lastTimestamp = entry.timestamp;
      }
      // Fallback: use first user message text as title if no ai-title
      if (!title && entry.type === 'user') {
        const text = entry.message?.content?.[0]?.text
          || (typeof entry.message?.content === 'string' ? entry.message.content : '')
          || '';
        if (text) {
          // Strip <ide_*> tags and take first meaningful line
          const cleaned = text.replace(/<ide_\w+>.*?<\/ide_\w+>/gs, '').trim();
          title = cleaned.split('\n')[0].substring(0, 80);
        }
      }
    } catch { /* skip malformed lines */ }
  }
  return { title, messageCount, lastTimestamp };
}

async function listClaudeSessions() {
  if (!existsSync(CLAUDE_SESSIONS_DIR)) return [];
  const sessions = [];
  try {
    const projectDirs = await readdir(CLAUDE_SESSIONS_DIR);
    for (const projectDir of projectDirs) {
      const projectPath = join(CLAUDE_SESSIONS_DIR, projectDir);
      try {
        const files = await readdir(projectPath);
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = join(projectPath, file);
          try {
            const s = await stat(filePath);
            const content = await readFile(filePath, 'utf8');
            const meta = extractSessionMeta(content);
            sessions.push({
              id: file.replace('.jsonl', ''),
              provider: 'claude',
              project: projectDir,
              lastModified: s.mtimeMs,
              size: s.size,
              title: meta.title,
              messageCount: meta.messageCount,
              lastTimestamp: meta.lastTimestamp,
            });
          } catch { /* skip unreadable files */ }
        }
      } catch { /* skip unreadable project dirs */ }
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

// Find the .jsonl file path for a claude session by scanning project directories
async function findClaudeSessionPath(id) {
  if (!existsSync(CLAUDE_SESSIONS_DIR)) return null;
  const projectDirs = await readdir(CLAUDE_SESSIONS_DIR);
  for (const projectDir of projectDirs) {
    const filePath = join(CLAUDE_SESSIONS_DIR, projectDir, `${id}.jsonl`);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

// Get session detail
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { provider } = req.query;
  try {
    if (provider === 'claude') {
      const filePath = await findClaudeSessionPath(id);
      if (!filePath) return res.status(404).json({ error: 'Session not found' });
      const content = await readFile(filePath, 'utf8');
      const messages = content.trim().split('\n').map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      return res.json({ id, provider: 'claude', messages });
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete session
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { provider } = req.query;
  try {
    if (provider === 'claude') {
      const filePath = await findClaudeSessionPath(id);
      if (!filePath) return res.status(404).json({ error: 'Session not found' });
      await unlink(filePath);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;