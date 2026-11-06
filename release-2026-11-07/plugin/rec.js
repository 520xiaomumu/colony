/* Colony Bridge · 后台录屏页(offscreen): bg 把调试接口抓到的帧传过来, 这里画到画布上录成 webm。
   不占 Colony 页面, 也不占页面和插件之间的通道。 */
'use strict';
const c = document.getElementById('c'), g = c.getContext('2d');
let rec = null, chunks = [], drawn = 0, t0 = 0, busy = false, pending = null;
async function draw(b64) {
  if (busy) { pending = b64; return; }   // 画不过来就只留最新一张
  busy = true;
  try {
    const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64)).blob());
    if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; }
    g.drawImage(bmp, 0, 0); bmp.close(); drawn++;
  } catch (e) { }
  busy = false;
  if (pending) { const p = pending; pending = null; draw(p); }
}
chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (!m || m.to !== 'offscreen-rec') return;
  if (m.op === 'start') {
    c.width = m.w || 1280; c.height = m.h || 720; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    const fps = m.fps || 30, stream = c.captureStream(fps);
    const mt = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    chunks = []; drawn = 0; t0 = Date.now();
    rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: m.bps || 6e6 });
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.start(1000);
    send({ ok: true, mimeType: mt });
  } else if (m.op === 'frame') {
    if (rec) draw(m.data);
    send(true);
  } else if (m.op === 'stop') {
    if (!rec) { send({ error: '没在录' }); return; }
    const r = rec; rec = null;
    r.onstop = () => {
      const blob = new Blob(chunks, { type: r.mimeType }), sec = (Date.now() - t0) / 1000;
      const fr = new FileReader();
      fr.onload = () => send({ ok: true, dataUrl: fr.result, bytes: blob.size, sec, frames: drawn, fps: +(drawn / sec).toFixed(1) });
      fr.readAsDataURL(blob);
    };
    r.stop();
    return true;
  } else if (m.op === 'status') {
    send({ recording: !!rec, frames: drawn, sec: rec ? (Date.now() - t0) / 1000 : 0 });
  }
});
