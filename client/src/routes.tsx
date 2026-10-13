import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import MenuPage from "./pages/MenuPage";

/**
 * Binding route table for Tasks 7, 9–14.
 * Only /menu exists (YAGNI — no placeholder pages for future routes).
 */
export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/menu" replace /> },
  { path: "/menu", element: <MenuPage /> },
  { path: "*", element: <Navigate to="/menu" replace /> },
];
