import wsClient from './ws-client';

const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? '' : `http://${window.location.hostname}:3001`);

/** Cached working directory from backend settings (fetched once at startup, updated on settings change) */
let cachedWorkingDir = '';
/** Cached streaming enabled setting from backend (fetched once at startup, updated on settings change) */
let cachedStreamingEnabled = true;

/**
 * Convert a daemon [MESSAGE] object (raw SDK format) to a ClaudeMessage
 * that the frontend expects.
 *
 * Daemon format: {type:"assistant", message:{content:[{type:"text",text:"Hi!"}]}}
 * ClaudeMessage: {type:"assistant", content:"Hi!", raw:{...}, timestamp:"..."}
 */
function convertDaemonMessage(msg: any): any | null {
  if (!msg || !msg.type) return null;

  // Filter system messages (init, compact_boundary, etc.) and result messages
  // — they should not be displayed as chat bubbles
  if (msg.type === 'system' || msg.type === 'result') return null;

  // Extract display text from the nested message.content blocks
  const contentBlocks = msg.message?.content ?? msg.content;
  let content = '';
  if (typeof contentBlocks === 'string') {
    content = contentBlocks;
  } else if (Array.isArray(contentBlocks)) {
    content = contentBlocks
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text || '')
      .join('\n');
  }

  return {
    type: msg.type,
    content,
    raw: msg,  // Preserve full SDK message for tool_use/tool_result extraction
    timestamp: msg.timestamp || new Date().toISOString(),
    // Carry over fields the frontend may need
    ...(msg.session_id ? { session_id: msg.session_id } : {}),
    ...(msg.subtype ? { subtype: msg.subtype } : {}),
    ...(msg.is_error ? { is_error: msg.is_error } : {}),
    ...(msg.result ? { result: msg.result } : {}),
  };
}

/** Build claude provider list with special pseudo-providers and isActive flags */
function buildClaudeProviders(data: any) {
  const currentId = data.claude?.current || '';
  const regularProviders = Object.values(data.claude?.providers || {}).map((p: any) => ({
    ...p,
    isActive: p.id === currentId,
  }));
  const specialProviders = [
    { id: '__local_settings_json__', name: 'Local Settings', isLocalProvider: true, isActive: currentId === '__local_settings_json__' },
    { id: '__cli_login__', name: 'CLI Login', isCliLoginProvider: true, isActive: currentId === '__cli_login__' },
  ];
  return [...specialProviders, ...regularProviders];
}

/** Build codex provider list with special pseudo-provider and isActive flags */
function buildCodexProviders(data: any) {
  const currentId = data.codex?.current || '';
  const regularProviders = Object.values(data.codex?.providers || {}).map((p: any) => ({
    ...p,
    isActive: p.id === currentId,
  }));
  const specialProviders = [
    { id: '__codex_cli_login__', name: 'Codex CLI Login', isCliLoginProvider: true, isActive: currentId === '__codex_cli_login__' },
  ];
  return [...specialProviders, ...regularProviders];
}

/** Fetch providers from backend and call window callback with isActive flags */
async function refreshProviders(type: 'claude' | 'codex') {
  const res = await fetch(`${API_BASE}/api/settings/providers`);
  const data = await res.json();
  if (type === 'claude') {
    (window as any).updateProviders?.(JSON.stringify(buildClaudeProviders(data)));
  } else {
    (window as any).updateCodexProviders?.(JSON.stringify(buildCodexProviders(data)));
  }
}

/** Detect if running in web mode (not JCEF) */
export const isWebMode = (): boolean => {
  return !(window as any).sendToJava;
};

/** HTTP bridge: send event to server via REST or WebSocket */
export const sendBridgeEventHttp = async (event: string, content: string = ''): Promise<boolean> => {
  console.log('[bridge-http] sendBridgeEventHttp:', event, content ? content.substring(0, 100) : '');
  try {
    switch (event) {
      // --- WebSocket events (real-time) ---
      case 'send_message':
      case 'send_message_with_attachments':
      case 'interrupt_session':
      case 'permission_decision':
      case 'ask_user_question_response':
      case 'plan_approval_response':
      case 'heartbeat': {
        let parsed: Record<string, any> = {};
        try { parsed = content ? JSON.parse(content) : {}; } catch { parsed = { text: content }; }
        const wsType = event
          .replace('send_message_with_attachments', 'send_message')
          .replace('interrupt_session', 'interrupt');
        // Inject cwd from cached working directory and streaming from cached setting
        if ((wsType === 'send_message') && cachedWorkingDir && !parsed.cwd) {
          parsed = { ...parsed, cwd: cachedWorkingDir };
        }
        if ((wsType === 'send_message') && !('streaming' in parsed)) {
          parsed = { ...parsed, streaming: cachedStreamingEnabled };
        }
        wsClient.send({ type: wsType, ...parsed });
        return true;
      }

      // --- Session management ---
      case 'create_new_session': {
        const res = await fetch(`${API_BASE}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        const session = await res.json();
        (window as any).setSessionId?.(session.id);
        return true;
      }

      case 'load_session': {
        return true;
      }

      // --- Settings via REST ---
      case 'get_active_provider': {
        const res = await fetch(`${API_BASE}/api/settings/active-provider`);
        const data = await res.json();
        const provider = data.provider || { id: 'anthropic', name: 'Anthropic', type: 'claude' };
        (window as any).updateActiveProvider?.(JSON.stringify({ ...provider, isActive: true }));
        return true;
      }

      case 'get_mode': {
        const res = await fetch(`${API_BASE}/api/settings/mode`);
        const data = await res.json();
        (window as any).onModeReceived?.(data.mode);
        return true;
      }

      case 'set_mode': {
        await fetch(`${API_BASE}/api/settings/mode`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: content }) });
        return true;
      }

      case 'set_model': {
        await fetch(`${API_BASE}/api/settings/model`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: content }) });
        return true;
      }

      case 'set_provider': {
        // set_provider's content is the SDK type ('claude' or 'codex'), NOT a provider ID.
        // Sending the SDK type as providerId to switch-provider would overwrite
        // the real provider ID with an invalid value (e.g. current="claude"
        // instead of current="__local_settings_json__").
        // In web mode, the active provider is already stored in settings.json
        // under claude.current / codex.current, so just sync the UI.
        const spRes = await fetch(`${API_BASE}/api/settings/providers`);
        const spData = await spRes.json();
        const spProviders = buildClaudeProviders(spData);
        (window as any).updateProviders?.(JSON.stringify(spProviders));
        return true;
      }

      case 'get_thinking_enabled': {
        const res = await fetch(`${API_BASE}/api/settings/streaming`);
        const data = await res.json();
        (window as any).updateThinkingEnabled?.(JSON.stringify({ enabled: data.enabled }));
        return true;
      }

      case 'get_streaming_enabled': {
        const res = await fetch(`${API_BASE}/api/settings/streaming`);
        const data = await res.json();
        (window as any).updateStreamingEnabled?.(JSON.stringify({ streamingEnabled: data.enabled }));
        return true;
      }

      case 'get_send_shortcut': {
        const res = await fetch(`${API_BASE}/api/settings/send-shortcut`);
        const data = await res.json();
        (window as any).updateSendShortcut?.(JSON.stringify({ sendShortcut: data.shortcut || 'enter' }));
        return true;
      }

      case 'get_auto_open_file_enabled': {
        const res = await fetch(`${API_BASE}/api/settings/auto-open-file`);
        const data = await res.json();
        (window as any).updateAutoOpenFileEnabled?.(JSON.stringify({ autoOpenFileEnabled: data.enabled ?? true }));
        return true;
      }

      case 'set_thinking_enabled': {
        const { enabled } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/streaming`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
        return true;
      }

      case 'set_streaming_enabled': {
        const { enabled } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/streaming`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
        return true;
      }

      case 'set_send_shortcut': {
        const { shortcut } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/send-shortcut`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shortcut }) });
        return true;
      }

      case 'set_auto_open_file_enabled': {
        const { enabled } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/auto-open-file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
        return true;
      }

      // --- History ---
      case 'load_history_data': {
        const res = await fetch(`${API_BASE}/api/history?provider=${encodeURIComponent(content)}`);
        const data = await res.json();
        (window as any).setHistoryData?.(data);
        return true;
      }

      case 'delete_session': {
        await fetch(`${API_BASE}/api/history/${encodeURIComponent(content)}?provider=claude`, { method: 'DELETE' });
        return true;
      }

      case 'export_session':
      case 'toggle_favorite':
      case 'update_title':
      case 'deep_search_history': {
        return true;
      }

      // --- Agent/Prompt/Skill/MCP ---
      case 'get_selected_agent': {
        const res = await fetch(`${API_BASE}/api/settings/selected-agent`);
        const data = await res.json();
        (window as any).updateSelectedAgent?.(JSON.stringify({ agentId: data.agentId || '' }));
        return true;
      }

      case 'set_selected_agent': {
        const agentData = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/selected-agent`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: agentData.agentId || agentData.id || '' }) });
        return true;
      }

      case 'set_reasoning_effort': {
        await fetch(`${API_BASE}/api/settings/reasoning-effort`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effort: content }) });
        return true;
      }

      // --- Tab/window ---
      case 'create_new_tab':
      case 'frontend_ready':
      case 'refresh_slash_commands':
      case 'tab_loading_changed':
      case 'tab_status_changed':
      case 'write_clipboard':
        return true;

      case 'get_dependency_status': {
        const res = await fetch(`${API_BASE}/api/dependencies/status`);
        const data = await res.json();
        (window as any).updateDependencyStatus?.(JSON.stringify(data));
        return true;
      }

      case 'get_dependency_versions': {
        const res = await fetch(`${API_BASE}/api/dependencies/versions`);
        const data = await res.json();
        (window as any).dependencyVersionsLoaded?.(JSON.stringify(data));
        return true;
      }

      case 'check_dependency_updates': {
        const res = await fetch(`${API_BASE}/api/dependencies/check-updates`);
        const data = await res.json();
        (window as any).dependencyUpdateAvailable?.(JSON.stringify(data));
        return true;
      }

      case 'check_node_environment': {
        const res = await fetch(`${API_BASE}/api/dependencies/node-environment`);
        const data = await res.json();
        (window as any).nodeEnvironmentStatus?.(JSON.stringify(data));
        return true;
      }

      case 'install_dependency': {
        const parsed = JSON.parse(content);
        const installId = parsed.id || parsed.sdkId;
        const installVersion = parsed.version;
        (window as any).dependencyInstallProgress?.(JSON.stringify({ sdkId: installId, log: 'Starting installation...' }));
        try {
          const res = await fetch(`${API_BASE}/api/dependencies/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdkId: installId, version: installVersion }),
          });
          const data = await res.json();
          if (data.output) {
            data.output.split('\n').filter(Boolean).forEach((line: string) => {
              (window as any).dependencyInstallProgress?.(JSON.stringify({ sdkId: installId, log: line }));
            });
          }
          (window as any).dependencyInstallResult?.(JSON.stringify({
            success: data.success,
            sdkId: installId,
            installedVersion: data.installedVersion,
            error: data.error,
          }));
        } catch (e: any) {
          (window as any).dependencyInstallResult?.(JSON.stringify({ success: false, sdkId: installId, error: e.message }));
        }
        return true;
      }

      case 'uninstall_dependency': {
        const parsed2 = JSON.parse(content);
        const uninstallId = parsed2.id || parsed2.sdkId;
        try {
          const res = await fetch(`${API_BASE}/api/dependencies/uninstall`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdkId: uninstallId }),
          });
          const data = await res.json();
          (window as any).dependencyUninstallResult?.(JSON.stringify({
            success: data.success,
            sdkId: uninstallId,
            error: data.error,
          }));
        } catch (e: any) {
          (window as any).dependencyUninstallResult?.(JSON.stringify({ success: false, sdkId: uninstallId, error: e.message }));
        }
        return true;
      }

      case 'update_dependency': {
        const parsed3 = JSON.parse(content);
        const updateId = parsed3.id || parsed3.sdkId;
        const updateVersion = parsed3.version;
        (window as any).dependencyInstallProgress?.(JSON.stringify({ sdkId: updateId, log: 'Starting update...' }));
        try {
          const res = await fetch(`${API_BASE}/api/dependencies/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdkId: updateId, version: updateVersion }),
          });
          const data = await res.json();
          if (data.output) {
            data.output.split('\n').filter(Boolean).forEach((line: string) => {
              (window as any).dependencyInstallProgress?.(JSON.stringify({ sdkId: updateId, log: line }));
            });
          }
          (window as any).dependencyInstallResult?.(JSON.stringify({
            success: data.success,
            sdkId: updateId,
            installedVersion: data.installedVersion,
            error: data.error,
          }));
        } catch (e: any) {
          (window as any).dependencyInstallResult?.(JSON.stringify({ success: false, sdkId: updateId, error: e.message }));
        }
        return true;
      }

      // --- Settings queries (from backend) ---
      case 'get_node_path': {
        const res = await fetch(`${API_BASE}/api/settings/node-path`);
        const data = await res.json();
        (window as any).updateNodePath?.(JSON.stringify(data));
        return true;
      }

      case 'get_working_directory': {
        const res = await fetch(`${API_BASE}/api/settings/working-directory`);
        const data = await res.json();
        (window as any).updateWorkingDirectory?.(JSON.stringify(data));
        return true;
      }

      case 'get_editor_font_config': {
        (window as any).onEditorFontConfigReceived?.(JSON.stringify({ fontFamily: 'monospace', fontSize: 14, lineSpacing: 1.5 }));
        return true;
      }

      case 'get_codex_sandbox_mode': {
        const res = await fetch(`${API_BASE}/api/settings/codex-sandbox-mode`);
        const data = await res.json();
        (window as any).updateCodexSandboxMode?.(JSON.stringify(data));
        return true;
      }

      case 'get_commit_prompt': {
        const res = await fetch(`${API_BASE}/api/settings/commit-generation`);
        const data = await res.json();
        (window as any).updateCommitPrompt?.(JSON.stringify({ commitPrompt: data.prompt || '' }));
        return true;
      }

      case 'get_sound_notification_config': {
        const res = await fetch(`${API_BASE}/api/settings/sound-notification`);
        const data = await res.json();
        (window as any).updateSoundNotificationConfig?.(JSON.stringify(data));
        return true;
      }

      case 'get_commit_generation_enabled': {
        const res = await fetch(`${API_BASE}/api/settings/commit-generation`);
        const data = await res.json();
        (window as any).updateCommitGenerationEnabled?.(JSON.stringify({ commitGenerationEnabled: data.enabled ?? true }));
        return true;
      }

      case 'get_status_bar_widget_enabled': {
        const res = await fetch(`${API_BASE}/api/settings/status-bar-widget`);
        const data = await res.json();
        (window as any).updateStatusBarWidgetEnabled?.(JSON.stringify({ statusBarWidgetEnabled: data.enabled ?? true }));
        return true;
      }

      case 'get_prompts': {
        const scope = content ? JSON.parse(content).scope : 'global';
        const res = await fetch(`${API_BASE}/api/prompts`);
        const data = await res.json();
        const prompts = data.prompts || [];
        if (scope === 'global' || scope === undefined) {
          (window as any).updateGlobalPrompts?.(JSON.stringify(data.globalPrompts || prompts));
        }
        if (scope === 'project') {
          (window as any).updateProjectPrompts?.(JSON.stringify(data.projectPrompts || []));
        }
        return true;
      }

      case 'get_node_environment_status':
      case 'get_codex_config': {
        return true;
      }

      // --- Provider/Agent queries ---
      case 'get_providers': {
        const res = await fetch(`${API_BASE}/api/settings/providers`);
        const data = await res.json();
        const providers = buildClaudeProviders(data);
        console.log('[bridge-http] get_providers: currentId=', data.claude?.current, 'providers=', providers.map(p => ({ id: p.id, isActive: p.isActive })));
        (window as any).updateProviders?.(JSON.stringify(providers));
        return true;
      }

      case 'get_agents': {
        const res = await fetch(`${API_BASE}/api/agents`);
        const data = await res.json();
        (window as any).updateAgents?.(JSON.stringify(data.agents || []));
        return true;
      }

      case 'get_codex_providers': {
        const res = await fetch(`${API_BASE}/api/settings/providers`);
        const data = await res.json();
        (window as any).updateCodexProviders?.(JSON.stringify(buildCodexProviders(data)));
        return true;
      }

      // --- Settings set operations (persist to backend) ---
      case 'set_node_path': {
        const { path } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/node-path`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
        (window as any).updateNodePath?.(JSON.stringify({ path, version: null }));
        return true;
      }

      case 'set_working_directory': {
        const { customWorkingDir } = JSON.parse(content);
        cachedWorkingDir = customWorkingDir || '';
        await fetch(`${API_BASE}/api/settings/working-directory`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customWorkingDir }) });
        (window as any).updateWorkingDirectory?.(JSON.stringify({ customWorkingDir }));
        return true;
      }

      case 'set_codex_sandbox_mode': {
        const { sandboxMode } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/codex-sandbox-mode`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sandboxMode }) });
        (window as any).updateCodexSandboxMode?.(JSON.stringify({ sandboxMode }));
        return true;
      }

      case 'set_sound_notification_enabled': {
        const { enabled } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/sound-notification`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
        return true;
      }

      case 'set_sound_only_when_unfocused': {
        const { onlyWhenUnfocused } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/sound-notification`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onlyWhenUnfocused }) });
        return true;
      }

      case 'set_selected_sound': {
        const { selectedSound } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/sound-notification`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selectedSound }) });
        return true;
      }

      case 'set_custom_sound_path': {
        const { customSoundPath } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/sound-notification`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customSoundPath }) });
        return true;
      }

      case 'test_sound':
      case 'browse_sound_file': {
        // No-op in web mode (no native file picker or sound playback)
        return true;
      }

      case 'set_commit_generation_enabled': {
        const { commitGenerationEnabled } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/commit-generation`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: commitGenerationEnabled }) });
        (window as any).updateCommitGenerationEnabled?.(JSON.stringify({ commitGenerationEnabled }));
        return true;
      }

      case 'set_status_bar_widget_enabled': {
        const { statusBarWidgetEnabled } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/status-bar-widget`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: statusBarWidgetEnabled }) });
        (window as any).updateStatusBarWidgetEnabled?.(JSON.stringify({ statusBarWidgetEnabled }));
        return true;
      }

      case 'set_commit_prompt': {
        const { commitPrompt } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/commit-generation`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: commitPrompt }) });
        (window as any).updateCommitPrompt?.(JSON.stringify({ commitPrompt, saved: true }));
        return true;
      }

      // --- Agent management ---
      case 'add_agent': {
        const agent = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/agents`);
        const data = await res.json();
        data.agents = data.agents || [];
        data.agents.push(agent);
        await fetch(`${API_BASE}/api/agents`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        (window as any).updateAgents?.(JSON.stringify(data.agents));
        (window as any).agentOperationResult?.(JSON.stringify({ success: true, operation: 'add' }));
        return true;
      }

      case 'update_agent': {
        const updateData = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/agents`);
        const data = await res.json();
        data.agents = (data.agents || []).map((a: any) => a.id === updateData.id ? { ...a, ...updateData.updates } : a);
        await fetch(`${API_BASE}/api/agents`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        (window as any).updateAgents?.(JSON.stringify(data.agents));
        (window as any).agentOperationResult?.(JSON.stringify({ success: true, operation: 'update' }));
        return true;
      }

      case 'delete_agent': {
        const delData = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/agents`);
        const data = await res.json();
        data.agents = (data.agents || []).filter((a: any) => a.id !== delData.id);
        await fetch(`${API_BASE}/api/agents`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        (window as any).updateAgents?.(JSON.stringify(data.agents));
        (window as any).agentOperationResult?.(JSON.stringify({ success: true, operation: 'delete' }));
        return true;
      }

      case 'export_agents': {
        const res = await fetch(`${API_BASE}/api/agents`);
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data.agents || [], null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'agents.json'; a.click();
        URL.revokeObjectURL(url);
        return true;
      }

      case 'import_agents_file': {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const text = await file.text();
            const imported = JSON.parse(text);
            const agents = Array.isArray(imported) ? imported : imported.agents || [];
            (window as any).agentImportPreviewResult?.(JSON.stringify({
              items: agents.map((a: any) => ({ data: a, exists: false })),
              summary: { total: agents.length, newCount: agents.length, existingCount: 0 },
            }));
          } catch (e: any) {
            (window as any).agentImportPreviewResult?.(JSON.stringify({ items: [], summary: { total: 0, newCount: 0, existingCount: 0 }, error: e.message }));
          }
        };
        input.click();
        return true;
      }

      case 'save_imported_agents': {
        const importData = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/agents`);
        const data = await res.json();
        data.agents = data.agents || [];
        let imported = 0, updated = 0, skipped = 0;
        for (const agent of (importData.agents || [])) {
          const idx = data.agents.findIndex((a: any) => a.id === agent.id);
          if (idx >= 0) {
            if (importData.strategy === 'overwrite') { data.agents[idx] = agent; updated++; }
            else { skipped++; }
          } else {
            data.agents.push(agent); imported++;
          }
        }
        await fetch(`${API_BASE}/api/agents`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        (window as any).agentImportResult?.(JSON.stringify({ success: true, imported, updated, skipped }));
        (window as any).updateAgents?.(JSON.stringify(data.agents));
        return true;
      }

      // --- Prompt management ---
      case 'add_prompt': {
        const { scope, prompt } = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/prompts`);
        const data = await res.json();
        const key = scope === 'project' ? 'projectPrompts' : 'globalPrompts';
        data[key] = data[key] || [];
        data[key].push(prompt);
        await fetch(`${API_BASE}/api/prompts`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const cb = scope === 'project' ? 'updateProjectPrompts' : 'updateGlobalPrompts';
        (window as any)[cb]?.(JSON.stringify(data[key]));
        return true;
      }

      case 'update_prompt': {
        const { scope, id, updates } = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/prompts`);
        const data = await res.json();
        const key = scope === 'project' ? 'projectPrompts' : 'globalPrompts';
        data[key] = (data[key] || []).map((p: any) => p.id === id ? { ...p, ...updates } : p);
        await fetch(`${API_BASE}/api/prompts`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const cb = scope === 'project' ? 'updateProjectPrompts' : 'updateGlobalPrompts';
        (window as any)[cb]?.(JSON.stringify(data[key]));
        return true;
      }

      case 'delete_prompt': {
        const { scope, id: delId } = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/prompts`);
        const data = await res.json();
        const key = scope === 'project' ? 'projectPrompts' : 'globalPrompts';
        data[key] = (data[key] || []).filter((p: any) => p.id !== delId);
        await fetch(`${API_BASE}/api/prompts`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const cb = scope === 'project' ? 'updateProjectPrompts' : 'updateGlobalPrompts';
        (window as any)[cb]?.(JSON.stringify(data[key]));
        return true;
      }

      case 'export_prompts': {
        const { scope, promptIds } = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/prompts`);
        const data = await res.json();
        const key = scope === 'project' ? 'projectPrompts' : 'globalPrompts';
        let prompts = data[key] || [];
        if (promptIds?.length) prompts = prompts.filter((p: any) => promptIds.includes(p.id));
        const blob = new Blob([JSON.stringify(prompts, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `prompts-${scope}.json`; a.click();
        URL.revokeObjectURL(url);
        return true;
      }

      case 'import_prompts_file': {
        const { scope } = JSON.parse(content);
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const text = await file.text();
            const imported = JSON.parse(text);
            const prompts = Array.isArray(imported) ? imported : [];
            (window as any).promptImportPreviewResult?.(JSON.stringify({
              items: prompts.map((p: any) => ({ data: p, exists: false })),
              summary: { total: prompts.length, newCount: prompts.length, existingCount: 0 },
              scope,
            }));
          } catch (e: any) {
            (window as any).promptImportPreviewResult?.(JSON.stringify({ items: [], summary: { total: 0, newCount: 0, existingCount: 0 }, error: e.message, scope }));
          }
        };
        input.click();
        return true;
      }

      case 'save_imported_prompts': {
        const { scope, prompts: importPrompts, strategy } = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/prompts`);
        const data = await res.json();
        const key = scope === 'project' ? 'projectPrompts' : 'globalPrompts';
        data[key] = data[key] || [];
        let imported = 0, updated = 0, skipped = 0;
        for (const prompt of (importPrompts || [])) {
          const idx = data[key].findIndex((p: any) => p.id === prompt.id);
          if (idx >= 0) {
            if (strategy === 'overwrite') { data[key][idx] = prompt; updated++; }
            else { skipped++; }
          } else {
            data[key].push(prompt); imported++;
          }
        }
        await fetch(`${API_BASE}/api/prompts`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const cb = scope === 'project' ? 'updateProjectPrompts' : 'updateGlobalPrompts';
        (window as any)[cb]?.(JSON.stringify(data[key]));
        (window as any).promptImportResult?.(JSON.stringify({ success: true, imported, updated, skipped, scope }));
        return true;
      }

      // --- Skill management ---
      case 'get_all_skills': {
        const res = await fetch(`${API_BASE}/api/skills`);
        const data = await res.json();
        // Frontend expects SkillsConfig: { global: {}, local: {}, user: {}, repo: {} }
        const skillsConfig = data.global || data.local ? data : { global: {}, local: {}, user: {}, repo: {} };
        (window as any).updateSkills?.(JSON.stringify(skillsConfig));
        return true;
      }

      case 'import_skill':
      case 'open_skill': {
        // No-op in web mode (no native file system)
        return true;
      }

      case 'delete_skill': {
        const { skillId } = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/skills`);
        const data = await res.json();
        data.skills = (data.skills || []).filter((s: any) => s.id !== skillId);
        await fetch(`${API_BASE}/api/skills`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        (window as any).updateSkills?.(JSON.stringify(data));
        return true;
      }

      case 'toggle_skill': {
        const { skillId: toggleId, enabled: toggleEnabled } = JSON.parse(content);
        const res = await fetch(`${API_BASE}/api/skills`);
        const data = await res.json();
        data.skills = (data.skills || []).map((s: any) => s.id === toggleId ? { ...s, enabled: toggleEnabled } : s);
        await fetch(`${API_BASE}/api/skills`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        (window as any).updateSkills?.(JSON.stringify(data));
        return true;
      }

      // --- MCP server management ---
      case 'get_project_mcp_servers':
      case 'get_global_mcp_servers': {
        const mcpScope = event.includes('project') ? 'project' : 'global';
        const res = await fetch(`${API_BASE}/api/mcp/${mcpScope}/servers`);
        const data = await res.json();
        const servers = Object.values(data.servers || {});
        const cb = event.includes('project') ? 'updateMcpServers' : 'updateMcpServers';
        // Both project and global use updateMcpServers — but codex uses updateCodexMcpServers
        (window as any)[cb]?.(JSON.stringify(servers));
        return true;
      }

      case 'toggle_project_mcp_server':
      case 'toggle_global_mcp_server': {
        const toggleScope = event.includes('project') ? 'project' : 'global';
        const serverData = JSON.parse(content);
        await fetch(`${API_BASE}/api/mcp/${toggleScope}/servers/${encodeURIComponent(serverData.id)}/toggle`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: serverData.enabled }),
        });
        // Refresh server list
        const refreshRes = await fetch(`${API_BASE}/api/mcp/${toggleScope}/servers`);
        const refreshData = await refreshRes.json();
        (window as any).updateMcpServers?.(JSON.stringify(Object.values(refreshData.servers || {})));
        return true;
      }

      case 'add_project_mcp_server':
      case 'add_global_mcp_server': {
        const addScope = event.includes('project') ? 'project' : 'global';
        const newServer = JSON.parse(content);
        await fetch(`${API_BASE}/api/mcp/${addScope}/servers/${encodeURIComponent(newServer.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newServer),
        });
        const addMcpRes = await fetch(`${API_BASE}/api/mcp/${addScope}/servers`);
        const addMcpData = await addMcpRes.json();
        (window as any).updateMcpServers?.(JSON.stringify(Object.values(addMcpData.servers || {})));
        return true;
      }

      case 'update_project_mcp_server':
      case 'update_global_mcp_server': {
        const updScope = event.includes('project') ? 'project' : 'global';
        const updServer = JSON.parse(content);
        await fetch(`${API_BASE}/api/mcp/${updScope}/servers/${encodeURIComponent(updServer.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updServer),
        });
        const updMcpRes = await fetch(`${API_BASE}/api/mcp/${updScope}/servers`);
        const updMcpData = await updMcpRes.json();
        (window as any).updateMcpServers?.(JSON.stringify(Object.values(updMcpData.servers || {})));
        return true;
      }

      case 'delete_project_mcp_server':
      case 'delete_global_mcp_server': {
        const delScope = event.includes('project') ? 'project' : 'global';
        const delServer = JSON.parse(content);
        await fetch(`${API_BASE}/api/mcp/${delScope}/servers/${encodeURIComponent(delServer.id)}`, {
          method: 'DELETE',
        });
        const delMcpRes = await fetch(`${API_BASE}/api/mcp/${delScope}/servers`);
        const delMcpData = await delMcpRes.json();
        (window as any).updateMcpServers?.(JSON.stringify(Object.values(delMcpData.servers || {})));
        return true;
      }

      case 'get_project_mcp_server_status':
      case 'get_global_mcp_server_status': {
        const statusScope = event.includes('project') ? 'project' : 'global';
        const res = await fetch(`${API_BASE}/api/mcp/${statusScope}/status`);
        const data = await res.json();
        (window as any).updateMcpServerStatus?.(JSON.stringify(data.statuses || {}));
        return true;
      }

      case 'get_project_mcp_server_tools':
      case 'get_global_mcp_server_tools': {
        const toolsScope = event.includes('project') ? 'project' : 'global';
        const res = await fetch(`${API_BASE}/api/mcp/${toolsScope}/tools`);
        const data = await res.json();
        (window as any).updateMcpServerTools?.(JSON.stringify(data.tools || []));
        return true;
      }

      // --- Provider sort ---
      case 'sort_providers': {
        const { order } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/sort-providers`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'claude', order }) });
        await refreshProviders('claude');
        return true;
      }

      case 'sort_codex_providers': {
        const { order: codexOrder } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/sort-providers`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'codex', order: codexOrder }) });
        await refreshProviders('codex');
        return true;
      }

      // --- Other no-ops in web mode ---
      case 'get_project_info': {
        (window as any).updateProjectInfo?.(JSON.stringify({ name: 'Web Project', path: '' }));
        return true;
      }

      case 'enhance_prompt': {
        // No AI-based prompt enhancement in web mode
        (window as any).updateEnhancedPrompt?.(content);
        return true;
      }

      case 'save_json': {
        // Export markdown — handled client-side, no backend needed
        return true;
      }

      case 'get_ide_theme': {
        (window as any).onIdeThemeReceived?.(JSON.stringify({ isDark: true }));
        return true;
      }

      case 'search_files':
      case 'list_files': {
        // File listing not available in web mode
        (window as any).onFileListResult?.(JSON.stringify({ files: [] }));
        return true;
      }

      // --- Provider management ---
      case 'add_provider': {
        const provider = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/provider`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'claude', provider }),
        });
        await refreshProviders('claude');
        return true;
      }

      case 'update_provider': {
        const updateData = JSON.parse(content);
        const existingRes = await fetch(`${API_BASE}/api/settings/providers`);
        const existingData = await existingRes.json();
        const existing = existingData.claude?.providers?.[updateData.id] || {};
        const mergedProvider = { ...existing, ...updateData.updates, id: updateData.id };
        await fetch(`${API_BASE}/api/settings/provider`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'claude', provider: mergedProvider }),
        });
        await refreshProviders('claude');
        return true;
      }

      case 'delete_provider': {
        const delData = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/provider/claude/${encodeURIComponent(delData.id)}`, {
          method: 'DELETE',
        });
        await refreshProviders('claude');
        return true;
      }

      case 'switch_provider': {
        const switchData = JSON.parse(content);
        console.log('[bridge-http] switch_provider:', switchData);
        await fetch(`${API_BASE}/api/settings/switch-provider`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'claude', providerId: switchData.id }),
        });
        const swRes = await fetch(`${API_BASE}/api/settings/providers`);
        const swData = await swRes.json();
        const swProviders = buildClaudeProviders(swData);
        console.log('[bridge-http] switch_provider result: currentId=', swData.claude?.current, 'providers=', swProviders.map(p => ({ id: p.id, isActive: p.isActive })));
        (window as any).updateProviders?.(JSON.stringify(swProviders));
        const currentId = swData.claude?.current || '';
        if (currentId && !['__disabled__', '__local_settings_json__', '__cli_login__'].includes(currentId)) {
          const activeProvider = swData.claude?.providers?.[currentId];
          if (activeProvider) {
            (window as any).updateActiveProvider?.(JSON.stringify({ ...activeProvider, isActive: true }));
          }
        }
        return true;
      }

      // --- Codex provider management ---
      case 'add_codex_provider': {
        const codexProvider = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/provider`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'codex', provider: codexProvider }),
        });
        await refreshProviders('codex');
        return true;
      }

      case 'update_codex_provider': {
        const cUpdateData = JSON.parse(content);
        const cExistingRes = await fetch(`${API_BASE}/api/settings/providers`);
        const cExistingData = await cExistingRes.json();
        const cExisting = cExistingData.codex?.providers?.[cUpdateData.id] || {};
        const cMergedProvider = { ...cExisting, ...cUpdateData.updates, id: cUpdateData.id };
        await fetch(`${API_BASE}/api/settings/provider`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'codex', provider: cMergedProvider }),
        });
        await refreshProviders('codex');
        return true;
      }

      case 'delete_codex_provider': {
        const cDelData = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/provider/codex/${encodeURIComponent(cDelData.id)}`, {
          method: 'DELETE',
        });
        await refreshProviders('codex');
        return true;
      }

      case 'switch_codex_provider': {
        const cSwitchData = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/switch-provider`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'codex', providerId: cSwitchData.id }),
        });
        await refreshProviders('codex');
        return true;
      }

      // --- File operations (no-op in web mode) ---
      case 'open_file':
      case 'open_browser':
      case 'refresh_file':
      case 'show_diff':
      case 'show_editable_diff':
      case 'show_edit_preview_diff':
      case 'show_edit_full_diff':
      case 'show_interactive_diff':
      case 'undo_file_changes':
      case 'rewind_files':
      case 'undo_all_file_changes':
        return true;

      // --- Input history (no-op in web mode) ---
      case 'record_input_history':
      case 'delete_input_history_item':
      case 'clear_input_history':
      case 'read_clipboard':
        return true;

      // --- Usage statistics ---
      case 'get_usage_statistics': {
        const emptyStats = {
          projectPath: '', projectName: '', totalSessions: 0,
          totalUsage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, totalTokens: 0 },
          estimatedCost: 0, sessions: [], dailyUsage: [],
          weeklyComparison: { currentWeek: { sessions: 0, cost: 0, tokens: 0 }, lastWeek: { sessions: 0, cost: 0, tokens: 0 }, trends: { sessions: 0, cost: 0, tokens: 0 } },
          byModel: [], lastUpdated: Date.now(),
        };
        (window as any).updateUsageStatistics?.(JSON.stringify(emptyStats));
        return true;
      }

      // --- Provider import/export (no-op in web mode, could be enhanced later) ---
      case 'open_file_chooser_for_cc_switch':
      case 'save_imported_providers':
      case 'preview_cc_switch_import':
      case 'revoke_codex_local_config_authorization':
        return true;

      default:
        console.warn('[bridge-http] Unhandled event:', event);
        return true;
    }
  } catch (e) {
    console.error('[bridge-http] Error sending event:', event, e);
    return false;
  }
};

/** Initialize web mode: connect WebSocket, register message handlers */
export const initWebBridge = async () => {
  try {
    await wsClient.connect();
  } catch (e) {
    console.error('[bridge-http] Failed to connect WebSocket:', e);
  }

  // Fetch and cache working directory from backend settings
  try {
    const wdRes = await fetch(`${API_BASE}/api/settings/working-directory`);
    const wdData = await wdRes.json();
    cachedWorkingDir = wdData.customWorkingDir || '';
    console.log('[bridge-http] Cached working directory:', cachedWorkingDir || '(empty, will use daemon default)');
  } catch (e) {
    console.warn('[bridge-http] Failed to fetch working directory:', e);
  }

  // Route WebSocket messages to window callbacks (same as JCEF callbacks)
  wsClient.on('stream_line', (data) => {
    const { line } = data;
    if (!line) return;

    const w = window as any;

    if (line.startsWith('[STREAM_START]')) {
      w.onStreamStart?.();
    } else if (line.startsWith('[CONTENT_DELTA]')) {
      const delta = line.substring('[CONTENT_DELTA] '.length).trim();
      try {
        const parsed = JSON.parse(delta);
        w.onContentDelta?.(parsed.text || delta);
      } catch {
        w.onContentDelta?.(delta);
      }
    } else if (line.startsWith('[THINKING_DELTA]')) {
      const delta = line.substring('[THINKING_DELTA] '.length).trim();
      try {
        const parsed = JSON.parse(delta);
        w.onThinkingDelta?.(parsed.text || delta);
      } catch {
        w.onThinkingDelta?.(delta);
      }
    } else if (line.startsWith('[STREAM_END]')) {
      w.onStreamEnd?.();
    } else if (line.startsWith('[MESSAGE]')) {
      const json = line.substring('[MESSAGE] '.length).trim();
      // Daemon sends individual message objects via [MESSAGE] in its raw SDK format:
      //   {type:"assistant", message:{content:[{type:"text",text:"Hi!"}]}, ...}
      // Frontend expects ClaudeMessage format:
      //   {type:"assistant", content:"Hi!", raw:{...}, timestamp:"..."}
      try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed)) {
          // Already an array of ClaudeMessages (from Java backend)
          w.updateMessages?.(json);
        } else {
          // Single daemon message — convert to ClaudeMessage and append
          const claudeMsg = convertDaemonMessage(parsed);
          if (claudeMsg) {
            w.addHistoryMessage?.(claudeMsg);
          }
        }
      } catch {
        w.updateMessages?.(json);
      }
    } else if (line.startsWith('[STATUS]')) {
      const text = line.substring('[STATUS] '.length).trim();
      w.updateStatus?.(text);
    } else if (line.startsWith('[PERMISSION_REQUEST]')) {
      const json = line.substring('[PERMISSION_REQUEST] '.length).trim();
      w.showPermissionDialog?.(json);
    } else if (line.startsWith('[ASK_USER_QUESTION]')) {
      const json = line.substring('[ASK_USER_QUESTION] '.length).trim();
      w.showAskUserQuestionDialog?.(json);
    } else if (line.startsWith('[PLAN_APPROVAL]')) {
      const json = line.substring('[PLAN_APPROVAL] '.length).trim();
      w.showPlanApprovalDialog?.(json);
    } else if (line.startsWith('[USAGE]')) {
      const json = line.substring('[USAGE] '.length).trim();
      w.updateUsageStatistics?.(json);
    } else if (line.startsWith('[SESSION_ID]')) {
      const id = line.substring('[SESSION_ID] '.length).trim();
      w.setSessionId?.(id);
    } else if (line.startsWith('[MODE]')) {
      const mode = line.substring('[MODE] '.length).trim();
      w.onModeChanged?.(mode);
    } else if (line.startsWith('[MODEL]')) {
      const model = line.substring('[MODEL] '.length).trim();
      w.onModelChanged?.(model);
    } else if (line.startsWith('[ADD_MESSAGE]')) {
      const json = line.substring('[ADD_MESSAGE] '.length).trim();
      try { w.addHistoryMessage?.(JSON.parse(json)); } catch { /* skip */ }
    } else if (line.startsWith('[MESSAGE_START]')) {
      w.onStreamStart?.();
    } else if (line.startsWith('[MESSAGE_END]')) {
      w.onStreamEnd?.();
    }
    // [CONTENT], [LIFECYCLE], [DEBUG], [TOOL_USE], [TOOL_RESULT] etc. are informational — skip
  });

  wsClient.on('stream_end', () => {
    (window as any).onStreamEnd?.();
  });

  wsClient.on('stream_error', (data) => {
    (window as any).addErrorMessage?.(data.error || 'Stream error');
    (window as any).onStreamEnd?.();
  });

  wsClient.on('connected', () => {
    console.log('[bridge-http] WebSocket connected');
  });

  wsClient.on('heartbeat_ack', () => {
    // Heartbeat acknowledged
  });

  // Start heartbeat
  setInterval(() => {
    if (wsClient.connected) {
      wsClient.send({ type: 'heartbeat' });
    }
  }, 30000);
};
