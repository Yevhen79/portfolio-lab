import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import Admin from "./pages/Admin";
import BacktestPage from "./pages/BacktestPage";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Login from "./pages/Login";
import PortfolioBuilder from "./pages/PortfolioBuilder";
import PortfolioCompare from "./pages/PortfolioCompare";
import PortfolioView from "./pages/PortfolioView";
import Register from "./pages/Register";
import { useConfig } from "./store/config";

export default function App() {
  // Load deployment config as early as possible (it's a public endpoint) so
  // the edition brand + theme apply even on the login / register pages,
  // before the user authenticates.
  const loadConfig = useConfig((s) => s.load);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="/build" element={<PortfolioBuilder />} />
          <Route path="/backtest" element={<BacktestPage />} />
          <Route path="/portfolio/:id" element={<PortfolioView />} />
          <Route path="/history" element={<History />} />
          <Route path="/compare" element={<PortfolioCompare />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
