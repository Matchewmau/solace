import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import GuidePage from "./pages/GuidePage";
import MenuPage from "./pages/MenuPage";
import PosPage from "./pages/PosPage";

/**
 * Binding route table for Tasks 7, 9–14.
 * /menu (Task 6) + /pos (Task 7) + /guide (Task 9).
 * YAGNI — no placeholder pages for future routes.
 */
export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/menu" replace /> },
  { path: "/menu", element: <MenuPage /> },
  { path: "/pos", element: <PosPage /> },
  { path: "/guide", element: <GuidePage /> },
  { path: "*", element: <Navigate to="/menu" replace /> },
];
