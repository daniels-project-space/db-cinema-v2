import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CatalogRevisionGuard } from '../../src/components/CatalogRevisionGuard';

function App() {
  const [renderedRevision, setRenderedRevision] = useState('v1:0');
  const [, setRenderCount] = useState(0);
  (window as any).fixture.finishRefresh = (revision: string) => setRenderedRevision(revision);
  (window as any).fixture.rerender = () => setRenderCount(count => count + 1);
  return <CatalogRevisionGuard revision={renderedRevision}><input aria-label="Search" defaultValue="" /><div style={{ height: 50, overflow: 'auto' }}><div style={{ height: 300 }}>Visible equipment</div></div><div style={{ height: 1600 }} /></CatalogRevisionGuard>;
}
createRoot(document.getElementById('root')!).render(<App />);
