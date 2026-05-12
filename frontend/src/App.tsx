import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <Routes>
          <Route path="/" element={<Navigate to="/campaigns" replace />} />
          <Route path="/campaigns" element={<div className="p-8 text-center text-gray-400">Campaigns — coming soon</div>} />
          <Route path="/leads" element={<div className="p-8 text-center text-gray-400">Leads — coming soon</div>} />
          <Route path="/analytics" element={<div className="p-8 text-center text-gray-400">Analytics — coming soon</div>} />
          <Route path="/settings" element={<div className="p-8 text-center text-gray-400">Settings — coming soon</div>} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
