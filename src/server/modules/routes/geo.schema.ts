import { z } from 'zod';

/** Geolocalização opcional do aparelho: registrada quando existe, nunca bloqueia. */
export const geoSchema = z
  .strictObject({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000).nullable().optional(),
  })
  .nullable()
  .optional()
  .transform((v) => v ?? null);
