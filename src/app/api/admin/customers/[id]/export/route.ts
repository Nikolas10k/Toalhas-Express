import { NextResponse } from 'next/server';
import { route, uuidParam } from '@/server/http/route';
import { exportCustomerData } from '@/server/modules/customers/customers.service';

export const GET = route({
  auth: 'user',
  permission: 'customer.export',
  handler: async ({ actor, params }) => {
    const id = uuidParam(params);
    const data = await exportCustomerData(actor, id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="cliente-${id}.json"`,
      },
    });
  },
});
