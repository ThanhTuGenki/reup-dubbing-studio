import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import './app/styles/globals.css';

const root = document.querySelector<HTMLElement>('#root');

if (!root) throw new Error('Web application root is unavailable');

createRoot(root).render(<StrictMode><App /></StrictMode>);
