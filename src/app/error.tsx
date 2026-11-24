'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="standalone card"><h1>تعذر إكمال الطلب</h1><p className="muted">تحقق من اتصال الخادم وقاعدة البيانات ثم أعد المحاولة</p><button onClick={reset}>إعادة المحاولة</button></main>;}
