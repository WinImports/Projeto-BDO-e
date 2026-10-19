// Distâncias para o KM rodado (offline: não depende de serviço de rotas).
// Estrada ≠ linha reta: a estimativa aplica um fator de sinuosidade típico de estradas vicinais.

export const FATOR_ESTRADA = 1.3;

/** Distância em linha reta (km) entre dois pontos { lat, lng }. */
export function haversineKm(a, b) {
  const rad = (g) => (Number(g) * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** KM estimado por estrada, com 1 casa decimal. */
export const kmEstrada = (a, b) => Math.round(haversineKm(a, b) * FATOR_ESTRADA * 10) / 10;

/** Posição atual do aparelho (rejeita se não houver GPS / permissão). */
export function posicaoAtual({ timeout = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocalização indisponível'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout, maximumAge: 60_000 }
    );
  });
}
