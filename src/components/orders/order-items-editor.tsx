'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export type OrderType = 'DELIVERY' | 'COLLECTION' | 'DELIVERY_AND_COLLECTION';

export interface ItemDraft {
  key: string;
  productId: string;
  deliveryQuantity: number;
  collectionQuantity: number;
}

export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
}

export function newItem(): ItemDraft {
  return { key: crypto.randomUUID(), productId: '', deliveryQuantity: 0, collectionQuantity: 0 };
}

/** Converte para o payload da API conforme o tipo (zera o lado que não se aplica). */
export function itemsPayload(type: OrderType, items: ItemDraft[]) {
  return items
    .filter((i) => i.productId)
    .map((i) => ({
      productId: i.productId,
      deliveryQuantity: type === 'COLLECTION' ? 0 : i.deliveryQuantity,
      collectionQuantity: type === 'DELIVERY' ? 0 : i.collectionQuantity,
    }));
}

export function OrderItemsEditor({
  type,
  items,
  products,
  onChange,
}: {
  type: OrderType;
  items: ItemDraft[];
  products: CatalogProduct[];
  onChange: (items: ItemDraft[]) => void;
}) {
  const showDelivery = type !== 'COLLECTION';
  const showCollection = type !== 'DELIVERY';
  const update = (key: string, patch: Partial<ItemDraft>) => onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const used = new Set(items.map((i) => i.productId));
  const qty = (v: string) => Math.max(0, Math.min(100000, Math.trunc(Number(v) || 0)));

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={item.key} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
          <div className="min-w-48 flex-1 space-y-1">
            <label htmlFor={`item-${item.key}`} className="text-xs text-muted-foreground">
              Produto {idx + 1}
            </label>
            <Select id={`item-${item.key}`} value={item.productId} onChange={(e) => update(item.key, { productId: e.target.value })}>
              <option value="">Selecione…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id} disabled={used.has(p.id) && p.id !== item.productId}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </Select>
          </div>
          {showDelivery && (
            <div className="w-28 space-y-1">
              <label htmlFor={`del-${item.key}`} className="text-xs text-muted-foreground">
                Entregar
              </label>
              <Input
                id={`del-${item.key}`}
                type="number"
                inputMode="numeric"
                min={0}
                value={item.deliveryQuantity}
                onChange={(e) => update(item.key, { deliveryQuantity: qty(e.target.value) })}
              />
            </div>
          )}
          {showCollection && (
            <div className="w-28 space-y-1">
              <label htmlFor={`col-${item.key}`} className="text-xs text-muted-foreground">
                Coletar
              </label>
              <Input
                id={`col-${item.key}`}
                type="number"
                inputMode="numeric"
                min={0}
                value={item.collectionQuantity}
                onChange={(e) => update(item.key, { collectionQuantity: qty(e.target.value) })}
              />
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remover produto ${idx + 1}`}
            disabled={items.length === 1}
            onClick={() => onChange(items.filter((i) => i.key !== item.key))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      {items.length < Math.min(20, products.length) && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, newItem()])}>
          <Plus aria-hidden /> Adicionar produto
        </Button>
      )}
    </div>
  );
}
