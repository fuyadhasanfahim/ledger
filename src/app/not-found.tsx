import Link from "next/link";
import { Eyebrow } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="shell-narrow section">
      <Eyebrow>404 · no such entry</Eyebrow>

      <h1 className="h1 mt-5">This line isn&rsquo;t in the ledger.</h1>

      <p className="prose-ink mt-4">
        The page you asked for doesn&rsquo;t exist.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="btn-primary">
          Back to the ledger
        </Link>
        <Link href="/scenarios" className="btn-secondary">
          Test scenarios
        </Link>
      </div>
    </div>
  );
}
