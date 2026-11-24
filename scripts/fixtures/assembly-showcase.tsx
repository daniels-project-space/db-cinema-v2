import React from 'react';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssemblyShowcase } from '../../src/components/AssemblyShowcase';

const listing = (id: string, title: string, daily: number) => ({
  _id: id, title, slug: id, active: true, itemType: 'camera-body', category: 'camera',
  pricing: { daily }, specs: { mount: 'E', coverage: 'ff' },
  inventoryFacts: { owned: true, reviewRequired: false },
  components: [{ inventoryUnitId: id, qty: 1 }],
});

function Fixture() {
  const params = new URLSearchParams(location.search);
  const [loading, setLoading] = useState(params.has('loading'));
  const listings = loading || params.has('empty')
    ? []
    : [listing('camera-low', 'Sony A7 III body', 55), listing('camera-high', 'Sony FX3 body', 180)];
  (window as any).__setAssemblyLoading = setLoading;
  return <AssemblyShowcase listings={listings as any} loading={loading} />;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
