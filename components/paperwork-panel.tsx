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
  pinnedLocationIds: ReadonlySet<string>;
  onApply: (map: PaperMap) => string | null;
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
    if (typeof error === "string" && error.trim()) return error;
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

export function PaperworkPanel({ previousMap, startsNewWorld, pinnedLocationIds, onApply }: PaperworkPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [proposal, setProposal] = useState<PaperMap | null>(null);

  const proposalValidation = useMemo(
    () => proposal ? paperMapSchema.safeParse(proposal) : null,
    [proposal],
  );

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!cameraStream) return;
    if (videoRef.current) videoRef.current.srcObject = cameraStream;
    return () => cameraStream.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  useEffect(() => () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  function clearReview() {
    setParseResult(null);
    setProposal(null);
    setScanError(null);
    setApplyError(null);
    setApplyMessage(null);
  }

  async function prepareFile(nextFile: File) {
    setImageError(null);
    clearReview();

    if (!ALLOWED_IMAGE_TYPES.has(nextFile.type)) {
      setFile(null);
      setImageData(null);
      setPreviewUrl(null);
      setImageError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (nextFile.size > MAX_IMAGE_BYTES) {
      setFile(null);
      setImageData(null);
      setPreviewUrl(null);
      setImageError(`This image is ${formatBytes(nextFile.size)}. The limit is 1.5 MB.`);
      return;
    }

    try {
      const dataUrl = await readDataUrl(nextFile);
      setFile(nextFile);
      setImageData(dataUrl);
      setPreviewUrl(URL.createObjectURL(nextFile));
    } catch (error) {
      setFile(null);
      setImageData(null);
      setPreviewUrl(null);
      setImageError(getErrorMessage(error, "The selected image could not be read."));
    }
  }

  async function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (selectedFile) await prepareFile(selectedFile);
  }

  async function openCamera() {
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
    setIsScanning(true);
    setScanError(null);
    setApplyError(null);
    setApplyMessage(null);
    setParseResult(null);
    setProposal(null);
    try {
      const response = await fetch("/api/parse-map", {
        method: "POST",
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
      setParseResult(parsed.data);
      setProposal(parsed.data.map);
    } catch (error) {
      setScanError(getErrorMessage(error, "The map could not be scanned. Your current world is unchanged."));
    } finally {
      setIsScanning(false);
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

  function removeLocation(locationId: string) {
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
    if (!proposal || !proposalValidation?.success || !parseResult?.requiresReview) return;
    setApplyError(null);
    const error = onApply(proposalValidation.data);
    if (error) {
      setApplyError(error);
      return;
    }
    setProposal(null);
    setApplyMessage(startsNewWorld
      ? "New world started. No sample packages or movement were carried over."
      : "Map applied. Existing simulation state was preserved.");
  }

  const canApply = Boolean(proposal && proposalValidation?.success && parseResult?.requiresReview);

  return (
    <section className="paperwork-panel" aria-labelledby="paperwork-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">PAPER INPUT</p>
          <h2 id="paperwork-title">Capture a route sketch</h2>
        </div>
        <span className="panel-index">01</span>
      </div>
      <p className="panel-description">
        Photograph or upload a paper map. The scan becomes a proposal for you to review.
      </p>

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
            <span className="paper-empty-title">Your sketch, translated</span>
            <span className="paper-empty-copy">The original stays here while you review the map proposal.</span>
          </div>
        )}
      </div>

      <div className="drawing-guide" aria-label="How to mark the paper map">
        <div className="drawing-guide-heading">
          <span className="section-kicker">DRAWING KEY</span>
          <strong>Make every connection explicit</strong>
        </div>
        <div className="drawing-guide-key" aria-label="Stop and road symbols">
          <span><i className="guide-node guide-depot">D</i>Depot</span>
          <span><i className="guide-node guide-home">H</i>Home</span>
          <span><i className="guide-node guide-shop">S</i>Shop</span>
          <span><i className="guide-node guide-junction">J</i>Junction</span>
          <span><i className="guide-road" aria-hidden="true" />Road · both ways</span>
          <span><i className="guide-closed" aria-hidden="true" />Closed road</span>
        </div>
        <p>Give each stop a distinct, readable label and reuse it where each road ends. Draw one continuous line to connect stops.</p>
        <p>Roads work both ways. Mark a closed road with a red X. Lines that meet are connected only at a labeled junction.</p>
      </div>

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
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        capture="environment"
        aria-label="Choose or capture a paper map image"
        onChange={handleFileInput}
        disabled={isScanning}
      />

      <div className="capture-actions">
        <button className="button button-secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={isScanning}>
          <span aria-hidden="true">↑</span> Upload photo
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

      {imageError ? <p className="inline-error" role="alert">{imageError}</p> : null}
      {cameraError ? <p className="inline-error" role="alert">{cameraError}</p> : null}
      {scanError ? <p className="inline-error" role="alert">{scanError}</p> : null}

      <button className="scan-button" type="button" onClick={analyzeImage} disabled={!imageData || isScanning || cameraOpen}>
        <span>{isScanning ? "Reading the drawing…" : "Read paper map"}</span>
        <span aria-hidden="true">{isScanning ? <span className="button-spinner" /> : "↗"}</span>
      </button>
      <p className="privacy-note">Nothing is sent until you choose <strong>Read paper map</strong>.</p>

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

      {proposal ? (
        <div className="proposal-area">
          <div className="proposal-heading">
            <div>
              <p className="section-kicker">EDITABLE PROPOSAL</p>
              <h3>Review the network</h3>
            </div>
            <span className="proposal-count">{proposal.locations.length} / {proposal.roads.length}</span>
          </div>
          <p className="proposal-subtext">Stops / roads · edits here do not change the running world.</p>

          {parseResult?.requiresReview ? (
            <div className="proposal-review-banner">
              <span aria-hidden="true">◌</span>
              <span>Check every stop and connection before applying.</span>
            </div>
          ) : null}

          <details className="proposal-editor" open>
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
                  <div className="proposal-location-row" key={location.id}>
                    <div className="proposal-row-top">
                      <label className="field-label" htmlFor={`location-label-${location.id}`}>Name</label>
                      <span className="proposal-id">{location.id}</span>
                    </div>
                    <div className="proposal-input-grid">
                      <input
                        id={`location-label-${location.id}`}
                        className="field-input location-name-input"
                        aria-label={`Name for ${location.id}`}
                        value={location.label}
                        maxLength={80}
                        onChange={(event) => updateLocation(location.id, { label: event.currentTarget.value })}
                      />
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
                    </div>
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
                      onChange={(event) => updateProposal((current) => ({
                        ...current,
                        roads: current.roads.map((candidate) => candidate.id === road.id
                          ? { ...candidate, from: event.currentTarget.value }
                          : candidate),
                      }))}
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
                      onChange={(event) => updateProposal((current) => ({
                        ...current,
                        roads: current.roads.map((candidate) => candidate.id === road.id
                          ? { ...candidate, to: event.currentTarget.value }
                          : candidate),
                      }))}
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
            <p className="validation-success"><span aria-hidden="true">✓</span> Map structure is valid for review.</p>
          )}

          {applyError ? <p className="inline-error" role="alert">{applyError}</p> : null}
          <button className="apply-map-button" type="button" onClick={handleApply} disabled={!canApply}>
            <span>{startsNewWorld ? "Apply & start this world" : "Apply map update"}</span>
            <span aria-hidden="true">↗</span>
          </button>
          {startsNewWorld ? (
            <p className="apply-note">Starting this scan replaces the labeled sample run with a fresh, empty simulation.</p>
          ) : (
            <p className="apply-note">Applying keeps courier positions, package assignments, priorities, and event history.</p>
          )}
        </div>
      ) : null}

      {applyMessage ? <p className="apply-success" role="status">{applyMessage}</p> : null}
    </section>
  );
}
