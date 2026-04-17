import { useEffect, useRef, useState } from "react";
import { useSystemState } from "../hooks/useSystemState";
import type { Settings } from "../types";

interface Props {
  onClose: () => void;
}

function copySettings(settings: Settings): Settings {
  return {
    provider: settings.provider,
    agent_cmd: settings.agent_cmd,
    intervals: { ...settings.intervals },
    timeouts: { ...settings.timeouts },
    workers: { ...settings.workers },
    follow_up_research_cooldown_minutes: settings.follow_up_research_cooldown_minutes,
    tools: [...settings.tools],
    available_providers: [...settings.available_providers],
  };
}

export function SettingsModal({ onClose }: Props) {
  const { getSettings, updateSettings, getProviderDefaults } = useSystemState();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [providerDefaults, setProviderDefaults] = useState<Record<string, { default_cmd: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [current, defaults] = await Promise.all([
          getSettings(controller.signal),
          getProviderDefaults(controller.signal),
        ]);
        setDraft(copySettings(current));
        setProviderDefaults(defaults);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => { controller.abort(); };
  }, [getSettings, getProviderDefaults]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  useEffect(() => {
    if (!loading) firstFieldRef.current?.focus();
  }, [loading]);

  const updateNumber = (
    group: "intervals" | "timeouts" | "workers",
    key: "initial" | "follow_up" | "connective",
    value: string,
  ) => {
    const numeric = Number.parseInt(value, 10);
    setDraft((current) => {
      if (!current) return current;
      return { ...current, [group]: { ...current[group], [key]: Number.isNaN(numeric) ? 0 : numeric } };
    });
  };

  const handleProviderChange = (provider: string) => {
    const defaultCmd = providerDefaults[provider]?.default_cmd;
    setDraft((current) => {
      if (!current) return current;
      return { ...current, provider, ...(defaultCmd !== undefined ? { agent_cmd: defaultCmd } : {}) };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateSettings({
        provider: draft.provider,
        agent_cmd: draft.agent_cmd.trim(),
        intervals: draft.intervals,
        timeouts: draft.timeouts,
        workers: draft.workers,
        follow_up_research_cooldown_minutes: draft.follow_up_research_cooldown_minutes,
        tools: draft.tools.map((t) => t.trim()).filter(Boolean),
      });
      setDraft(copySettings(next));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  return (
    <div className="modal-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="modal modal--settings">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Settings</h2>
            <p className="modal-subtitle">Configure providers, workers, and timing.</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {loading || !draft ? (
          <div className="modal-loading">Loading settings...</div>
        ) : (
          <form onSubmit={handleSubmit}>

            <div className="settings-card">
              <div className="settings-card-title">Provider</div>
              <div className="modal-field">
                <label className="modal-label" htmlFor="settings-provider">Provider</label>
                <select
                  id="settings-provider"
                  ref={firstFieldRef}
                  className="modal-input settings-provider-select"
                  value={draft.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  {draft.available_providers.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="modal-field">
                <label className="modal-label" htmlFor="settings-agent-cmd">Agent command</label>
                <input
                  id="settings-agent-cmd"
                  type="text"
                  className="modal-input"
                  value={draft.agent_cmd}
                  onChange={(e) => setDraft((current) => current ? { ...current, agent_cmd: e.target.value } : current)}
                />
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-card-title">Workers</div>
              <p className="settings-card-blurb">Cooldown: the minimum number of minutes between when an idea was last studied and when it will next be studied. Changes to worker count take effect after a restart.</p>
              <table className="settings-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Initial</th>
                    <th>Follow-up</th>
                    <th>Connective</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="settings-table-label">Count</td>
                    <td>
                      <input id="workers-initial" type="number" min="0" className="modal-input" value={draft.workers.initial} onChange={(e) => updateNumber("workers", "initial", e.target.value)} />
                    </td>
                    <td>
                      <input id="workers-follow-up" type="number" min="0" className="modal-input" value={draft.workers.follow_up} onChange={(e) => updateNumber("workers", "follow_up", e.target.value)} />
                    </td>
                    <td>
                      <input id="workers-connective" type="number" min="0" className="modal-input" value={draft.workers.connective} onChange={(e) => updateNumber("workers", "connective", e.target.value)} />
                    </td>
                  </tr>
                  <tr>
                    <td className="settings-table-label">Interval <span className="settings-table-unit">s</span></td>
                    <td><input id="interval-initial" type="number" min="1" className="modal-input" value={draft.intervals.initial} onChange={(e) => updateNumber("intervals", "initial", e.target.value)} /></td>
                    <td><input id="interval-follow-up" type="number" min="1" className="modal-input" value={draft.intervals.follow_up} onChange={(e) => updateNumber("intervals", "follow_up", e.target.value)} /></td>
                    <td><input id="interval-connective" type="number" min="1" className="modal-input" value={draft.intervals.connective} onChange={(e) => updateNumber("intervals", "connective", e.target.value)} /></td>
                  </tr>
                  <tr>
                    <td className="settings-table-label">Timeout <span className="settings-table-unit">s</span></td>
                    <td><input id="timeout-initial" type="number" min="1" className="modal-input" value={draft.timeouts.initial} onChange={(e) => updateNumber("timeouts", "initial", e.target.value)} /></td>
                    <td><input id="timeout-follow-up" type="number" min="1" className="modal-input" value={draft.timeouts.follow_up} onChange={(e) => updateNumber("timeouts", "follow_up", e.target.value)} /></td>
                    <td><input id="timeout-connective" type="number" min="1" className="modal-input" value={draft.timeouts.connective} onChange={(e) => updateNumber("timeouts", "connective", e.target.value)} /></td>
                  </tr>
                  <tr>
                    <td className="settings-table-label">Cooldown <span className="settings-table-unit">min</span></td>
                    <td colSpan={3}>
                      <input
                        id="follow-up-cooldown"
                        type="number"
                        min="0"
                        className="modal-input settings-cooldown-input"
                        value={draft.follow_up_research_cooldown_minutes}
                        onChange={(e) => {
                          const numeric = Number.parseInt(e.target.value, 10);
                          setDraft({ ...draft, follow_up_research_cooldown_minutes: Number.isNaN(numeric) ? 0 : numeric });
                        }}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="settings-card">
              <div className="settings-card-title">Tools</div>
              <p className="settings-card-blurb">Point agents at things in your environment: CLI tools they can run, local files to read for extra context, websites to keep in mind, etc.</p>
              <div className="settings-tools-list">
                {draft.tools.map((tool, i) => (
                  <div key={i} className="settings-tool-row">
                    <input
                      type="text"
                      className="modal-input"
                      value={tool}
                      onChange={(e) => {
                        const next = [...draft.tools];
                        next[i] = e.target.value;
                        setDraft({ ...draft, tools: next });
                      }}
                    />
                    <button
                      type="button"
                      className="icon-btn settings-tool-remove"
                      onClick={() => {
                        const next = draft.tools.filter((_, j) => j !== i);
                        setDraft({ ...draft, tools: next });
                      }}
                      aria-label="Remove tool"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="settings-tool-add"
                  onClick={() => {
                    setDraft({ ...draft, tools: [...draft.tools, ""] });
                  }}
                >
                  + Add tool
                </button>
              </div>
            </div>

            {error && <div className="modal-error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="action-btn" onClick={onClose}>Close</button>
              <button type="submit" className="action-btn action-btn--done" disabled={saving}>
                {saving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
