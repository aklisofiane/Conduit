import { Outlet } from 'react-router-dom';
import { TopChrome } from './TopChrome.js';

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopChrome />
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
