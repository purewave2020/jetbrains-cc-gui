import { Router } from 'express';
import { loadConfig, saveConfig, updateConfig } from '../config-store.js';

const router = Router();

function getMcpServers(config, scope) {
  if (scope === 'project') {
    return config.mcp?.project?.servers || {};
  }
  return config.mcp?.global?.servers || {};
}

function ensureMcpScope(config, scope) {
  if (scope === 'project') {
    config.mcp = config.mcp || {};
    config.mcp.project = config.mcp.project || {};
    config.mcp.project.servers = config.mcp.project.servers || {};
    return config.mcp.project.servers;
  }
  config.mcp = config.mcp || {};
  config.mcp.global = config.mcp.global || {};
  config.mcp.global.servers = config.mcp.global.servers || {};
  return config.mcp.global.servers;
}

// Get MCP servers for a scope
router.get('/:scope/servers', (req, res) => {
  const config = loadConfig();
  const servers = getMcpServers(config, req.params.scope);
  res.json({ servers });
});

// Add/update MCP server
router.put('/:scope/servers/:id', (req, res) => {
  const config = loadConfig();
  const servers = ensureMcpScope(config, req.params.scope);
  servers[req.params.id] = req.body;
  saveConfig(config);
  res.json({ servers });
});

// Delete MCP server
router.delete('/:scope/servers/:id', (req, res) => {
  const config = loadConfig();
  const servers = ensureMcpScope(config, req.params.scope);
  delete servers[req.params.id];
  saveConfig(config);
  res.json({ servers });
});

// Toggle MCP server enabled/disabled
router.put('/:scope/servers/:id/toggle', (req, res) => {
  const config = loadConfig();
  const servers = ensureMcpScope(config, req.params.scope);
  if (servers[req.params.id]) {
    servers[req.params.id].enabled = req.body.enabled;
    saveConfig(config);
  }
  res.json({ servers });
});

// Get MCP server status (stub — real status requires running servers)
router.get('/:scope/status', (_req, res) => {
  res.json({ statuses: {} });
});

// Get MCP server tools (stub — real tools require running servers)
router.get('/:scope/tools', (_req, res) => {
  res.json({ tools: [] });
});

// Legacy routes
router.get('/status', async (_req, res) => {
  res.json({ servers: [] });
});

router.get('/tools', async (_req, res) => {
  res.json({ tools: [] });
});

export default router;
