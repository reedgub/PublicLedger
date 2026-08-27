import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return <div className="container-receipts py-24 text-center"><p className="eyebrow">404 / Record not found</p><h1 className="editorial mt-4 text-6xl font-semibold">No receipt found.</h1><p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground">This public record may not exist, may not be published, or may have been removed pending source verification.</p><Link href="/" className={`${buttonVariants()} mt-8 rounded-none`}>Return home</Link></div>;
}
