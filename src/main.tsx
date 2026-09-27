import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import { OperatorBoard } from './components/OperatorBoard.tsx';
import './index.css';

// ?board: the operator board (a full-screen view of the gateway's machines and alerts) instead of the editor
const board = new URLSearchParams(window.location.search).has('board');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {board ? <OperatorBoard /> : <App />}
  </React.StrictMode>
);
