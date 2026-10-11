/* Explicit browser test fixture only. Does not run until loaded by the operator.
 * Use paperworldSyntheticCamera.stage('initial'|'blocked'|'reconnected'|'new-home', true)
 * then the actual Use camera / Capture frame controls. true shifts/scales/rotates.
 * Call restore() afterward. This does not establish physical camera support.
 */
(() => {
  window.paperworldSyntheticCamera?.restore();
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) throw new Error('MediaStream API unavailable in this browser.');
  const original = media.getUserMedia;
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 900;
  const context = canvas.getContext('2d');
  const feeds = new Map();
  let prepared = false;
  let requests = 0;

  async function stage(name, reposition = false) {
    if (!['initial', 'blocked', 'reconnected', 'new-home'].includes(name)) throw new Error('Unknown synthetic stage.');
    const source = name === 'new-home' ? 'reconnected' : name;
    const response = await fetch(`/demo/${source}.png`);
    if (!response.ok) throw new Error('Synthetic image could not be loaded.');
    const bitmap = await createImageBitmap(await response.blob());
    const paper = document.createElement('canvas');
    paper.width = 960;
    paper.height = 640;
    const drawing = paper.getContext('2d');
    drawing.drawImage(bitmap, 0, 0, 960, 640);
    bitmap.close();
    if (name === 'new-home') {
      drawing.strokeStyle = '#737f8c';
      drawing.lineWidth = 15;
      drawing.beginPath(); drawing.moveTo(735, 525); drawing.lineTo(890, 350); drawing.stroke();
      drawing.fillStyle = '#f0c36a'; drawing.strokeStyle = '#243244'; drawing.lineWidth = 3;
      drawing.beginPath(); drawing.arc(890, 350, 26, 0, Math.PI * 2); drawing.fill(); drawing.stroke();
      drawing.fillStyle = '#172033'; drawing.textAlign = 'center'; drawing.font = 'bold 20px Arial';
      drawing.fillText('N', 890, 357); drawing.font = 'bold 14px Arial'; drawing.fillText('NEW HOME N', 890, 398);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#ddd'; context.fillRect(0, 0, 1280, 900);
    context.save();
    if (reposition) { context.translate(220, 150); context.rotate(0.065); context.drawImage(paper, 0, 0, 850, 567); }
    else context.drawImage(paper, 100, 100, 1080, 720);
    context.restore();
    prepared = true;
    for (const stream of feeds.keys()) stream.getVideoTracks()[0]?.requestFrame();
    return { evidence: 'synthetic camera image', stage: name, reposition, width: 1280, height: 900 };
  }

  media.getUserMedia = async () => {
    if (!prepared) throw new Error('Prepare a synthetic stage first.');
    requests += 1;
    const stream = canvas.captureStream(0);
    const pump = () => {
      context.drawImage(canvas, 0, 0);
      stream.getVideoTracks()[0]?.requestFrame();
    };
    pump();
    const timer = setInterval(() => {
      const track = stream.getVideoTracks()[0];
      if (track.readyState === 'ended') { clearInterval(timer); feeds.delete(stream); }
      else pump();
    }, 100);
    feeds.set(stream, timer);
    return stream;
  };

  window.paperworldSyntheticCamera = {
    stage,
    get requests() { return requests; },
    get activeTracks() { return [...feeds.keys()].flatMap(stream => stream.getTracks()).filter(track => track.readyState === 'live').length; },
    restore() {
      for (const [stream, timer] of feeds) { clearInterval(timer); stream.getTracks().forEach(track => track.stop()); }
      feeds.clear();
      media.getUserMedia = original;
      delete window.paperworldSyntheticCamera;
    },
  };
})();
