import React from 'react';
import { createRoot } from 'react-dom/client';
import { GearLoopBanner } from '../../src/components/GearLoopBanner';
import { CheckoutLoopBanner } from '../../src/components/CheckoutLoopBanner';
import { CategoryIcon } from '../../src/components/CategoryIcon';

createRoot(document.getElementById('root')!).render(<>
  <GearLoopBanner motion />
  <CheckoutLoopBanner />
  <div className="ci-host"><CategoryIcon name="Cameras" /><CategoryIcon name="Packages" /><CategoryIcon name="Grip" /></div>
</>);
