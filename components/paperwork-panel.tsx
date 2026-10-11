"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { paperMapSchema, type Location, type PaperMap } from "../lib/schema";

const MAX_IMAGE_BYTES = 1_500_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const parseResponseSchema = z.object({
  map: paperMapSchema,
  provider: z.enum(["codex", "openai"]),
  model: z.string().optional(),
  latencyMs: z.number().finite().nonnegative(),
  requiresReview: z.literal(true),
  reviewReasons: z.array(z.string()).optional(),
}).strict();

type ParseResponse = z.infer<typeof parseResponseSchema>;

type PaperworkPanelProps = {
  previousMap: PaperMap;
  startsNewWorld: boolean;
  mapRevision: number;
  pinnedLocationIds: ReadonlySet<string>;
  onApply: (map: PaperMap, startsFreshWorld: boolean) => string | null;
  onPauseSimulation: () => void;
  onFinishReview: () => void;
  onStartDemoDeliveries: () => string | null;
  demoStartAvailable: boolean;
};

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The selected image could not be read."));
    }, { once: true });
    reader.addEventListener("error", () => reject(new Error("The selected image could not be read.")), { once: true });
    reader.readAsDataURL(file);
  });
}

function getErrorMessage(value: unknown, fallback: string) {
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = value.error;
    if (typeof error === "string" && error.trim()) {
      const messages: Record<string, string> = {
        invalid_parse_request: "The image could not be validated. Choose a PNG, JPEG, or WebP file up to 1.5 MB.",
        unsupported_image: "This image format is not supported. Choose a PNG, JPEG, or WebP image.",
        rate_limited: "Too many scans were requested. Wait a moment, then try again.",
        provider_busy: "The map reader is handling another request. Try again in a moment; your current map is unchanged.",
        provider_timeout: "The map reader took too long to respond. Your current map is unchanged; try again.",
        codex_native_unavailable: "The map reader is unavailable on this app host. Check provider diagnostics or try again later.",
        codex_unavailable: "The signed-in map reader is unavailable. Check provider diagnostics or try again later.",
        openai_api_unavailable: "The OpenAI map reader is unavailable. Check provider diagnostics or try again later.",
        provider_invalid_output: "The map reader returned a result that could not be reviewed safely. Your map is unchanged; try again.",
        provider_invalid_response: "The map reader returned a result that could not be reviewed safely. Your map is unchanged; try again.",
        provider_invalid_map: "The map reader returned a map that could not be validated. Your map is unchanged; try again.",
        provider_failed: "The map reader could not complete the scan. Your map is unchanged; try again.",
      };
      return messages[error] ?? (/^[a-z][a-z0-9_]+$/.test(error) ? "The map scan could not be completed. Your current map is unchanged; check provider diagnostics and try again." : error);
    }
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    const message = value.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function nextId(prefix: "loc" | "road", used: Set<string>) {
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function formatBytes(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

export function PaperworkPanel({ previousMap, startsNewWorld, mapRevision, pinnedLocationIds, onApply, onPauseSimulation, onFinishReview, onStartDemoDeliveries, demoStartAvailable }: PaperworkPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const adjustDetailsRef = useRef<HTMLDetailsElement>(null);
  const locationKeys = useRef(new Map<string, string>());
  const fileReadRevision = useRef(0);
  const sampleLoadRevision = useRef(0);
  const scanRevision = useRef(0);
  const scanAbort = useRef<AbortController | null>(null);
  const demoStartLock = useRef(false);
  const latestMapRevision = useRef(mapRevision);
  const [file, setFile] = useState<File | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [demoStartError, setDemoStartError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanElapsedSeconds, setScanElapsedSeconds] = useState(0);
  const handledMapRevision = useRef(mapRevision);
  const [isScanning, setIsScanning] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [proposal, setProposal] = useState<PaperMap | null>(null);
  const [proposalOrigin, setProposalOrigin] = useState<"scan" | "manual" | null>(null);

  const proposalValidation = useMemo(
    () => proposal ? paperMapSchema.safeParse(proposal) : null,
    [proposal],
  );

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (demoStartAvailable) demoStartLock.current = false;
  }, [demoStartAvailable]);

  useEffect(() => {
    if (!isScanning || scanStartedAt === null) return;
    const updateElapsed = () => setScanElapsedSeconds(Math.floor((Date.now() - scanStartedAt) / 1_000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [isScanning, scanStartedAt]);

  useEffect(() => {
    if (!cameraStream) return;
    if (videoRef.current) videoRef.current.srcObject = cameraStream;
    return () => cameraStream.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  useEffect(() => () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  useEffect(() => {
    if (handledMapRevision.current === mapRevision) return;
    handledMapRevision.current = mapRevision;
    latestMapRevision.current = mapRevision;
    if (!scanAbort.current && !proposal && !parseResult) return;
    scanRevision.current += 1;
    scanAbort.current?.abort();
    scanAbort.current = null;
    setIsScanning(false);
    setScanStartedAt(null);
    setParseResult(null);
    setScanNotice(null);
    setApplyError(null);
    setApplyMessage(null);
    setScanError("The map changed while this review was open. Check the current route and scan again if needed.");
    if (adjustDetailsRef.current?.open) {
      setProposal(previousMap);
      setProposalOrigin("manual");
    } else {
      setProposal(null);
      setProposalOrigin(null);
    }
  }, [mapRevision, parseResult, previousMap, proposal]);

  function clearReview() {
    setParseResult(null);
    setProposal(null);
    setProposalOrigin(null);
    setScanError(null);
    setScanNotice(null);
    setApplyError(null);
    setApplyMessage(null);
  }

  async function prepareFile(nextFile: File) {
    onPauseSimulation();
    sampleLoadRevision.current += 1;
    const readRevision = ++fileReadRevision.current;
    scanRevision.current += 1;
    scanAbort.current?.abort();
    scanAbort.current = null;
    setIsScanning(false);
    setScanStartedAt(null);
    setIsPreparing(true);
    setFile(null);
    setImageData(null);
    setPreviewUrl(null);
    setImageError(null);
    clearReview();

    if (!ALLOWED_IMAGE_TYPES.has(nextFile.type)) {
      setIsPreparing(false);
      setImageError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (nextFile.size > MAX_IMAGE_BYTES) {
      setIsPreparing(false);
      setImageError(`This image is ${formatBytes(nextFile.size)}. The 1.5 MB limit is required for scanning. Choose a smaller image or capture a new frame.`);
      return;
    }

    try {
      const dataUrl = await readDataUrl(nextFile);
      if (readRevision !== fileReadRevision.current) return;
      setFile(nextFile);
      setImageData(dataUrl);
      setPreviewUrl(URL.createObjectURL(nextFile));
    } catch (error) {
      if (readRevision !== fileReadRevision.current) return;
      setImageError(getErrorMessage(error, "The selected image could not be read."));
    } finally {
      if (readRevision === fileReadRevision.current) setIsPreparing(false);
    }
  }

  async function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (selectedFile) await prepareFile(selectedFile);
  }

  async function loadSampleDrawing() {
    const requestRevision = ++sampleLoadRevision.current;
    setImageError(null);
    try {
      const response = await fetch("/demo/initial.png", { cache: "force-cache" });
      if (!response.ok) throw new Error("The sample drawing could not be loaded.");
      const blob = await response.blob();
      if (requestRevision !== sampleLoadRevision.current) return;
      await prepareFile(new File([blob], "sample-initial.png", { type: blob.type || "image/png" }));
    } catch (error) {
      if (requestRevision === sampleLoadRevision.current) {
        setImageError(getErrorMessage(error, "The sample drawing could not be loaded."));
      }
    }
  }

  async function openCamera() {
    onPauseSimulation();
    setCameraError(null);
    setCameraBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not supported here. Upload an image instead.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      setCameraStream(stream);
      setCameraOpen(true);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      const message = name === "NotAllowedError"
        ? "Camera permission was denied. You can still upload a photo."
        : name === "NotFoundError"
          ? "No camera was found. You can still upload a photo."
          : getErrorMessage(error, "The camera could not be opened. Upload an image instead.");
      setCameraError(message);
    } finally {
      setCameraBusy(false);
    }
  }

  function closeCamera() {
    setCameraOpen(false);
    setCameraStream(null);
  }

  async function captureCameraFrame() {
    onPauseSimulation();
    const video = videoRef.current;
    if (!video || video.videoWidth < 1 || video.videoHeight < 1) {
      setCameraError("The camera preview is still starting. Try capture again in a moment.");
      return;
    }

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1800 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("The camera frame could not be prepared. Upload an image instead.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async (blob) => {
      if (!blob) {
        setCameraError("The camera frame could not be saved. Try again or upload an image.");
        return;
      }
      const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : "webp";
      await prepareFile(new File([blob], `paper-map.${extension}`, { type: blob.type || "image/webp" }));
      closeCamera();
    }, "image/webp", 0.9);
  }

  async function analyzeImage() {
    if (!imageData || !file) return;
    onPauseSimulation();
    const requestRevision = ++scanRevision.current;
    const runRevision = mapRevision;
    const controller = new AbortController();
    scanAbort.current = controller;
    setIsScanning(true);
    setScanStartedAt(Date.now());
    setScanElapsedSeconds(0);
    setScanError(null);
    setScanNotice(null);
    setApplyError(null);
    setApplyMessage(null);
    setParseResult(null);
    setProposal(null);
    try {
      const response = await fetch("/api/parse-map", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imageData,
          ...(startsNewWorld ? {} : { previousMap }),
        }),
      });
      const responseBody: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(responseBody, `Map scan failed (${response.status}).`));
      }
      const parsed = parseResponseSchema.safeParse(responseBody);
      if (!parsed.success) {
        throw new Error("The map service returned an incomplete result. No map was changed.");
      }
      if (requestRevision !== scanRevision.current) return;
      if (runRevision !== latestMapRevision.current) {
        setScanError("The map changed while this scan was in progress. Read it again to build a current proposal.");
        return;
      }
      setParseResult(parsed.data);
      setProposal(parsed.data.map);
      setProposalOrigin("scan");
      setScanNotice(`${parsed.data.map.locations.length} stops · ${parsed.data.map.roads.length} roads · ${Math.round(parsed.data.latencyMs)} ms`);
      if (adjustDetailsRef.current) adjustDetailsRef.current.open = true;
    } catch (error) {
      if (requestRevision === scanRevision.current && !controller.signal.aborted) {
        setScanError(getErrorMessage(error, "The map could not be scanned. Your current world is unchanged."));
      }
    } finally {
      if (requestRevision === scanRevision.current) {
        scanAbort.current = null;
        setIsScanning(false);
        setScanStartedAt(null);
      }
    }
  }

  function updateProposal(updater: (current: PaperMap) => PaperMap) {
    setProposal((current) => current ? updater(current) : current);
    setApplyError(null);
    setApplyMessage(null);
  }

  function updateLocation(id: string, changes: Partial<Location>) {
    updateProposal((current) => ({
      ...current,
      locations: current.locations.map((location) => location.id === id ? { ...location, ...changes } : location),
    }));
  }

  function updateLocationId(id: string, nextId: string) {
    const existing = previousMap.locations.find((location) => location.id === nextId);
    if (existing && id !== nextId) matchExistingLocation(id, nextId);
    else {
      locationKeys.current.set(nextId, locationKeys.current.get(id) ?? id);
      updateLocation(id, { id: nextId });
    }
  }

  function matchExistingLocation(id: string, existingId: string) {
    const existing = previousMap.locations.find((location) => location.id === existingId);
    if (!existing) return;
    const stableKey = locationKeys.current.get(id) ?? id;
    locationKeys.current.set(existingId, stableKey);
    updateProposal((current) => ({
      ...current,
      locations: current.locations.map((location) => location.id === id
        ? { ...location, id: existing.id, x: existing.x, y: existing.y }
        : location),
      roads: current.roads.map((road) => ({
        ...road,
        from: road.from === id ? existing.id : road.from,
        to: road.to === id ? existing.id : road.to,
      })),
    }));
  }

  function removeLocation(locationId: string) {
    locationKeys.current.delete(locationId);
    updateProposal((current) => ({
      locations: current.locations.filter((location) => location.id !== locationId),
      roads: current.roads.filter((road) => road.from !== locationId && road.to !== locationId),
    }));
  }

  function addLocation() {
    updateProposal((current) => {
      const id = nextId("loc", new Set(current.locations.map((location) => location.id)));
      return {
        ...current,
        locations: [...current.locations, { id, label: "New stop", kind: "junction", x: 50, y: 50 }],
      };
    });
  }

  function addRoad() {
    updateProposal((current) => {
      const first = current.locations[0];
      const second = current.locations.find((location) => location.id !== first?.id);
      if (!first || !second) return current;
      const id = nextId("road", new Set(current.roads.map((road) => road.id)));
      return { ...current, roads: [...current.roads, { id, from: first.id, to: second.id, closed: false }] };
    });
  }

  function handleApply() {
    if (!proposal || !proposalValidation?.success) return;
    if (proposalOrigin === "scan" && !parseResult?.requiresReview) return;
    const startsFreshWorld = proposalOrigin === "scan" && startsNewWorld;
    onFinishReview();
    setApplyError(null);
    const error = onApply(proposalValidation.data, startsFreshWorld);
    if (error) {
      setApplyError(error);
      return;
    }
    setProposal(null);
    setProposalOrigin(null);
    setParseResult(null);
    setScanNotice(null);
    if (adjustDetailsRef.current) adjustDetailsRef.current.open = false;
    setApplyMessage(startsFreshWorld
      ? "Map confirmed. Start deliveries when you are ready."
      : "Map changes confirmed. Positions and progress were preserved; playback is paused.");
    setDemoStartError(null);
    demoStartLock.current = false;
  }

  function handleAdjustToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open && !proposal) {
      onPauseSimulation();
      setProposal(previousMap);
      setProposalOrigin("manual");
      setParseResult(null);
      setApplyError(null);
      setApplyMessage(null);
      setScanError(null);
    }
  }

  function handleStartDemoDeliveries() {
    if (!demoStartAvailable || demoStartLock.current) return;
    demoStartLock.current = true;
    setDemoStartError(null);
    const error = onStartDemoDeliveries();
    if (error) {
      demoStartLock.current = false;
      setDemoStartError(error);
      return;
    }
    setApplyMessage("Two demo deliveries were assigned and are moving.");
  }

  const canApply = Boolean(
    proposal && proposalValidation?.success && (proposalOrigin === "manual" || parseResult?.requiresReview),
  );

  return (
    <section id="paperwork-panel" className="paperwork-panel" aria-labelledby="paperwork-title">
      <div className="panel-heading">
        <div>
          <h2 id="paperwork-title">Paper map</h2>
        </div>
        <span className="panel-status">{parseResult ? "Ready to review" : isPreparing ? "Preparing image" : "Scan a sketch"}</span>
      </div>

      <div className={`paper-preview ${previewUrl ? "paper-preview-has-image" : ""}`}>
        {cameraOpen ? (
          <div className="camera-view">
            <video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" />
            <span className="camera-frame-mark camera-frame-mark-tl" aria-hidden="true" />
            <span className="camera-frame-mark camera-frame-mark-tr" aria-hidden="true" />
            <span className="camera-frame-mark camera-frame-mark-bl" aria-hidden="true" />
            <span className="camera-frame-mark camera-frame-mark-br" aria-hidden="true" />
          </div>
        ) : previewUrl ? (
          <div className="paper-image-wrap">
            {/* Local object URL only; the image is sent only after Scan is pressed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Selected paper route map" className="paper-image" />
            <span className="paper-image-overlay">READY TO SCAN</span>
          </div>
        ) : (
          <div className="paper-empty-state">
            <svg className="paper-sketch" viewBox="0 0 150 120" aria-hidden="true">
              <path d="M28 13h68l24 23v71H28z" />
              <path d="M96 13v23h24M42 51h31m-31 13h18m3 0 17 15 18-18 14 9" />
              <circle cx="60" cy="64" r="4" />
              <circle cx="80" cy="79" r="4" />
              <circle cx="98" cy="61" r="4" />
              <path d="M49 92h49" />
            </svg>
            <span className="paper-empty-title">Choose a route sketch</span>
          </div>
        )}
      </div>

      <details className="drawing-guide">
        <summary>Drawing key</summary>
        <div className="drawing-guide-key" aria-label="Stop and road symbols">
          <span><i className="guide-node guide-depot">D</i>Depot</span>
          <span><i className="guide-node guide-home">H</i>Home</span>
          <span><i className="guide-node guide-shop">S</i>Shop</span>
          <span><i className="guide-node guide-junction">J</i>Junction</span>
          <span><i className="guide-road" aria-hidden="true" />Two-way road</span>
          <span><i className="guide-closed" aria-hidden="true" />Closed road</span>
        </div>
        <p>Label each stop. Roads go both ways; use a red X to close one. Lines connect only at a labeled stop.</p>
      </details>

      {file ? (
        <div className="selected-file" aria-live="polite">
          <span className="selected-file-icon" aria-hidden="true">↳</span>
          <span className="selected-file-name">{file.name}</span>
          <span className="selected-file-size">{formatBytes(file.size)}</span>
        </div>
      ) : (
        <p className="upload-note">PNG, JPEG, or WebP · up to 1.5 MB</p>
      )}

      <input
        ref={fileInputRef}
        id="paper-map-input"
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        capture="environment"
        aria-label="Choose or capture a paper map image"
        onChange={handleFileInput}
      />

      <div className="capture-actions">
        <button className="button button-secondary" type="button" onClick={() => fileInputRef.current?.click()}>
          <span aria-hidden="true">↑</span> Upload photo
        </button>
        <button className="button button-quiet" type="button" onClick={() => void loadSampleDrawing()} disabled={isPreparing}>
          Use sample sketch
        </button>
        {cameraOpen ? (
          <>
            <button className="button button-primary" type="button" onClick={captureCameraFrame}>
              Capture frame
            </button>
            <button className="button button-quiet" type="button" onClick={closeCamera}>Close camera</button>
          </>
        ) : (
          <button className="button button-quiet" type="button" onClick={openCamera} disabled={cameraBusy || isScanning}>
            {cameraBusy ? "Opening…" : "Use camera"}
          </button>
        )}
      </div>

      {isPreparing ? <p className="scan-status" role="status">Preparing image…</p> : null}
      {isScanning ? <p className="scan-progress" role="status" aria-live="polite">Reading map · {scanElapsedSeconds >= 60 ? `${Math.floor(scanElapsedSeconds / 60)}m ${scanElapsedSeconds % 60}s` : `${scanElapsedSeconds}s`} elapsed. Nothing is applied yet.</p> : null}
      {imageError ? <p className="inline-error" role="alert">{imageError}</p> : null}
      {cameraError ? <p className="inline-error" role="alert">{cameraError}</p> : null}
      {scanError ? <p className="inline-error" role="alert">{scanError}</p> : null}

      <button className="scan-button" type="button" onClick={analyzeImage} disabled={!imageData || isPreparing || isScanning || cameraOpen}>
        <span>{isScanning ? "Reading map…" : "Read paper map"}</span>
        <span aria-hidden="true">{isScanning ? <span className="button-spinner" /> : "↗"}</span>
      </button>
      <p className="privacy-note">The image is sent only when you choose Read paper map.</p>
      {scanNotice ? <p className="scan-status" role="status">{scanNotice} · review required</p> : null}

      {parseResult ? (
        <div className="parse-receipt" aria-live="polite">
          <div className="receipt-topline">
            <span className="receipt-status-mark" aria-hidden="true" />
            <span>SCAN COMPLETE · REVIEW REQUIRED</span>
          </div>
          <div className="receipt-details">
            <span><strong>{parseResult.provider.toUpperCase()}</strong>{parseResult.model ? ` · ${parseResult.model}` : " provider"}</span>
            <span>{Math.round(parseResult.latencyMs)} ms</span>
          </div>
          <div className="receipt-details receipt-details-muted">
            <span>{proposal?.locations.length ?? parseResult.map.locations.length} stops</span>
            <span>{proposal?.roads.length ?? parseResult.map.roads.length} roads</span>
          </div>
          {parseResult.reviewReasons?.length ? (
            <ul className="review-reasons">
              {parseResult.reviewReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      <details ref={adjustDetailsRef} id="adjust-details" className={`proposal-area${proposal ? " has-proposal" : ""}`} onToggle={handleAdjustToggle}>
        <summary className="adjust-summary">
          <span><strong>Adjust map</strong><small>{proposal ? proposalOrigin === "manual" ? "Edit the current route" : "Edit the scanned proposal" : "Open the current route editor"}</small></span>
          <span className="proposal-count">{proposal ? `${proposal.locations.length} stops · ${proposal.roads.length} roads` : ""}</span>
          <span className="summary-chevron" aria-hidden="true">⌄</span>
        </summary>
        {proposal ? (
          <div className="proposal-content">
          <div className="proposal-heading">
            <div>
              <p className="section-kicker">{proposalOrigin === "manual" ? "CURRENT ROUTE" : "PROPOSED MAP"}</p>
              <h3>{proposalOrigin === "manual" ? "Edit network" : "Review before applying"}</h3>
            </div>
            <span className="proposal-count">{proposal.locations.length} / {proposal.roads.length}</span>
          </div>

          {proposalOrigin === "scan" && parseResult?.requiresReview ? (
            <div className="proposal-review-banner">
              <span>Review stops and connections before applying.</span>
            </div>
          ) : null}

          <details className="proposal-editor">
            <summary>
              <span>Stops</span>
              <span className="summary-count">{proposal.locations.length}</span>
              <span className="summary-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="proposal-list">
              {proposal.locations.map((location) => {
                const pinned = !startsNewWorld && pinnedLocationIds.has(location.id);
                const canRemove = !pinned && proposal.locations.length > 1;
                return (
                <div className="proposal-location-row" key={locationKeys.current.get(location.id) ?? location.id}>
                    <div className="proposal-input-grid location-input-grid">
                      <label className="proposal-field"><span>Name</span><input
                        id={`location-label-${location.id}`}
                        className="field-input location-name-input"
                        aria-label={`Name for ${location.id}`}
                        value={location.label}
                        maxLength={80}
                        onChange={(event) => updateLocation(location.id, { label: event.currentTarget.value })}
                      /></label>
                      <select
                        className="field-input"
                        aria-label={`Type for ${location.label}`}
                        value={location.kind}
                        onChange={(event) => updateLocation(location.id, { kind: event.currentTarget.value as Location["kind"] })}
                      >
                        <option value="depot">Depot</option>
                        <option value="home">Home</option>
                        <option value="shop">Shop</option>
                        <option value="junction">Junction</option>
                      </select>
                      <label className="proposal-field proposal-field-id"><span>ID</span><input
                        className="field-input"
                        aria-label={`ID for ${location.label}`}
                        value={location.id}
                        maxLength={24}
                        disabled={pinned}
                        onChange={(event) => updateLocationId(location.id, event.currentTarget.value)}
                      /></label>
                    </div>
                    {proposalOrigin === "scan" && !startsNewWorld ? (() => {
                      const availableMatches = previousMap.locations.filter((existing) =>
                        !proposal.locations.some((candidate) => candidate.id === existing.id && candidate.id !== location.id),
                      );
                      return availableMatches.length ? <label className="match-location-field">
                        <span>Match current stop</span>
                        <select className="field-input" aria-label={`Match ${location.label} to a current stop`} value="" onChange={(event) => {
                          if (event.currentTarget.value) matchExistingLocation(location.id, event.currentTarget.value);
                        }}>
                          <option value="">Choose a stop to keep its position</option>
                          {availableMatches.map((existing) => <option key={existing.id} value={existing.id}>{existing.label} · {existing.id}</option>)}
                        </select>
                      </label> : null;
                    })() : null}
                    <div className="proposal-coordinate-row">
                      <label className="coordinate-field">
                        <span>X</span>
                        <input
                          className="field-input field-input-numeric"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={location.x}
                          disabled={pinned}
                          aria-label={`X coordinate for ${location.label}`}
                          onChange={(event) => updateLocation(location.id, { x: Number(event.currentTarget.value) })}
                        />
                      </label>
                      <label className="coordinate-field">
                        <span>Y</span>
                        <input
                          className="field-input field-input-numeric"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={location.y}
                          disabled={pinned}
                          aria-label={`Y coordinate for ${location.label}`}
                          onChange={(event) => updateLocation(location.id, { y: Number(event.currentTarget.value) })}
                        />
                      </label>
                      <button
                        className="remove-button"
                        type="button"
                        aria-label={`Remove ${location.label}`}
                        title={pinned ? "This stop is used by active simulation state" : "Remove stop and connected roads"}
                        disabled={!canRemove}
                        onClick={() => removeLocation(location.id)}
                      >
                        Remove
                      </button>
                    </div>
                    {pinned ? <p className="pinned-note">Pinned by active simulation state</p> : null}
                  </div>
                );
              })}
            </div>
            <button
              className="editor-add-button"
              type="button"
              onClick={addLocation}
              disabled={proposal.locations.length >= 32}
            >
              <span aria-hidden="true">＋</span> Add stop
            </button>
          </details>

          <details className="proposal-editor">
            <summary>
              <span>Roads</span>
              <span className="summary-count">{proposal.roads.length}</span>
              <span className="summary-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="proposal-list proposal-road-list">
              {proposal.roads.map((road) => (
                <div className="proposal-road-row" key={road.id}>
                  <div className="proposal-row-top">
                    <span className="proposal-id">{road.id}</span>
                    <button
                      className={`road-state ${road.closed ? "road-state-closed" : ""}`}
                      type="button"
                      aria-pressed={road.closed}
                      onClick={() => updateProposal((current) => ({
                        ...current,
                        roads: current.roads.map((candidate) => candidate.id === road.id
                          ? { ...candidate, closed: !candidate.closed }
                          : candidate),
                      }))}
                    >
                      <span aria-hidden="true" />{road.closed ? "Closed" : "Open"}
                    </button>
                  </div>
                  <div className="proposal-input-grid">
                    <label className="visually-hidden" htmlFor={`road-from-${road.id}`}>Road start</label>
                    <select
                      id={`road-from-${road.id}`}
                      className="field-input"
                      value={road.from}
                      aria-label={`Start of ${road.id}`}
                      onChange={(event) => {
                        const from = event.currentTarget.value;
                        updateProposal((current) => ({
                          ...current,
                          roads: current.roads.map((candidate) => candidate.id === road.id
                            ? { ...candidate, from }
                            : candidate),
                        }));
                      }}
                    >
                      {proposal.locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
                    </select>
                    <span className="road-direction-arrow" aria-hidden="true">→</span>
                    <label className="visually-hidden" htmlFor={`road-to-${road.id}`}>Road end</label>
                    <select
                      id={`road-to-${road.id}`}
                      className="field-input"
                      value={road.to}
                      aria-label={`End of ${road.id}`}
                      onChange={(event) => {
                        const to = event.currentTarget.value;
                        updateProposal((current) => ({
                          ...current,
                          roads: current.roads.map((candidate) => candidate.id === road.id
                            ? { ...candidate, to }
                            : candidate),
                        }));
                      }}
                    >
                      {proposal.locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
                    </select>
                  </div>
                  <button
                    className="remove-button remove-road-button"
                    type="button"
                    aria-label={`Remove ${road.id}`}
                    onClick={() => updateProposal((current) => ({
                      ...current,
                      roads: current.roads.filter((candidate) => candidate.id !== road.id),
                    }))}
                  >
                    Remove road
                  </button>
                </div>
              ))}
            </div>
            <button
              className="editor-add-button"
              type="button"
              onClick={addRoad}
              disabled={proposal.locations.length < 2 || proposal.roads.length >= 64}
            >
              <span aria-hidden="true">＋</span> Add road
            </button>
          </details>

          {proposalValidation && !proposalValidation.success ? (
            <p className="inline-error validation-error" role="alert">
              {proposalValidation.error.issues[0]?.message ?? "Review the map fields before applying."}
            </p>
          ) : (
            <p className="validation-success"><span aria-hidden="true">✓</span> Stops, IDs, and road endpoints are valid.</p>
          )}

          {applyError ? <p className="inline-error" role="alert">{applyError}</p> : null}
          <button className="apply-map-button" type="button" onClick={handleApply} disabled={!canApply}>
            <span>{proposalOrigin === "scan" ? startsNewWorld ? "Confirm map" : "Confirm changes" : "Apply map update"}</span>
            <span aria-hidden="true">↗</span>
          </button>
          </div>
        ) : <p className="adjust-empty-state">Scan a sketch to review and edit its stops, IDs, connections, and road status.</p>}
      </details>

      {applyMessage ? <p className="apply-success" role="status">{applyMessage}</p> : null}
      {demoStartAvailable ? <div className="demo-start-panel">
        <div><strong>Map confirmed</strong><span>Start a demo with two labeled deliveries and two couriers.</span></div>
        <button className="demo-start-button" type="button" onClick={handleStartDemoDeliveries}>Start deliveries <span aria-hidden="true">▶</span></button>
      </div> : null}
      {demoStartError ? <p className="inline-error" role="alert">{demoStartError}</p> : null}
    </section>
  );
}
