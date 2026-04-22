import wsClient from './ws-client';

const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? '' : `http://${window.location.hostname}:3001`);

/** Detect if running in web mode (not JCEF) */
export const isWebMode = (): boolean => {
  return !(window as any).sendToJava;
};

/** HTTP bridge: send event to server via REST or WebSocket */
export const sendBridgeEventHttp = async (event: string, content: string = ''): Promise<boolean> => {
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
        let parsed = {};
        try { parsed = content ? JSON.parse(content) : {}; } catch { parsed = { text: content }; }
        const wsType = event
          .replace('send_message_with_attachments', 'send_message')
          .replace('interrupt_session', 'interrupt');
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
        (window as any).updateActiveProvider?.(JSON.stringify(data.provider || { id: 'anthropic', name: 'Anthropic', type: 'claude' }));
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
        await fetch(`${API_BASE}/api/settings/switch-provider`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: content === 'codex' ? 'codex' : 'claude', providerId: content }) });
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

      case 'update_provider': {
        const provider = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/provider`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(provider) });
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
      case 'get_selected_agent':
      case 'set_selected_agent':
      case 'set_reasoning_effort': {
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

      // --- Settings queries (no-op or default in web mode) ---
      case 'get_node_path': {
        (window as any).updateNodePath?.(JSON.stringify({ path: '', version: null }));
        return true;
      }

      case 'get_working_directory': {
        (window as any).updateWorkingDirectory?.(JSON.stringify({ customWorkingDir: '' }));
        return true;
      }

      case 'get_editor_font_config': {
        (window as any).onEditorFontConfigReceived?.(JSON.stringify({ fontFamily: 'monospace', fontSize: 14, lineSpacing: 1.5 }));
        return true;
      }

      case 'get_codex_sandbox_mode': {
        (window as any).updateCodexSandboxMode?.(JSON.stringify({ sandboxMode: 'workspace-write' }));
        return true;
      }

      case 'get_commit_prompt': {
        (window as any).updateCommitPrompt?.(JSON.stringify({ commitPrompt: '' }));
        return true;
      }

      case 'get_sound_notification_config': {
        (window as any).updateSoundNotificationConfig?.(JSON.stringify({ enabled: false, onlyWhenUnfocused: false }));
        return true;
      }

      case 'get_commit_generation_enabled': {
        (window as any).updateCommitGenerationEnabled?.(JSON.stringify({ commitGenerationEnabled: true }));
        return true;
      }

      case 'get_status_bar_widget_enabled': {
        (window as any).updateStatusBarWidgetEnabled?.(JSON.stringify({ statusBarWidgetEnabled: true }));
        return true;
      }

      case 'get_prompts': {
        (window as any).updatePrompts?.('[]');
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
        const claudeProviders = Object.values(data.claude?.providers || {});
        (window as any).updateProviders?.(JSON.stringify(claudeProviders));
        return true;
      }

      case 'get_agents': {
        (window as any).updateAgents?.('[]');
        return true;
      }

      case 'get_codex_providers': {
        (window as any).updateCodexProviders?.('[]');
        return true;
      }

      // --- Settings set operations (no-op or persist locally) ---
      case 'set_node_path':
      case 'set_working_directory':
      case 'set_codex_sandbox_mode':
      case 'set_sound_notification_enabled':
      case 'set_sound_only_when_unfocused':
      case 'set_selected_sound':
      case 'set_custom_sound_path':
      case 'test_sound':
      case 'browse_sound_file':
      case 'set_commit_generation_enabled':
      case 'set_status_bar_widget_enabled':
      case 'set_commit_prompt':
      case 'add_provider':
      case 'delete_provider':
      case 'switch_provider':
      case 'add_agent':
      case 'update_agent':
      case 'delete_agent':
      case 'export_agents':
      case 'import_agents_file':
      case 'save_imported_agents':
      case 'add_codex_provider':
      case 'update_codex_provider':
      case 'delete_codex_provider':
      case 'switch_codex_provider':
      case 'get_project_info':
      case 'enhance_prompt':
      case 'save_json':
      case 'get_ide_theme':
      case 'search_files':
      case 'list_files': {
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
      w.updateMessages?.(json);
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
    }
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
