// Captura de foto pela câmera do computador/tablet.
// O modal abre imediatamente; a câmera escolhida fica salva para as próximas capturas.
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

/**
 * @returns {Promise<{name:string,type:string,blob:Blob}|null>} null se o usuário cancelar
 */
export function openCamera(label = 'Foto') {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('Câmera não disponível neste dispositivo.'));

  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal modal--camera';
    dialog.innerHTML = `
      <div class="modal__header">
        <div><p class="eyebrow">Captura de foto</p><h2>${esc(label)}</h2></div>
        <button type="button" class="icon-btn" data-close aria-label="Fechar">${icon('x', 18)}</button>
      </div>
      <div class="camera__stage">
        <video class="camera__video" autoplay playsinline muted></video>
        <p class="camera__status" role="status">Iniciando câmera…</p>
      </div>
      <div class="modal__footer camera__footer">
        <select class="camera__select" aria-label="Câmera" hidden></select>
        <span class="camera__spacer"></span>
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="button" class="btn btn--primary" data-shoot disabled>${icon('camera', 17)} Capturar</button>
      </div>`;
    const video = $('video', dialog);
    const status = $('.camera__status', dialog);
    const select = $('.camera__select', dialog);
    const shoot = $('[data-shoot]', dialog);

    let stream = null;
    let attempt = 0;
    let closed = false;
    let result = null;

    const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };

    async function start(deviceId) {
      const my = ++attempt;
      stop();
      shoot.disabled = true;
      status.hidden = false;
      status.textContent = 'Iniciando câmera…';
      try {
        const s = await getStream(deviceId);
        if (closed || my !== attempt) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        video.srcObject = s;
        status.hidden = true;
        shoot.disabled = false;
        const active = s.getVideoTracks()[0]?.getSettings().deviceId;
        if (active) setPref('cameraId', active);
        await listDevices(active);
      } catch (err) {
        if (closed || my !== attempt) return;
        status.textContent = errorMessage(err);
        await listDevices(deviceId);
      }
    }

    async function listDevices(selectedId) {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      select.hidden = cams.length < 2;
      select.innerHTML = cams.map((d, i) =>
        `<option value="${esc(d.deviceId)}"${d.deviceId === selectedId ? ' selected' : ''}>${esc(d.label || `Câmera ${i + 1}`)}</option>`).join('');
    }

    select.addEventListener('change', () => start(select.value));
    dialog.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return dialog.close();
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
      dialog.remove();
      resolve(result);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    preferredCamera().catch(() => null).then(start);
  });
}
