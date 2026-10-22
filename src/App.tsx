import { db } from './data/instance';
import { Kontera } from './features/Kontera';
import { UpdateBanner } from './ui/UpdateBanner';

export function App() {
  return (
    <>
      <UpdateBanner />
      <Kontera db={db} />
    </>
  );
}
