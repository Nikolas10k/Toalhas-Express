import { route } from '@/server/http/route';

/** Permite ao n8n validar o token configurado. */
export const GET = route({
  auth: 'integration',
  handler: async ({ actor }) => ({
    tokenId: actor.tokenId,
    name: actor.name,
    organizationId: actor.organizationId,
    permissions: [...actor.permissions].sort(),
  }),
});
