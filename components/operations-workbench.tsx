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
  routedBy?: "typesafe";
  routeCategory?: "create_package" | "dispatch_delivery" | "set_priority" | "set_road" | "assign_package" | "delegate_to_codex" | "clarify";
  routerLatencyMs?: number;
  model: string;
  latencyMs: number;
  contextKey: string;
};

const commandRouteLabels: Record<NonNullable<CommandProposal["routeCategory"]>, string> = {
  create_package: "create package",
  dispatch_delivery: "dispatch delivery",
  set_priority: "change priority",
  set_road: "change road",
  assign_package: "assign package",
  delegate_to_codex: "compound",
  clarify: "clarify",
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
  worldRevision: number;
  onApplyCommands: (commands: readonly Command[]) => string | null;
};

function providerLabel(provider: CommandProposal["provider"] | ProviderStatus["image"]["provider"]) {
  if (provider === "typesafe") return "Jev · TypeSafe";
  if (provider === "openai") return "OpenAI API";
  return "Codex sign-in";
}

function commandRouteSummary(proposal: CommandProposal) {
  if (proposal.routedBy !== "typesafe" || !proposal.routeCategory) return null;
  const target = proposal.provider === "typesafe" ? "" : ` → ${proposal.provider === "codex" ? "Codex" : "OpenAI"}`;
  return `Jev${target} · ${commandRouteLabels[proposal.routeCategory]}`;
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
    const code = payload.error;
    const messages: Record<string, string> = {
      invalid_command_request: "The request could not be validated. Review the command and try again.",
      rate_limited: "Too many requests. Wait a moment, then try again.",
      provider_busy: "The provider is handling another request. Try again in a moment.",
      provider_timeout: "The provider took too long to respond. No changes were applied; try again.",
      codex_native_unavailable: "The signed-in command provider is unavailable on this app host. Check provider status and try again.",
      codex_unavailable: "The signed-in command provider is unavailable. Check provider status and try again.",
      typesafe_unavailable: "The fast command provider is unavailable. Check provider status and try again.",
      openai_api_unavailable: "The OpenAI API provider is unavailable. Check provider status and try again.",
      provider_invalid_output: "The provider returned a response that could not be reviewed safely. No changes were applied; try again.",
      provider_invalid_response: "The provider returned a response that could not be reviewed safely. No changes were applied; try again.",
      typesafe_invalid_response: "The provider returned a response that could not be reviewed safely. No changes were applied; try again.",
      provider_invalid_map: "The provider returned a map that could not be validated. Review the input and try again.",
      typesafe_request_failed: "The fast provider request failed. No changes were applied; try again.",
      openai_api_request_failed: "The OpenAI provider request failed. No changes were applied; try again.",
      provider_failed: "The provider request failed. No changes were applied; try again.",
      paid_api_not_enabled: "Paid API mode is turned off. Check provider status or try a different request.",
    };
    return messages[code] ?? `The request failed (${status}). Check provider status and try again.`;
  }
  return `Request failed (${status}).`;
}

export function OperationsWorkbench({ simulation, worldRevision, onApplyCommands }: Props) {
  const [fromId, setFromId] = useState(() => simulation.map.locations[0]?.id ?? "");
  const [toId, setToId] = useState(() => simulation.map.locations[1]?.id ?? simulation.map.locations[0]?.id ?? "");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [assignTo, setAssignTo] = useState(() => simulation.couriers[0]?.id ?? "");
  const [assignPackageId, setAssignPackageId] = useState("");
  const [assignCourierId, setAssignCourierId] = useState("");
  const [priorityPackageId, setPriorityPackageId] = useState("");
  const [nextPriority, setNextPriority] = useState<"normal" | "urgent">("normal");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualNotice, setManualNotice] = useState<string | null>(null);
  const [commandText, setCommandText] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CommandProposal | null>(null);
  const [proposalNotice, setProposalNotice] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [lastCommandCall, setLastCommandCall] = useState<{ provider: string; latencyMs: number } | null>(null);
  const [commandStartedAt, setCommandStartedAt] = useState<number | null>(null);
  const [commandElapsedSeconds, setCommandElapsedSeconds] = useState(0);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const commandRequestRevision = useRef(0);
  const commandAbort = useRef<AbortController | null>(null);
  const previousCommandContext = useRef("");

  const locations = simulation.map.locations;
  const queuedPackages = useMemo(() => simulation.packages.filter((pkg) => pkg.status === "queued"), [simulation.packages]);
  const editablePackages = useMemo(() => simulation.packages.filter((pkg) => pkg.status !== "delivered"), [simulation.packages]);
  const currentFromId = locations.some((location) => location.id === fromId) ? fromId : locations[0]?.id ?? "";
  const currentToId = locations.some((location) => location.id === toId) ? toId : locations.find((location) => location.id !== currentFromId)?.id ?? "";
  const currentAssignPackageId = queuedPackages.some((pkg) => pkg.id === assignPackageId) ? assignPackageId : queuedPackages[0]?.id ?? "";
  const currentAssignCourierId = simulation.couriers.some((courier) => courier.id === assignCourierId) ? assignCourierId : simulation.couriers[0]?.id ?? "";
  const currentPriorityPackageId = editablePackages.some((pkg) => pkg.id === priorityPackageId) ? priorityPackageId : editablePackages[0]?.id ?? "";
  const commandContext = JSON.stringify({
    worldRevision,
    map: {
      locations: simulation.map.locations.map(({ id }) => id),
      roads: simulation.map.roads.map(({ id, from, to, closed }) => [id, from, to, closed]),
    },
    packages: simulation.packages.map(({ id, from, to, priority: currentPriority, status, courierId }) => [id, from, to, currentPriority, status, courierId]),
    couriers: simulation.couriers.map(({ id, packageIds, capacity }) => [id, packageIds, capacity]),
  });
  const latestCommandContext = useRef(commandContext);
  latestCommandContext.current = commandContext;

  useEffect(() => {
    if (commandStartedAt === null || !commandBusy) return;
    const updateElapsed = () => setCommandElapsedSeconds(Math.floor((Date.now() - commandStartedAt) / 1_000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [commandBusy, commandStartedAt]);

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

  useEffect(() => {
    if (previousCommandContext.current === commandContext) return;
    const hasPreviousContext = previousCommandContext.current !== "";
    previousCommandContext.current = commandContext;
    if (!hasPreviousContext) return;
    const hasPendingRequest = Boolean(commandAbort.current);
    if (!hasPendingRequest && !proposal) return;
    commandRequestRevision.current += 1;
    commandAbort.current?.abort();
    commandAbort.current = null;
    setCommandBusy(false);
    setCommandStartedAt(null);
    setProposal(null);
    setCommandError(null);
    setProposalNotice("The run changed before review finished. Preview the command again against the current run.");
  }, [commandContext, proposal]);

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

  function updateCommandText(value: string) {
    setCommandText(value);
    if (proposal) {
      setProposal(null);
      setProposalNotice("The command text changed. Preview it again before applying.");
    }
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
      setCommandError("Write or dictate a delivery instruction first.");
      return;
    }

    const requestRevision = ++commandRequestRevision.current;
    const requestContext = commandContext;
    const controller = new AbortController();
    commandAbort.current = controller;
    setCommandBusy(true);
    setCommandStartedAt(Date.now());
    setCommandElapsedSeconds(0);
    setCommandError(null);
    setProposal(null);
    setProposalNotice(null);
    try {
      const response = await fetch("/api/command", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          map: simulation.map,
          packages: simulation.packages,
          couriers: simulation.couriers,
          mode: "auto",
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (requestRevision !== commandRequestRevision.current || latestCommandContext.current !== requestContext) return;
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
      const routeCategory = typeof record.routeCategory === "string" && record.routeCategory in commandRouteLabels
        ? record.routeCategory as NonNullable<CommandProposal["routeCategory"]>
        : undefined;
      const routedBy = record.routedBy === "typesafe" ? "typesafe" : undefined;
      const routerLatencyMs = typeof record.routerLatencyMs === "number" && Number.isFinite(record.routerLatencyMs) && record.routerLatencyMs >= 0
        ? record.routerLatencyMs
        : undefined;
      const result: CommandProposal = {
        commands: parsedCommands.data,
        clarification,
        provider: record.provider,
        routedBy,
        routeCategory,
        routerLatencyMs,
        model: record.model,
        latencyMs: record.latencyMs,
        contextKey: requestContext,
      };
      setProposal(result);
      setLastCommandCall({ provider: providerLabel(result.provider), latencyMs: result.latencyMs });
    } catch (error) {
      if (requestRevision === commandRequestRevision.current && !controller.signal.aborted) {
        setCommandError(error instanceof Error ? error.message : "Command preview failed.");
      }
    } finally {
      if (requestRevision === commandRequestRevision.current) {
        commandAbort.current = null;
        setCommandBusy(false);
        setCommandStartedAt(null);
      }
    }
  }

  function applyProposal() {
    if (!proposal || proposal.commands.length === 0) return;
    if (proposal.contextKey !== commandContext) {
      setProposal(null);
      setProposalNotice("The run changed after this preview. Review the current run and preview the command again.");
      return;
    }
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
      if (words) updateCommandText(words);
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

  const selectedCommandReady = Boolean(providerStatus?.jev.ready || providerStatus?.command.ready);
  const providerSummary = providerLoading ? "Checking status" : providerError ? "Status unavailable" : providerStatus ? "Status loaded" : "No status";
  const commandBar = (
    <section className="command-bar" id="command-bar" aria-labelledby="command-bar-title">
      <div className="command-bar-heading">
        <div>
          <h2 id="command-bar-title">What should happen?</h2>
          <p>Describe a delivery or a short sequence of route changes. Review each proposal before applying.</p>
        </div>
        <span className={`command-auto-status ${providerLoading ? "is-loading" : selectedCommandReady ? "is-ready" : "is-unavailable"}`}>
          <i aria-hidden="true" />{providerLoading ? "Checking" : selectedCommandReady ? "Auto" : "Check providers"}
        </span>
      </div>
      <form className="command-bar-form" onSubmit={handleCommandPreview}>
        <label className="visually-hidden" htmlFor="command-text">Give a delivery instruction</label>
        <textarea
          id="command-text"
          className="command-textarea"
          value={commandText}
          disabled={commandBusy}
          onChange={(event) => updateCommandText(event.target.value)}
          placeholder="Dispatch a package from North home to East home"
          rows={2}
        />
        <div className="command-bar-actions">
          <button className="voice-button" type="button" onClick={isListening ? stopVoiceInput : startVoiceInput} disabled={(!voiceSupported && !isListening) || commandBusy}>
            <span aria-hidden="true">{isListening ? "■" : "◉"}</span>{isListening ? "Stop dictation" : voiceSupported ? "Dictate" : "Voice unavailable"}
          </button>
          <button className="workbench-submit command-preview-button" type="submit" disabled={commandBusy || !commandText.trim()}>
            {commandBusy ? `Waiting · ${commandElapsedSeconds >= 60 ? `${Math.floor(commandElapsedSeconds / 60)}m ${commandElapsedSeconds % 60}s` : `${commandElapsedSeconds}s`}` : "Review command"}<span aria-hidden="true">↗</span>
          </button>
        </div>
        <p className="command-privacy-note">Speech recognition may process audio. Check the transcript before previewing.</p>
        {commandBusy ? <p className="scan-progress" role="status" aria-live="polite">Waiting for a command provider · {commandElapsedSeconds}s elapsed. Nothing is applied yet.</p> : null}
      </form>
      {proposal ? <div className="command-proposal" aria-live="polite">
        <div className="proposal-call-receipt">
          <span><i aria-hidden="true" />{providerLabel(proposal.provider)}</span>
          <span>{proposal.model}</span>
          <strong>{proposal.latencyMs} ms total</strong>
        </div>
        {commandRouteSummary(proposal) ? <p className="proposal-routing">{commandRouteSummary(proposal)}{proposal.routerLatencyMs !== undefined ? ` · ${proposal.routerLatencyMs} ms route` : ""}</p> : null}
        {proposal.clarification ? <p className="clarification-note">{proposal.clarification}</p> : null}
        {proposal.commands.length ? <>
          <div className="proposal-list-heading"><strong>Review changes</strong><span>{proposal.commands.length}</span></div>
          <ol className="command-proposal-list">
            {proposal.commands.map((command, index) => <li key={`${command.type}-${index}`}>
              <span className="command-index">{String(index + 1).padStart(2, "0")}</span>
              <span>{commandDescription(command, simulation.map)}</span>
              <button type="button" aria-label={`Remove proposed change ${index + 1}`} onClick={() => setProposal((current) => current ? { ...current, commands: current.commands.filter((_, commandIndex) => commandIndex !== index) } : current)}>Remove</button>
            </li>)}
          </ol>
          <button className="apply-proposal-button" type="button" onClick={applyProposal} disabled={!proposal.commands.length}>Confirm and apply</button>
        </> : proposal.clarification ? null : <p className="clarification-note">No changes were proposed.</p>}
      </div> : null}
    </section>
  );

  return (
    <section className="workbench-section" aria-label="Dispatch and diagnostics">
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {manualError ?? commandError ?? voiceError ?? manualNotice ?? proposalNotice ?? ""}
      </div>
      {manualError ? <p className="workspace-status workspace-status-error" role="alert">{manualError}</p> : null}
      {commandError ? <p className="workspace-status workspace-status-error" role="alert">{commandError}</p> : null}
      {proposalNotice ? <p className={`workspace-status ${proposalNotice.startsWith("Nothing") ? "workspace-status-error" : "workspace-status-success"}`} role="status">{proposalNotice}</p> : null}
      {manualNotice ? <p className="workspace-status workspace-status-success" role="status">{manualNotice}</p> : null}

      {commandBar}

      <details className="advanced-details">
        <summary className="disclosure-summary"><span><strong>More controls</strong><small>Manual dispatch · provider status</small></span></summary>
        <div className="advanced-body">
        <details className="dispatch-details" id="dispatch-details">
          <summary className="disclosure-summary">
            <span><strong>Manual dispatch</strong><small>Create, assign, or reprioritize packages</small></span>
            <span className="disclosure-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div className="dispatch-body">
          <section className="workbench-panel manual-panel" aria-labelledby="manual-title">
            <div className="workbench-panel-heading"><h3 id="manual-title">New delivery</h3><span className="command-readiness command-readiness-ready">Manual</span></div>
            <form className="manual-form" onSubmit={handleCreatePackage}>
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
                <label className="workbench-field"><span>Assign courier</span><select value={assignTo} onChange={(event) => setAssignTo(event.target.value)}>
                  <option value="">Keep queued</option>{simulation.couriers.map((courier) => <option key={courier.id} value={courier.id}>{courier.name} · {courier.packageIds.length}/{courier.capacity}</option>)}
                </select></label>
              </div>
              <button className="workbench-submit" type="submit" disabled={locations.length < 2 || currentFromId === currentToId}>
                {assignTo ? "Create and assign" : "Add to queue"}<span aria-hidden="true">↗</span>
              </button>
            </form>

            <details className="package-tools">
              <summary>Manage existing packages <span className="summary-chevron" aria-hidden="true">⌄</span></summary>
              <div className="manual-subforms">
                <form className="manual-form compact-manual-form" onSubmit={handleAssignPackage}>
                  <strong>Assign queued</strong>
                  {queuedPackages.length ? <div className="workbench-field-grid">
                    <label className="workbench-field"><span>Package</span><select value={currentAssignPackageId} onChange={(event) => setAssignPackageId(event.target.value)}>
                      {queuedPackages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.id} · {locations.find((location) => location.id === pkg.from)?.label ?? pkg.from}</option>)}
                    </select></label>
                    <label className="workbench-field"><span>Courier</span><select value={currentAssignCourierId} onChange={(event) => setAssignCourierId(event.target.value)}>
                      {simulation.couriers.map((courier) => <option key={courier.id} value={courier.id}>{courier.name} · {courier.packageIds.length}/{courier.capacity}</option>)}
                    </select></label>
                  </div> : <p className="workbench-empty-note">No queued packages.</p>}
                  <button className="workbench-secondary-submit" type="submit" disabled={!queuedPackages.length}>Assign package</button>
                </form>

                <form className="manual-form compact-manual-form" onSubmit={handlePriorityChange}>
                  <strong>Change priority</strong>
                  {editablePackages.length ? <div className="workbench-field-grid">
                    <label className="workbench-field"><span>Package</span><select value={currentPriorityPackageId} onChange={(event) => setPriorityPackageId(event.target.value)}>
                      {editablePackages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.id} · {pkg.priority}</option>)}
                    </select></label>
                    <label className="workbench-field"><span>New priority</span><select value={nextPriority} onChange={(event) => setNextPriority(event.target.value as "normal" | "urgent")}>
                      <option value="normal">Normal</option><option value="urgent">Urgent</option>
                    </select></label>
                  </div> : <p className="workbench-empty-note">No active packages.</p>}
                  <button className="workbench-secondary-submit" type="submit" disabled={!editablePackages.length}>Update priority</button>
                </form>
              </div>
            </details>
          </section>
          </div>

        </details>

      <details className="diagnostics-details" id="diagnostics-details">
        <summary className="disclosure-summary">
          <span><strong>Provider diagnostics</strong><small>{providerSummary} · last command {lastCommandCall ? `${lastCommandCall.provider} · ${lastCommandCall.latencyMs} ms` : "none"}</small></span>
          <span className="disclosure-chevron" aria-hidden="true">⌄</span>
        </summary>
        <section className="workbench-panel provider-panel" aria-labelledby="provider-title">
          <div className="workbench-panel-heading">
            <h3 id="provider-title">Provider readiness</h3>
            <button className="provider-refresh" type="button" onClick={() => void refreshProviderStatus()} disabled={providerLoading} aria-label="Refresh provider readiness">↻</button>
          </div>
          {providerLoading ? <p className="provider-loading" role="status">Checking provider readiness…</p> : providerError ? <p className="workbench-error" role="alert">{providerError}</p> : providerStatus ? <div className="provider-list">
            <ProviderRow label="Paper map reader" ready={providerStatus.image.ready} detail={`${providerStatus.image.detail} · ${providerStatus.image.model}`} />
            <ProviderRow label="Jev command interpreter" ready={providerStatus.jev.ready} detail={providerStatus.jev.model} />
            <ProviderRow label="Compound command interpreter" ready={providerStatus.command.ready} detail={`${providerStatus.command.detail} · ${providerStatus.command.model}`} />
            <ProviderRow label="Paid OpenAI API" ready={providerStatus.openaiApi.ready} detail={`${providerStatus.openaiApi.enabled ? "Enabled" : "Disabled"} · ${providerStatus.openaiApi.model}`} />
          </div> : null}
          <div className="provider-latency" aria-live="polite">
            <span>Last command provider call</span>
            <strong>{lastCommandCall ? `${lastCommandCall.provider} · ${lastCommandCall.latencyMs} ms` : "No command call yet"}</strong>
          </div>
        </section>
      </details>
        </div>
      </details>
    </section>
  );
}

function ProviderRow({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return <div className="provider-row">
    <div className="provider-row-top"><strong>{label}</strong><span className={`provider-status-dot ${ready ? "provider-status-ready" : ""}`}><i aria-hidden="true" />{ready ? "Ready" : "Unavailable"}</span></div>
    <span className="provider-detail">{detail}</span>
  </div>;
}
