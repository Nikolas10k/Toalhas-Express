/**
 * Região padrão da operação: centro dos mapas quando ainda não há pontos
 * (cliente sem localização, rota vazia). Operação atual: Brasília/DF.
 */
export const DEFAULT_MAP_CENTER: [number, number] = [-15.7939, -47.8828]; // Plano Piloto, Brasília
export const DEFAULT_MAP_ZOOM = 11;

/**
 * Preferência (não restrição) de região para o geocoding: ajuda endereços
 * típicos do DF (SQS/SQN, quadras, conjuntos) a caírem no lugar certo.
 * Formato do Google: "latSW,lngSW|latNE,lngNE".
 */
export const GEOCODE_BOUNDS_BIAS = '-16.06,-48.29|-15.49,-47.30'; // Distrito Federal
