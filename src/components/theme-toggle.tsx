'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { const next = localStorage.getItem('manzoor-theme') === 'dark';
    // Hydrate the persisted preference after the server-rendered initial state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light'; }, []);
  function toggle() { const next = !dark; setDark(next); localStorage.setItem('manzoor-theme', next ? 'dark' : 'light'); document.documentElement.dataset.theme = next ? 'dark' : 'light'; }
  return <button className="icon-button" onClick={toggle} aria-label={dark ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}>{dark ? <Sun size={20}/> : <Moon size={20}/>}</button>;
}
