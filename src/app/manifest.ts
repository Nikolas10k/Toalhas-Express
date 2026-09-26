import type { MetadataRoute } from 'next';

/** PWA: instalável no celular. O app do motorista é o principal uso (mobile first). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Toalhas Express',
    short_name: 'Toalhas Express',
    description: 'Gestão de locação de toalhas: rotas, entregas e coletas.',
    start_url: '/motorista',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0A9CD0',
    lang: 'pt-BR',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Minha rota', url: '/motorista' },
      { name: 'Portal do cliente', url: '/portal' },
    ],
  };
}
