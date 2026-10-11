"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { commandsSchema, type Command, type PaperMap, type SimulationState } from "../lib/schema";

type ProviderStatus = {
  image: { provider: "codex" | "openai"; ready: boolean; model: string; detail: string };
  command: { provider: "codex" | "openai"; ready: boolean; model: string; detail: string };
  jev: { ready: boolean; model: string };
  openaiApi: { enabled: boolean; ready: boolean; model: string };
};

type CommandProposal = {
  commands: Command[];
  clarification: string | null;
  provider: "typesafe" | "codex" | "openai";
  model: string;
  latencyMs: number;
};

type SpeechResultEvent = {
  results: ArrayLike<{ 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type Props = {
  simulation: SimulationState;
  onApplyCommands: (commands: readonly Command[]) => string | null;
};

function providerLabel(provider: CommandProposal["provider"] | ProviderStatus["image"]["provider"]) {
  if (provider === "typesafe") return "Jev · TypeSafe";
  if (provider === "openai") return "OpenAI API";
  return "Codex sign-in";
}

function commandDescription(command: Command, map: PaperMap) {
  const locationName = (id: string) => map.locations.find((location) => location.id === id)?.label ?? id;
  if (command.type === "create-package") {
    return `Create ${command.priority} package · ${locationName(command.from)} → ${locationName(command.to)}`;
  }
  if (command.type === "dispatch-delivery") {
    return `Create and dispatch ${command.priority} delivery · ${locationName(command.from)} → ${locationName(command.to)} · ${command.courierId ? `courier ${command.courierId}` : "auto-assign courier"}`;
  }
  if (command.type === "set-priority") return `Set ${command.packageId} priority · ${command.priority}`;
  if (command.type === "set-road") return `${command.closed ? "Close" : "Open"} road · ${command.roadId}`;
  return `Assign ${command.packageId} to ${command.courierId}`;
}

function errorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return `Request failed (${status}).`;
}

export function OperationsWorkbench({ simulation, onApplyCommands }: Props) {
  const [fromId, setFromId] = useState(() => simulation.map.locations[0]?.id ?? "");
  const [toId, setToId] = useState(() => simulation.map.locations[1]?.id ?? simulation.map.locations[0]?.id ?? "");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [assignTo, setAssignTo] = useState("");
  const [assignPackageId, setAssignPackageId] = useState("");
  const [assignCourierId, setAssignCourierId] = useState("");
  const [priorityPackageId, setPriorityPackageId] = useState("");
  const [nextPriority, setNextPriority] = useState<"normal" | "urgent">("normal");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualNotice, setManualNotice] = useState<string | null>(null);
  const [commandText, setCommandText] = useState("");
  const [commandMode, setCommandMode] = useState<"jev" | "openai">("jev");
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CommandProposal | null>(null);
  const [proposalNotice, setProposalNotice] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [lastCommandCall, setLastCommandCall] = useState<{ provider: string; latencyMs: number } | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const locations = simulation.map.locations;
  const queuedPackages = useMemo(() => simulation.packages.filter((pkg) => pkg.status === "queued"), [simulation.packages]);
  const editablePackages = useMemo(() => simulation.packages.filter((pkg) => pkg.status !== "delivered"), [simulation.packages]);
  const currentFromId = locations.some((location) => location.id === fromId) ? fromId : locations[0]?.id ?? "";
  const currentToId = locations.some((location) => location.id === toId) ? toId : locations.find((location) => location.id !== currentFromId)?.id ?? "";
  const currentAssignPackageId = queuedPackages.some((pkg) => pkg.id === assignPackageId) ? assignPackageId : queuedPackages[0]?.id ?? "";
  const currentAssignCourierId = simulation.couriers.some((courier) => courier.id === assignCourierId) ? assignCourierId : simulation.couriers[0]?.id ?? "";
  const currentPriorityPackageId = editablePackages.some((pkg) => pkg.id === priorityPackageId) ? priorityPackageId : editablePackages[0]?.id ?? "";

  useEffect(() => {
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    setVoiceSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
    return () => recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    void refreshProviderStatus();
    // Readiness is fetched once on entry; the manual refresh button can request a newer snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshProviderStatus() {
    setProviderLoading(true);
    setProviderError(null);
    try {
      const response = await fetch("/api/providers", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(payload, response.status));
      if (!payload || typeof payload !== "object" || !("image" in payload) || !("command" in payload) || !("jev" in payload) || !("openaiApi" in payload)) {
        throw new Error("Provider readiness response was incomplete.");
      }
      setProviderStatus(payload as ProviderStatus);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : "Provider readiness could not be loaded.");
    } finally {
      setProviderLoading(false);
    }
  }

  function commitManual(commands: Command[], notice: string) {
    setManualError(null);
    const error = onApplyCommands(commands);
    if (error) {
      setManualError(error);
      setManualNotice(null);
      return false;
    }
    setManualNotice(notice);
    setProposalNotice(null);
    return true;
  }

  function handleCreatePackage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentFromId || !currentToId || currentFromId === currentToId) {
      setManualError("Choose two different locations for this package.");
      return;
    }

    const commands: Command[] = [{ type: "create-package", from: currentFromId, to: currentToId, priority }];
    if (assignTo) {
      let packageNumber = simulation.nextPackageNumber;
      while (simulation.packages.some((pkg) => pkg.id === `pkg-${packageNumber}`)) packageNumber += 1;
      commands.push({ type: "assign-package", packageId: `pkg-${packageNumber}`, courierId: assignTo });
    }
    commitManual(commands, assignTo ? "Package created and assigned." : "Package added to the queue.");
  }

  function handleAssignPackage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentAssignPackageId || !currentAssignCourierId) {
      setManualError("Choose a queued package and a courier.");
      return;
    }
    commitManual([{ type: "assign-package", packageId: currentAssignPackageId, courierId: currentAssignCourierId }], `${currentAssignPackageId} assigned to ${simulation.couriers.find((courier) => courier.id === currentAssignCourierId)?.name ?? currentAssignCourierId}.`);
  }

  function handlePriorityChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPriorityPackageId) {
      setManualError("Choose a package that has not been delivered.");
      return;
    }
    commitManual([{ type: "set-priority", packageId: currentPriorityPackageId, priority: nextPriority }], `${currentPriorityPackageId} priority set to ${nextPriority}.`);
  }

  async function handleCommandPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = commandText.trim();
    if (!text) {
      setCommandError("Write or dictate one operation first.");
      return;
    }

    setCommandBusy(true);
    setCommandError(null);
    setProposal(null);
    setProposalNotice(null);
    try {
      const response = await fetch("/api/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          map: simulation.map,
          packages: simulation.packages,
          couriers: simulation.couriers,
          mode: commandMode,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(payload, response.status));
      if (!payload || typeof payload !== "object") throw new Error("Command response was incomplete.");
      const record = payload as Record<string, unknown>;
      const parsedCommands = commandsSchema.safeParse(record.commands);
      if (!parsedCommands.success || typeof record.model !== "string" || typeof record.provider !== "string" || typeof record.latencyMs !== "number" || !Number.isFinite(record.latencyMs)) {
        throw new Error("Command response could not be reviewed safely.");
      }
      if (record.provider !== "typesafe" && record.provider !== "codex" && record.provider !== "openai") {
        throw new Error("Command provider was not recognized.");
      }
      const clarification = record.clarification === null || typeof record.clarification === "string" ? record.clarification : null;
      const result: CommandProposal = {
        commands: parsedCommands.data,
        clarification,
        provider: record.provider,
        model: record.model,
        latencyMs: record.latencyMs,
      };
      setProposal(result);
      setLastCommandCall({ provider: providerLabel(result.provider), latencyMs: result.latencyMs });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Command preview failed.");
    } finally {
      setCommandBusy(false);
    }
  }

  function applyProposal() {
    if (!proposal || proposal.commands.length === 0) return;
    const error = onApplyCommands(proposal.commands);
    if (error) {
      setProposalNotice(`Nothing was applied. ${error}`);
      return;
    }
    setProposalNotice(`${proposal.commands.length} ${proposal.commands.length === 1 ? "change" : "changes"} applied atomically.`);
    setProposal(null);
  }

  function startVoiceInput() {
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceSupported(false);
      setVoiceError("Speech recognition is not available in this browser.");
      return;
    }

    setVoiceError(null);
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      const words = Array.from({ length: event.results.length }, (_, index) => event.results[index]?.[0]?.transcript ?? "").join("").trim();
      if (words) setCommandText(words);
    };
    recognition.onerror = (event) => {
      setVoiceError(`Speech recognition stopped (${event.error}).`);
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      recognitionRef.current = null;
      setVoiceError("Could not start speech recognition. Try again from this browser.");
    }
  }

  function stopVoiceInput() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  return (
    <section className="workbench-section" aria-labelledby="workbench-title">
      <div className="operations-heading workbench-heading">
        <div>
          <p className="section-kicker">CONTROL DESK</p>
          <h2 id="workbench-title">Dispatch controls</h2>
        </div>
        <span className="local-state-label"><span aria-hidden="true" /> Changes apply to this local run</span>
      </div>

      <div className="workbench-grid">
        <section className="workbench-panel manual-panel" aria-labelledby="manual-title">
          <div className="workbench-panel-heading">
            <div><p className="workbench-overline">NO MODEL REQUIRED</p><h3 id="manual-title">Manual dispatch</h3></div>
            <span className="workbench-panel-mark" aria-hidden="true">＋</span>
          </div>
          <p className="workbench-copy">Create, assign, and reprioritize packages directly. Each change is checked against current capacity and map state.</p>

          <form className="manual-form" onSubmit={handleCreatePackage}>
            <div className="form-title-row"><strong>New package</strong><span>01 / CREATE</span></div>
            <div className="workbench-field-grid">
              <label className="workbench-field"><span>From</span><select value={currentFromId} onChange={(event) => setFromId(event.target.value)} required>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
              </select></label>
              <label className="workbench-field"><span>To</span><select value={currentToId} onChange={(event) => setToId(event.target.value)} required>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
              </select></label>
            </div>
            <div className="workbench-field-grid workbench-field-grid-secondary">
              <label className="workbench-field"><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as "normal" | "urgent")}>
                <option value="normal">Normal</option><option value="urgent">Urgent</option>
              </select></label>
              <label className="workbench-field"><span>Assign now <small>Optional</small></span><select value={assignTo} onChange={(event) => setAssignTo(event.target.value)}>
                <option value="">Keep queued</option>{simulation.couriers.map((courier) => <option key={courier.id} value={courier.id}>{courier.name}</option>)}
              </select></label>
            </div>
            <button className="workbench-submit" type="submit" disabled={locations.length < 2}>Create package <span aria-hidden="true">↗</span></button>
          </form>

          <div className="manual-subforms">
            <form className="manual-form compact-manual-form" onSubmit={handleAssignPackage}>
              <div className="form-title-row"><strong>Assign queued</strong><span>02 / ASSIGN</span></div>
              {queuedPackages.length ? <div className="workbench-field-grid">
                <label className="workbench-field"><span>Package</span><select value={currentAssignPackageId} onChange={(event) => setAssignPackageId(event.target.value)}>
                  {queuedPackages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.id} · {locations.find((location) => location.id === pkg.from)?.label ?? pkg.from}</option>)}
                </select></label>
                <label className="workbench-field"><span>Courier</span><select value={currentAssignCourierId} onChange={(event) => setAssignCourierId(event.target.value)}>
                  {simulation.couriers.map((courier) => <option key={courier.id} value={courier.id}>{courier.name} · {courier.packageIds.length}/{courier.capacity}</option>)}
                </select></label>
              </div> : <p className="workbench-empty-note">No queued packages to assign.</p>}
              <button className="workbench-secondary-submit" type="submit" disabled={!queuedPackages.length}>Assign package</button>
            </form>

            <form className="manual-form compact-manual-form" onSubmit={handlePriorityChange}>
              <div className="form-title-row"><strong>Change priority</strong><span>03 / PRIORITY</span></div>
              {editablePackages.length ? <div className="workbench-field-grid">
                <label className="workbench-field"><span>Package</span><select value={currentPriorityPackageId} onChange={(event) => setPriorityPackageId(event.target.value)}>
                  {editablePackages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.id} · {pkg.priority}</option>)}
                </select></label>
                <label className="workbench-field"><span>New priority</span><select value={nextPriority} onChange={(event) => setNextPriority(event.target.value as "normal" | "urgent")}>
                  <option value="normal">Normal</option><option value="urgent">Urgent</option>
                </select></label>
              </div> : <p className="workbench-empty-note">No active packages to reprioritize.</p>}
              <button className="workbench-secondary-submit" type="submit" disabled={!editablePackages.length}>Update priority</button>
            </form>
          </div>
          {manualError ? <p className="workbench-error" role="alert">{manualError}</p> : null}
          {manualNotice ? <p className="workbench-success" role="status">{manualNotice}</p> : null}
        </section>

        <section className="workbench-panel command-panel" aria-labelledby="command-title">
          <div className="workbench-panel-heading">
            <div><p className="workbench-overline">PROPOSE · REVIEW · APPLY</p><h3 id="command-title">Text command</h3></div>
            <span className="workbench-panel-mark command-mark" aria-hidden="true">⌁</span>
          </div>
          <p className="workbench-copy">Ask for one operation. The result stays a proposal until you review and apply it.</p>

          <form onSubmit={handleCommandPreview}>
            <div className="command-toolbar">
              <label className="workbench-field command-mode-field"><span>Interpreter</span><select value={commandMode} onChange={(event) => setCommandMode(event.target.value as "jev" | "openai")}>
                <option value="jev">Jev · quick commands</option><option value="openai">OpenAI · compound commands</option>
              </select></label>
              <span className={`command-readiness ${providerLoading ? "command-readiness-loading" : providerStatus?.jev.ready ? "" : "command-readiness-unavailable"}`}>
                <i aria-hidden="true" />{providerLoading ? "Checking" : (commandMode === "jev" ? providerStatus?.jev.ready : providerStatus?.command.ready) ? "Ready" : "Unavailable"}
              </span>
            </div>
            <label className="command-text-label" htmlFor="command-text">What should change?</label>
            <textarea id="command-text" className="command-textarea" value={commandText} onChange={(event) => setCommandText(event.target.value)} placeholder="For example: make pkg-1 urgent, or close road-4" rows={4} />
            <div className="voice-row">
              <button className="voice-button" type="button" onClick={isListening ? stopVoiceInput : startVoiceInput} disabled={!voiceSupported && !isListening}>
                <span aria-hidden="true">{isListening ? "■" : "◉"}</span>{isListening ? "Stop voice input" : voiceSupported ? "Dictate command" : "Voice unavailable"}
              </button>
              <span className="voice-disclosure">Optional browser speech recognition may send audio to its speech service. Review the transcript before previewing.</span>
            </div>
            {voiceError ? <p className="workbench-error" role="status">{voiceError}</p> : null}
            <button className="workbench-submit command-preview-button" type="submit" disabled={commandBusy || !commandText.trim()}>
              {commandBusy ? "Preparing proposal…" : "Preview command"}<span aria-hidden="true">↗</span>
            </button>
          </form>

          {commandError ? <p className="workbench-error" role="alert">{commandError}</p> : null}
          {proposal ? <div className="command-proposal" aria-live="polite">
            <div className="proposal-call-receipt">
              <span><i aria-hidden="true" />{providerLabel(proposal.provider)}</span>
              <span>{proposal.model}</span>
              <strong>{proposal.latencyMs} ms</strong>
            </div>
            {proposal.clarification ? <p className="clarification-note">{proposal.clarification}</p> : null}
            {proposal.commands.length ? <>
              <div className="proposal-list-heading"><strong>Review proposed changes</strong><span>{proposal.commands.length} {proposal.commands.length === 1 ? "change" : "changes"}</span></div>
              <ol className="command-proposal-list">
                {proposal.commands.map((command, index) => <li key={`${command.type}-${index}`}>
                  <span className="command-index">{String(index + 1).padStart(2, "0")}</span>
                  <span>{commandDescription(command, simulation.map)}</span>
                  <button type="button" aria-label={`Remove proposed change ${index + 1}`} onClick={() => setProposal((current) => current ? { ...current, commands: current.commands.filter((_, commandIndex) => commandIndex !== index) } : current)}>Remove</button>
                </li>)}
              </ol>
              <button className="apply-proposal-button" type="button" onClick={applyProposal} disabled={!proposal.commands.length}>Apply reviewed changes</button>
            </> : proposal.clarification ? null : <p className="clarification-note">No changes were proposed.</p>}
          </div> : null}
          {proposalNotice ? <p className={proposalNotice.startsWith("Nothing") ? "workbench-error" : "workbench-success"} role="status">{proposalNotice}</p> : null}
        </section>

        <section className="workbench-panel provider-panel" aria-labelledby="provider-title">
          <div className="workbench-panel-heading">
            <div><p className="workbench-overline">LOCAL STATUS CHECK</p><h3 id="provider-title">Providers</h3></div>
            <button className="provider-refresh" type="button" onClick={() => void refreshProviderStatus()} disabled={providerLoading} aria-label="Refresh provider readiness">↻</button>
          </div>
          <p className="workbench-copy">Readiness comes from this app’s status endpoint. It does not make a paid request.</p>
          {providerLoading ? <p className="provider-loading">Checking provider readiness…</p> : providerError ? <p className="workbench-error" role="status">{providerError}</p> : providerStatus ? <div className="provider-list">
            <ProviderRow label="Paper map reader" ready={providerStatus.image.ready} detail={`${providerStatus.image.detail} · ${providerStatus.image.model}`} />
            <ProviderRow label="Jev command interpreter" ready={providerStatus.jev.ready} detail={providerStatus.jev.model} />
            <ProviderRow label="Compound command interpreter" ready={providerStatus.command.ready} detail={`${providerStatus.command.detail} · ${providerStatus.command.model}`} />
            <ProviderRow label="Paid OpenAI API" ready={providerStatus.openaiApi.ready} detail={`${providerStatus.openaiApi.enabled ? "Enabled" : "Disabled"} · ${providerStatus.openaiApi.model}`} />
          </div> : null}
          <div className="provider-latency" aria-live="polite">
            <span>Last command provider call</span>
            <strong>{lastCommandCall ? `${lastCommandCall.provider} · ${lastCommandCall.latencyMs} ms` : "No command call yet"}</strong>
          </div>
          <p className="provider-note">Image scan latency appears with its scan receipt above. Readiness never sends the image or command text.</p>
        </section>
      </div>
    </section>
  );
}

function ProviderRow({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return <div className="provider-row">
    <div className="provider-row-top"><strong>{label}</strong><span className={`provider-status-dot ${ready ? "provider-status-ready" : ""}`}><i aria-hidden="true" />{ready ? "Ready" : "Unavailable"}</span></div>
    <span className="provider-detail">{detail}</span>
  </div>;
}
