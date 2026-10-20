import Link from "next/link";

const footerLinks = [
  { href: "/#features", label: "Features" },
  { href: "/#about", label: "About" },
  { href: "/#contact", label: "Contact" },
];

export default function Footer() {
  return (
    <footer className="border-t border-indigo-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div>
          <p className="font-medium text-indigo-700">Smartalyze</p>
          <p>A BSIT Capstone Project · Davao del Norte State College</p>
        </div>

        <nav className="flex flex-wrap gap-4">
          {footerLinks.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-indigo-700">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}