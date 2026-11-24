import { LoginForm } from '@/components/forms';
import { ThemeToggle } from '@/components/theme-toggle';
import { Brand } from '@/components/brand';
export default function LoginPage() {
  return <main className="login-layout"><section className="login-art"><Brand/><div className="art-copy"><span className="eyebrow">مساحة واحدة رؤية أوضح</span><h1>كل التفاصـيل<br/>في منظـور واحد</h1><p>مساحة العمل الداخلية لفريق منظور<br/>من أول تواصل إلى آخر تفصيلة في التسليم</p></div><div className="orbit" aria-hidden="true"><i/><i/><i/><b/></div><footer>استوديو منظور للإنتاج البصري والإعلاني</footer></section><section className="login-panel"><div className="login-toolbar"><span className="muted">مساحة عمل خاصة</span><ThemeToggle/></div><div className="login-form"><span className="eyebrow amber">أهلًا بعودتك</span><h2>لنصنع يومًا أوضح</h2><p className="muted">سجّل الدخول بحسابك المخصص من الإدارة</p><LoginForm/><p className="login-note">تحتاج إلى حساب أو نسيت كلمة المرور؟<br/>تواصل مع مسؤول النظام</p></div><footer>MANZOOR OS <span>نظام الإدارة الداخلية</span></footer></section></main>;
}
