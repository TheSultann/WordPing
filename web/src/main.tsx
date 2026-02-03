import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const storedTheme = localStorage.getItem('wordping.theme');
const initialTheme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'dark';
document.documentElement.setAttribute('data-theme', initialTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
