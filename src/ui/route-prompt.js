// Aviso discreto (não bloqueia a tela) oferecendo a navegação até o poço.
// Usado ao escolher o poço no cabeçalho e ao registrar um deslocamento na apropriação do BDO.
import { esc } from './dom.js';
import { icon } from './icons.js';

/** URLs de NAVEGAÇÃO com o poço como DESTINO (o ponto de partida é a posição atual do aparelho). */
export function routeLinks({ lat, lng }) {
  const la = Number(lat).toFixed(6);
  const ln = Number(lng).toFixed(6);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${la},${ln}&travelmode=driving`,
    waze: `https://waze.com/ul?ll=${la},${ln}&navigate=yes`,
    osm: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=%3B${la}%2C${ln}`
  };
}

let current = null;

export function closeRoutePrompt() {
  current?.remove();
  current = null;
}

/**
 * @param {{ title: string, message: string, target?: {lat:number,lng:number,nome?:string}|null, kind?: 'poco'|'deslocamento' }} o
 * Sem target: mostra só a mensagem (ex.: pedir para informar o poço).
 */
export function showRoutePrompt({ title, message, target, kind = 'poco' }) {
  closeRoutePrompt();
  const el = document.createElement('div');
  el.className = 'route-prompt';
  el.dataset.routePrompt = kind;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label', title);
  const links = target ? routeLinks(target) : null;
  el.innerHTML = `
    <div class="route-prompt__head">
      <span class="route-prompt__icon">${icon('navigation', 18)}</span>
      <div class="route-prompt__text">
        <strong>${esc(title)}</strong>
        <span>${esc(message)}</span>
      </div>
      <button type="button" class="icon-btn" data-route-close aria-label="Fechar">${icon('x', 16)}</button>
    </div>
    ${links ? `
      <div class="route-prompt__actions">
        <a class="btn btn--primary btn--sm" data-route-link="google" href="${links.google}" target="_blank" rel="noopener">${icon('navigation', 15)} Iniciar rota (Google Maps)</a>
        <a class="btn btn--ghost btn--sm" data-route-link="waze" href="${links.waze}" target="_blank" rel="noopener">Waze</a>
        <button type="button" class="btn btn--text btn--sm" data-route-close>Agora não</button>
      </div>` : ''}`;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-route-close], [data-route-link]')) closeRoutePrompt();
  });
  document.body.appendChild(el);
  current = el;
  return el;
}
