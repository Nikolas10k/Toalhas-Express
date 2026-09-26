import { NextResponse } from 'next/server';
import { route, uuidParam } from '@/server/http/route';
import { rejectedRowsCsv } from '@/server/modules/customers/import.service';

export const GET = route({
  auth: 'user',
  permission: 'customer.import',
  handler: async ({ actor, params }) => {
    const { fileName, content } = await rejectedRowsCsv(actor, uuidParam(params));
    return new NextResponse(content, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
      },
    });
  },
});
