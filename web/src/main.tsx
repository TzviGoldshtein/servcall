import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { applyLang, loadLang } from './i18n';
import { applyTheme, cachedTheme, loadMode } from './theme';

// השפה והערכה של הפעם הקודמת מונחות לפני הרינדור, כדי שהדף לא יהבהב בכיוון
// או בצבע אחרים בזמן שהשרת עונה על /api/auth/me
applyLang(loadLang() ?? 'he');
applyTheme(cachedTheme(), loadMode());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
