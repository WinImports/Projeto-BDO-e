// Captura de foto pela câmera (celular, tablet ou computador), em tela cheia.
// Controles FIXOS numa barra inferior (Fechar · Tirar Foto · Alternar câmera) que o pinch-zoom do
// navegador não consegue deslocar; zoom da própria câmera (+ / − / barra) quando o aparelho suporta.
// A câmera escolhida fica salva para as próximas capturas.
import { icon } from './icons.js';
import { esc, $ } from './dom.js';
import { getPref, setPref } from '../core/prefs.js';

const START_TIMEOUT_MS = 10_000;

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

const errorMessage = (err) =>
  err.name === 'NotFoundError' ? 'Nenhuma câmera encontrada. Use a opção "Arquivo".'
  : err.name === 'NotAllowedError' ? 'Acesso à câmera negado.'
  : err.name === 'NotReadableError' ? 'A câmera está em uso por outro programa.'
  : err.name === 'Timeout' ? 'A câmera não respondeu. Tente outra câmera na lista ou use a opção "Arquivo".'
  : `Não foi possível abrir a câmera (${err.name || err.message}).`;

// Câmeras virtuais (streaming/captura de tela) costumam não entregar imagem; evitamos por padrão
const VIRTUAL_CAMERA = /virtual|ndi|obs|manycam|snap camera|xsplit|droidcam|epoccam|splitcam/i;

async function preferredCamera() {
  const saved = getPref('cameraId', null);
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  if (saved && cams.some((d) => d.deviceId === saved)) return saved;
  return cams.find((d) => d.label && !VIRTUAL_CAMERA.test(d.label))?.deviceId || null;
}

function getStream(deviceId) {
  const video = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } };
  const request = navigator.mediaDevices.getUserMedia({ video, audio: false });
  const timeout = new Promise((_, reject) => setTimeout(() => {
    request.then((s) => s.getTracks().forEach((t) => t.stop()), () => {}); // libera se chegar atrasado
    reject(Object.assign(new Error('timeout'), { name: 'Timeout' }));
  }, START_TIMEOUT_MS));
  return Promise.race([request, timeout]);
}

const stopGesture = (e) => e.preventDefault(); // iOS: bloqueia o pinch-zoom da página com a câmera aberta

/**
 * @returns {Promise<{name:string,type:string,blob:Blob}|null>} null se o usuário cancelar
 */
export function openCamera(label = 'Foto') {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('Câmera não disponível neste dispositivo.'));

  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'camera-full';
    dialog.setAttribute('aria-label', `Câmera — ${label}`);
    dialog.innerHTML = `
      <div class="camera__top"><span class="camera__title">${esc(label)}</span></div>
      <div class="camera__stage">
        <video class="camera__video" autoplay playsinline muted></video>
        <p class="camera__status" role="status">Iniciando câmera…</p>
      </div>
      <div class="camera__zoom" hidden>
        <button type="button" class="camera__zbtn" data-zoom="-" aria-label="Diminuir zoom">−</button>
        <input type="range" class="camera__zrange" data-zoom-range aria-label="Zoom da câmera">
        <button type="button" class="camera__zbtn" data-zoom="+" aria-label="Aumentar zoom">+</button>
        <span class="camera__zlabel" data-zoom-label>1×</span>
      </div>
      <div class="camera__bar" role="toolbar" aria-label="Controles da câmera">
        <button type="button" class="camera__btn" data-close aria-label="Fechar câmera">${icon('x', 24)}</button>
        <button type="button" class="camera__shutter" data-shoot disabled aria-label="Tirar Foto"><span class="camera__shutter-ring"></span><span class="camera__shutter-label">Tirar Foto</span></button>
        <button type="button" class="camera__btn" data-switch aria-label="Alternar câmera" hidden>${icon('repeat', 24)}</button>
      </div>`;
    const video = $('video', dialog);
    const status = $('.camera__status', dialog);
    const shoot = $('[data-shoot]', dialog);
    const switchBtn = $('[data-switch]', dialog);
    const zoomBox = $('.camera__zoom', dialog);
    const zoomRange = $('[data-zoom-range]', dialog);
    const zoomLabel = $('[data-zoom-label]', dialog);

    let stream = null;
    let attempt = 0;
    let closed = false;
    let result = null;
    let cams = [];
    let activeId = null;

    const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
    const track = () => stream?.getVideoTracks()[0];

    // Zoom da câmera (MediaStreamTrack): só aparece se o aparelho expõe "zoom" nas capacidades
    function setupZoom() {
      const caps = track()?.getCapabilities?.() || {};
      if (!caps.zoom || !(caps.zoom.max > caps.zoom.min)) { zoomBox.hidden = true; return; }
      zoomRange.min = caps.zoom.min;
      zoomRange.max = caps.zoom.max;
      zoomRange.step = caps.zoom.step || 0.1;
      zoomRange.value = track().getSettings().zoom ?? caps.zoom.min;
      zoomLabel.textContent = `${Number(zoomRange.value).toFixed(1)}×`;
      zoomBox.hidden = false;
    }
    async function applyZoom(v) {
      const z = Math.min(Number(zoomRange.max), Math.max(Number(zoomRange.min), Number(v)));
      zoomRange.value = z;
      zoomLabel.textContent = `${z.toFixed(1)}×`;
      try { await track()?.applyConstraints({ advanced: [{ zoom: z }] }); } catch { /* câmera recusou o valor */ }
    }

    async function start(deviceId) {
      const my = ++attempt;
      stop();
      shoot.disabled = true;
      zoomBox.hidden = true;
      status.hidden = false;
      status.textContent = 'Iniciando câmera…';
      try {
        const st = await getStream(deviceId);
        if (closed || my !== attempt) { st.getTracks().forEach((t) => t.stop()); return; }
        stream = st;
        video.srcObject = st;
        // "Tirar Foto" só com imagem na tela (antes disso a foto sairia vazia)
        await new Promise((ok) => {
          if (video.videoWidth) return ok();
          video.addEventListener('loadeddata', ok, { once: true });
          setTimeout(ok, 4000);
        });
        if (closed || my !== attempt) return;
        status.hidden = true;
        shoot.disabled = !video.videoWidth;
        if (!video.videoWidth) { status.hidden = false; status.textContent = 'A câmera não enviou imagem. Tente alternar a câmera ou use a opção "Arquivo".'; }
        activeId = st.getVideoTracks()[0]?.getSettings().deviceId || deviceId;
        if (activeId) setPref('cameraId', activeId);
        setupZoom();
        await listDevices();
      } catch (err) {
        if (closed || my !== attempt) return;
        status.textContent = errorMessage(err);
        await listDevices();
      }
    }

    async function listDevices() {
      cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      switchBtn.hidden = cams.length < 2;
    }

    zoomRange.addEventListener('input', () => applyZoom(zoomRange.value));
    dialog.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return dialog.close();
      const z = e.target.closest('[data-zoom]');
      if (z) {
        const step = (Number(zoomRange.max) - Number(zoomRange.min)) / 10 || 0.5;
        return applyZoom(Number(zoomRange.value) + (z.dataset.zoom === '+' ? step : -step));
      }
      if (e.target.closest('[data-switch]') && cams.length > 1) {
        const i = cams.findIndex((c) => c.deviceId === activeId);
        return start(cams[(i + 1) % cams.length].deviceId);
      }
      if (!e.target.closest('[data-shoot]') || !stream) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      if (blob) {
        const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
        result = { name: `${slug(label) || 'foto'}-${stamp}.jpg`, type: 'image/jpeg', blob };
      }
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      closed = true;
      stop();
      document.removeEventListener('gesturestart', stopGesture);
      document.documentElement.classList.remove('camera-open');
      dialog.remove();
      resolve(result);
    });

    document.addEventListener('gesturestart', stopGesture, { passive: false });
    document.documentElement.classList.add('camera-open');
    document.body.appendChild(dialog);
    dialog.showModal();
    preferredCamera().catch(() => null).then(start);
  });
}
