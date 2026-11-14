import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RequireAuth } from './lib/auth';

// Landing and app are split so the public page doesn't ship the app (and vice versa: the app won't load three.js).
const Landing = lazy(() => import('./pages/Landing'));
const SignIn = lazy(() => import('./pages/SignIn'));
const AppShell = lazy(() => import('./pages/AppShell'));
const Feed = lazy(() => import('./pages/Feed'));
const ListingDetail = lazy(() => import('./pages/ListingDetail'));
const Searches = lazy(() => import('./pages/Searches'));

const page = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

export const router = createBrowserRouter([
  { path: '/', element: page(<Landing />) },
  { path: '/signin', element: page(<SignIn />) },
  {
    path: '/app',
    element: page(<RequireAuth><AppShell /></RequireAuth>),
    children: [
      { index: true, element: page(<Feed />) },
      // Detail opens as a drawer over the feed, so it stays a child route of the feed layout.
      { path: 'l/:id', element: page(<Feed />), children: [{ index: true, element: page(<ListingDetail />) }] },
      { path: 'searches', element: page(<Searches />) },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
