import React from 'react';
import { createRoot } from 'react-dom/client';
import { AssemblyShowcase } from '../../src/components/AssemblyShowcase';

const listing = (id: string, title: string, daily: number) => ({
  _id: id, title, slug: id, active: true, itemType: 'camera-body', category: 'camera',
  pricing: { daily }, specs: { mount: 'E', coverage: 'ff' },
  inventoryFacts: { owned: true, reviewRequired: false },
  components: [{ inventoryUnitId: id, qty: 1 }],
});

createRoot(document.getElementById('root')!).render(
  <AssemblyShowcase listings={[listing('camera-low', 'Sony A7 III body', 55), listing('camera-high', 'Sony FX3 body', 180)] as any} />,
);
